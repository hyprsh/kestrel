package silo_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"

	"github.com/hyprsh/kestrel/internal/silo"
)

const (
	scanKey      = "secret-key-123"
	scopeAuto    = pluginv1.ScanSourceChangeScope_SCAN_SOURCE_CHANGE_SCOPE_AUTO
	scopeSubtree = pluginv1.ScanSourceChangeScope_SCAN_SOURCE_CHANGE_SCOPE_SUBTREE
)

type fcChange struct {
	Path string `json:"path"`
	Kind string `json:"kind"`
	At   string `json:"at"`
}

type fcPage struct {
	Changes    []fcChange `json:"changes"`
	NextMarker string     `json:"next_marker"`
	Expired    bool       `json:"expired"`
	More       bool       `json:"more"`
}

// fakeKestrel answers the folder-changes contract: pages maps the marker sent
// to the page answered. An unknown marker answers an empty page.
type fakeKestrel struct {
	pages   map[string]fcPage
	status  int // non-zero answers this status on folder-changes
	roots   []string
	mu      sync.Mutex
	markers []string
}

func (f *fakeKestrel) server(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Api-Key") != scanKey {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"title":"unauthorized"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/folder-changes":
			f.mu.Lock()
			f.markers = append(f.markers, r.URL.Query().Get("marker"))
			f.mu.Unlock()
			if f.status != 0 {
				w.WriteHeader(f.status)
				_, _ = w.Write([]byte(`{"title":"failed"}`))
				return
			}
			p, ok := f.pages[r.URL.Query().Get("marker")]
			if !ok {
				p = fcPage{NextMarker: "fc1:now"}
			}
			_ = json.NewEncoder(w).Encode(p)
		case "/api/v1/settings":
			_ = json.NewEncoder(w).Encode(map[string]any{"root_folders": map[string]any{"movies": f.roots, "series": []string{}}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func poll(t *testing.T, base, key, marker string) (*pluginv1.PollChangesResponse, error) {
	t.Helper()
	return silo.NewScanSource(silo.Options{}).PollChanges(context.Background(), &pluginv1.PollChangesRequest{
		CapabilityId: "kestrel-imports",
		Marker:       marker,
		Connection:   &pluginv1.ResolvedConnection{BaseUrl: base, ApiKey: key},
	})
}

type want struct {
	path  string
	scope pluginv1.ScanSourceChangeScope
}

func TestPollChanges(t *testing.T) {
	arrival := "/media/movies/Arrival (2016) {tmdb-329865}"
	dune := "/media/movies/Dune (2021) {tmdb-438631}"
	cases := []struct {
		name       string
		kestrel    *fakeKestrel
		marker     string
		wantMarker string
		wantSent   []string
		want       []want
	}{
		{
			name:       "first poll starts from now",
			kestrel:    &fakeKestrel{pages: map[string]fcPage{"": {NextMarker: "fc1:7"}}},
			wantMarker: "fc1:7",
			wantSent:   []string{""},
		},
		{
			name: "created, modified, unknown and deleted map to scopes",
			kestrel: &fakeKestrel{pages: map[string]fcPage{"fc1:7": {
				Changes: []fcChange{
					{Path: arrival, Kind: "created"},
					{Path: dune, Kind: "modified"},
					{Path: "/media/movies/Odd", Kind: "renamed"},
					{Path: "/media/movies/Gone/", Kind: "deleted"},
				},
				NextMarker: "fc1:11",
			}}},
			marker:     "fc1:7",
			wantMarker: "fc1:11",
			wantSent:   []string{"fc1:7"},
			want: []want{
				{arrival, scopeSubtree}, {dune, scopeSubtree}, {"/media/movies/Odd", scopeSubtree},
				{"/media/movies/Gone", scopeAuto},
			},
		},
		{
			name: "the last kind for a path wins",
			kestrel: &fakeKestrel{pages: map[string]fcPage{"m": {
				Changes: []fcChange{
					{Path: arrival, Kind: "created"},
					{Path: dune, Kind: "deleted"},
					{Path: arrival, Kind: "deleted"},
					{Path: dune, Kind: "created"},
				},
				NextMarker: "m2",
			}}},
			marker:     "m",
			wantMarker: "m2",
			wantSent:   []string{"m"},
			want:       []want{{arrival, scopeAuto}, {dune, scopeSubtree}},
		},
		{
			name: "more pages are read with the new marker",
			kestrel: &fakeKestrel{pages: map[string]fcPage{
				"a": {Changes: []fcChange{{Path: arrival, Kind: "created"}}, NextMarker: "b", More: true},
				"b": {Changes: []fcChange{{Path: dune, Kind: "created"}}, NextMarker: "c"},
			}},
			marker:     "a",
			wantMarker: "c",
			wantSent:   []string{"a", "b"},
			want:       []want{{arrival, scopeSubtree}, {dune, scopeSubtree}},
		},
		{
			name: "an expired marker rescans every Root folder",
			kestrel: &fakeKestrel{
				roots: []string{"/media/movies", "/media/tv/"},
				pages: map[string]fcPage{"old": {Expired: true, NextMarker: "fc1:99"}},
			},
			marker:     "old",
			wantMarker: "fc1:99",
			wantSent:   []string{"old"},
			want:       []want{{"/media/movies/", scopeAuto}, {"/media/tv/", scopeAuto}},
		},
		{
			name:       "an expired marker with no Root folders has nothing to scan",
			kestrel:    &fakeKestrel{pages: map[string]fcPage{"old": {Expired: true, NextMarker: "fc1:99"}}},
			marker:     "old",
			wantMarker: "fc1:99",
			wantSent:   []string{"old"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := tc.kestrel.server(t)
			resp, err := poll(t, srv.URL, scanKey, tc.marker)
			if err != nil {
				t.Fatal(err)
			}
			if resp.GetNextMarker() != tc.wantMarker {
				t.Errorf("next_marker = %q, want %q", resp.GetNextMarker(), tc.wantMarker)
			}
			if strings.Join(tc.kestrel.markers, ",") != strings.Join(tc.wantSent, ",") {
				t.Errorf("markers sent to Kestrel = %q, want %q", tc.kestrel.markers, tc.wantSent)
			}
			var got []want
			for _, c := range resp.GetChanges() {
				got = append(got, want{c.GetSourcePath(), c.GetScope()})
			}
			if len(got) != len(tc.want) {
				t.Fatalf("changes = %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("change %d = %v, want %v", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestPollChangesStopsPagingAtTheBound(t *testing.T) {
	pages := map[string]fcPage{}
	for i := range 30 {
		pages["m"+strconv.Itoa(i)] = fcPage{
			Changes:    []fcChange{{Path: "/media/movies/T" + strconv.Itoa(i), Kind: "created"}},
			NextMarker: "m" + strconv.Itoa(i+1), More: true,
		}
	}
	k := fakeKestrel{pages: pages}
	srv := k.server(t)
	resp, err := poll(t, srv.URL, scanKey, "m0")
	if err != nil {
		t.Fatal(err)
	}
	if len(k.markers) != 10 || len(resp.GetChanges()) != 10 || resp.GetNextMarker() != "m10" {
		t.Errorf("pages = %d, changes = %d, next_marker = %q; want 10, 10, m10", len(k.markers), len(resp.GetChanges()), resp.GetNextMarker())
	}
}

func TestPollChangesErrors(t *testing.T) {
	cases := []struct {
		name    string
		kestrel *fakeKestrel
		noBase  bool
		key     string
		want    string
	}{
		{name: "empty next_marker", kestrel: &fakeKestrel{pages: map[string]fcPage{"m": {}}}, key: scanKey, want: "empty marker"},
		{name: "missing base URL", kestrel: &fakeKestrel{}, noBase: true, key: scanKey, want: "no Kestrel connection is bound to this source"},
		{name: "missing API key", kestrel: &fakeKestrel{}, key: "", want: "no Kestrel connection is bound to this source"},
		{name: "wrong API key", kestrel: &fakeKestrel{}, key: "nope", want: "rejected the API key"},
		{name: "older Kestrel", kestrel: &fakeKestrel{status: http.StatusNotFound}, key: scanKey, want: "has no folder-change feed (HTTP 404); update Kestrel"},
		{name: "server error", kestrel: &fakeKestrel{status: http.StatusInternalServerError}, key: scanKey, want: "HTTP 500"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			base := ""
			if !tc.noBase {
				base = tc.kestrel.server(t).URL
			}
			_, err := poll(t, base, tc.key, "m")
			if err == nil {
				t.Fatal("want an error")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error = %q, want it to contain %q", err, tc.want)
			}
			for _, secret := range []string{scanKey, "nope"} {
				if strings.Contains(err.Error(), secret) {
					t.Errorf("error %q leaks the API key", err)
				}
			}
		})
	}
}

func TestTheManifestDeclaresTheScanSource(t *testing.T) {
	m, err := silo.Manifest("1.2.3")
	if err != nil {
		t.Fatal(err)
	}
	var found *pluginv1.CapabilityDescriptor
	for _, c := range m.GetCapabilities() {
		if c.GetType() == "scan_source.v1" {
			found = c
		}
	}
	if found == nil {
		t.Fatalf("no scan_source.v1 capability in %+v", m.GetCapabilities())
	}
	if found.GetId() != "kestrel-imports" {
		t.Errorf("id = %q", found.GetId())
	}
	d, _ := found.GetMetadata().AsMap()["scan_source"].(map[string]any)
	if d["connection"] != "required" || d["emits_native_paths"] != false {
		t.Errorf("descriptor = %v", d)
	}
	if modes, _ := d["delivery_modes"].([]any); len(modes) != 1 || modes[0] != "poll" {
		t.Errorf("delivery_modes = %v", d["delivery_modes"])
	}
}
