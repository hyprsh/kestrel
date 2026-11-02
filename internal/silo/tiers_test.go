package silo_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"

	"github.com/hyprsh/kestrel/internal/silo"
)

// slotStub is a Kestrel that holds the named Slots, records the body of the
// last POST /requests and answers it with a Version in every Slot named.
type slotStub struct {
	*httptest.Server
	body map[string]any
}

func newSlotStub(t *testing.T, slotIDs ...string) *slotStub {
	t.Helper()
	s := &slotStub{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/requests":
			s.body = nil
			_ = json.NewDecoder(r.Body).Decode(&s.body)
			var slots []string
			for _, sl := range s.body["slots"].([]any) {
				slots = append(slots, fmt.Sprintf(`{"slot":%q,"profile":"p","status":"queued","status_label":"Searching","download":null}`, sl.(map[string]any)["slot"]))
			}
			w.WriteHeader(201)
			fmt.Fprintf(w, `{"id":5,"outcome":"accepted","reject_reason":null,"slots":[%s]}`, strings.Join(slots, ","))
		case r.URL.Path == "/api/v1/requests":
			fmt.Fprint(w, `{"items":[{"id":5,"outcome":"accepted","reject_reason":null,"slots":[{"slot":"remux","profile":"p","status":"downloading","status_label":"Downloading","download":null}]}]}`)
		case r.URL.Path == "/api/v1/slots":
			var items []string
			for _, id := range slotIDs {
				key := map[bool]string{true: "remux-1", false: "hd"}[id == "remux"]
				items = append(items, fmt.Sprintf(`{"id":%q,"label":%q,"default_movies":%q,"default_series":%q}`, id, strings.ToUpper(id), key, key))
			}
			fmt.Fprintf(w, `{"items":[%s]}`, strings.Join(items, ","))
		case r.URL.Path == "/api/v1/profiles":
			fmt.Fprint(w, `{"items":[{"key":"hd","name":"HD","slot":"standard","enabled":true},{"key":"remux-1","name":"Remux","slot":"remux","enabled":true}]}`)
		case r.URL.Path == "/api/v1/settings":
			fmt.Fprint(w, `{"root_folders":{"movies":["/m"],"series":[]}}`)
		case r.URL.Path == "/api/v1/system":
			fmt.Fprint(w, `{"version":"1.0.0","api_major":1,"base_url":""}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(s.Close)
	return s
}

// sentSlots is the Slots (and Profiles) the last Request named, as "slot=profile".
func (s *slotStub) sentSlots() []string {
	var out []string
	for _, sl := range s.body["slots"].([]any) {
		m := sl.(map[string]any)
		out = append(out, fmt.Sprintf("%v=%v", m["slot"], m["profile"]))
	}
	return out
}

func TestA4KSiloRequestCreatesAVersionInTheSlotThe2160pTierMapsTo(t *testing.T) {
	k := newSlotStub(t, "standard", "remux")
	r := silo.NewRouter(silo.Options{})
	c := conn(t, k.URL, "kst_x", map[string]any{"2160p_slot": "remux", "2160p_profile": "remux-1"})

	res := fulfil(t, r, c, movie(7), "1080p", "2160p")

	if got := strings.Join(k.sentSlots(), ","); got != "standard=<nil>,remux=remux-1" {
		t.Errorf("slots = %s, want standard and remux under remux-1", got)
	}
	if tg := target(t, res, "2160p"); tg.Status != "queued" {
		t.Errorf("2160p target = %+v", tg)
	}
}

func TestIs4KFollowsThe2160pMapping(t *testing.T) {
	k := newSlotStub(t, "standard", "remux")
	r := silo.NewRouter(silo.Options{})
	c := conn(t, k.URL, "kst_x", map[string]any{"2160p_slot": "remux"})

	res, err := r.Fulfill(context.Background(), &pluginv1.FulfillRequest{
		CapabilityId: "kestrel", Request: movie(7), Connections: []*pluginv1.RouterConnection{c},
		Qualities: []*pluginv1.RequestedQuality{{Id: "uhd", Is4K: true}},
	})

	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(k.sentSlots(), ","); got != "remux=<nil>" {
		t.Errorf("slots = %s, want remux", got)
	}
	if len(res.Targets) != 1 || res.Targets[0].Quality != "2160p" {
		t.Errorf("targets = %+v, want one for 2160p", res.Targets)
	}
}

func TestStatusIsReadFromTheSlotTheTierMapsTo(t *testing.T) {
	k := newSlotStub(t, "standard", "remux")
	r := silo.NewRouter(silo.Options{})
	c := conn(t, k.URL, "kst_x", map[string]any{"2160p_slot": "remux"})

	st := check(t, r, c, movie(7), []*pluginv1.FulfillmentTarget{{Quality: "2160p", ConnectionId: "kestrel-1", ExternalId: "5"}})

	if got := st["2160p"]; got.Status != "downloading" {
		t.Errorf("2160p = %+v, want the remux Version's status", got)
	}
}

func TestAnUnknownTierInAStatusCheckFollowsThe1080pMapping(t *testing.T) {
	k := newSlotStub(t, "remux")
	r := silo.NewRouter(silo.Options{})
	c := conn(t, k.URL, "kst_x", map[string]any{"1080p_slot": "remux"})

	st := check(t, r, c, movie(7), []*pluginv1.FulfillmentTarget{{Quality: "720p", ConnectionId: "kestrel-1", ExternalId: "5"}})

	if got := st["720p"]; got.Status != "downloading" {
		t.Errorf("720p = %+v, want the 1080p Slot's status", got)
	}
}

func TestTheNewProfileKeyWinsOverAnAliasAndThePluginSaysSoOnce(t *testing.T) {
	var logs bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })
	k := newSlotStub(t, "standard", "4k")
	r := silo.NewRouter(silo.Options{})
	c := conn(t, k.URL, "kst_x", map[string]any{"standard_profile": "old", "1080p_profile": "new"})

	fulfil(t, r, c, movie(7), "1080p")
	fulfil(t, r, c, movie(7), "1080p")

	if got := strings.Join(k.sentSlots(), ","); got != "standard=new" {
		t.Errorf("slots = %s, want standard=new", got)
	}
	if n := strings.Count(logs.String(), "standard_profile"); n != 1 {
		t.Errorf("logged %d times, want once: %s", n, logs.String())
	}
}

func TestTheAliasesStillSetTheProfileOfTheSeededSlots(t *testing.T) {
	k := newSlotStub(t, "standard", "4k")
	r := silo.NewRouter(silo.Options{})
	c := conn(t, k.URL, "kst_x", map[string]any{"standard_profile": "a", "4k_profile": "b"})

	fulfil(t, r, c, movie(7), "1080p", "2160p")

	if got := strings.Join(k.sentSlots(), ","); got != "standard=a,4k=b" {
		t.Errorf("slots = %s", got)
	}
}

func TestAMappingToAMissingSlotFailsValidation(t *testing.T) {
	k := newSlotStub(t, "standard", "4k")
	r := silo.NewRouter(silo.Options{})
	validate := func(cfg map[string]any) *pluginv1.ValidateResponse {
		res, err := r.Validate(context.Background(), &pluginv1.ValidateRequest{CapabilityId: "kestrel", Connection: conn(t, k.URL, "kst_x", cfg)})
		if err != nil {
			t.Fatal(err)
		}
		return res
	}

	if res := validate(nil); len(res.FieldErrors) != 0 || res.FormError != "" {
		t.Errorf("default mapping = %+v, want none", res)
	}
	res := validate(map[string]any{"2160p_slot": "remux"})
	if msg := res.FieldErrors["2160p_slot"]; !strings.Contains(msg, "remux") {
		t.Errorf("errors = %+v, want the 2160p_slot field to name remux", res.FieldErrors)
	}
	if _, bad := res.FieldErrors["1080p_slot"]; bad {
		t.Errorf("errors = %+v, want 1080p_slot fine", res.FieldErrors)
	}
}

func TestTheSlotAndTierProfileFieldsAreListedFromKestrel(t *testing.T) {
	k := newSlotStub(t, "standard", "remux")
	r := silo.NewRouter(silo.Options{})
	c := conn(t, k.URL, "kst_x", map[string]any{"2160p_slot": "remux"})

	opts, err := r.ListConfigOptions(context.Background(), &pluginv1.ListConfigOptionsRequest{CapabilityId: "kestrel", Connection: c})
	if err != nil {
		t.Fatal(err)
	}

	var slots []string
	for _, o := range opts.OptionsByField["2160p_slot"].GetOptions() {
		slots = append(slots, o.Value)
	}
	if strings.Join(slots, ",") != "default,standard,remux" {
		t.Errorf("2160p_slot options = %v", slots)
	}
	var profiles []string
	for _, o := range opts.OptionsByField["2160p_profile"].GetOptions() {
		profiles = append(profiles, o.Value)
	}
	if strings.Join(profiles, ",") != "default,hd,remux-1" {
		t.Errorf("2160p_profile options = %v, want every enabled Profile", profiles)
	}
	// The preselected "default" names the mapped Slot's default Profile; the 1080p tier maps to Standard.
	if got := opts.OptionsByField["2160p_profile"].GetOptions()[0].Label; !strings.Contains(got, "Remux") {
		t.Errorf("2160p default option = %q, want the mapped Slot's default Profile named", got)
	}
	if got := opts.OptionsByField["1080p_profile"].GetOptions()[0].Label; !strings.Contains(got, "HD") {
		t.Errorf("1080p default option = %q, want Standard's default Profile named", got)
	}
}
