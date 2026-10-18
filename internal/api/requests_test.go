package api_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

type requestJSON struct {
	ID           int64   `json:"id"`
	Source       string  `json:"source"`
	Outcome      string  `json:"outcome"`
	RejectReason *string `json:"reject_reason"`
	TitleID      *int64  `json:"title_id"`
	Seasons      []int   `json:"seasons"`
	Requester    struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"requester"`
	Slots []struct {
		Slot        string  `json:"slot"`
		Profile     *string `json:"profile"`
		VersionID   *int64  `json:"version_id"`
		Status      string  `json:"status"`
		StatusLabel string  `json:"status_label"`
		Download    *struct {
			Phase     string `json:"phase"`
			BytesLeft int64  `json:"bytes_left"`
		} `json:"download"`
	} `json:"slots"`
}

type requestListJSON struct {
	Items []requestJSON `json:"items"`
}

func (r requestJSON) slot(t *testing.T, name string) (status, label, profile string, version int64) {
	t.Helper()
	for _, s := range r.Slots {
		if s.Slot == name {
			if s.Profile != nil {
				profile = *s.Profile
			}
			if s.VersionID != nil {
				version = *s.VersionID
			}
			return s.Status, s.StatusLabel, profile, version
		}
	}
	t.Fatalf("request has no %s slot: %+v", name, r.Slots)
	return
}

func requestBody(sourceID, kind string, tmdb int, slots, seasons string) string {
	return fmt.Sprintf(`{"source":"silo","source_request_id":%q,"requester":{"id":"u-1","name":"Anna"},"title":{"kind":%q,"tmdb_id":%d},"slots":%s,"seasons":%s}`,
		sourceID, kind, tmdb, slots, seasons)
}

const dualSlots = `[{"slot":"standard","profile":null},{"slot":"4k"}]`

func TestARequestAddsAMovieInHDAndUHDAndSearchesBothAtOnce(t *testing.T) {
	s := newSearchBare(t)
	s.publish(t, goodRelease)
	s.publish(t, uhdRelease)

	r := s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null"))
	if r.Status != 201 {
		t.Fatalf("POST /requests = %d %s", r.Status, r.Body)
	}
	req := decode[requestJSON](t, r)
	if req.Outcome != "accepted" || req.TitleID == nil || req.Source != "silo" || req.Requester.Name != "Anna" {
		t.Fatalf("request = %+v", req)
	}
	if st, label, profile, _ := req.slot(t, "standard"); st != "queued" || label != "Searching" || profile != "hd-primary" {
		t.Errorf("hd = %s %q %s", st, label, profile)
	}
	if _, _, profile, _ := req.slot(t, "4k"); profile != "4k-primary" {
		t.Errorf("uhd profile = %s, want the resolved Profile", profile)
	}

	s.pass(t, jobs.Search)
	if q := s.queue(t); len(q) != 2 {
		t.Fatalf("queue = %+v, want a Grab per requested Slot", q)
	}
	got := decode[requestJSON](t, s.valid("GET", fmt.Sprintf("/requests/%d", req.ID), ""))
	if st, _, _, _ := got.slot(t, "standard"); st != "downloading" {
		t.Errorf("hd status = %s, want downloading", st)
	}
	if got.Slots[0].Download == nil || got.Slots[0].Download.Phase == "" {
		t.Errorf("download = %+v", got.Slots[0].Download)
	}
}

func TestRepeatingARequestCreatesNothingNew(t *testing.T) {
	s := newSearchBare(t)
	first := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null")))

	r := s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null"))

	if r.Status != 200 {
		t.Fatalf("retry = %d %s, want 200", r.Status, r.Body)
	}
	if again := decode[requestJSON](t, r); again.ID != first.ID {
		t.Errorf("retry id = %d, want %d", again.ID, first.ID)
	}
	titles := decode[struct {
		Items []rowJSON `json:"items"`
	}](t, s.valid("GET", "/titles", "")).Items
	if len(titles) != 1 {
		t.Errorf("%d Titles", len(titles))
	}
	list := decode[requestListJSON](t, s.valid("GET", "/requests?source=silo", ""))
	if len(list.Items) != 1 {
		t.Errorf("%d Requests stored", len(list.Items))
	}
}

func TestARequestNamingAnExistingSlotLeavesItUnchangedAndReportsIt(t *testing.T) {
	s := newSearchBare(t)
	created := decode[titleJSON](t, s.valid("POST", "/titles", `{"kind":"movie","tmdb_id":116149,"versions":[{"slot":"standard","profile":"hd-original"}]}`))

	req := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 116149,
		`[{"slot":"standard","profile":"any-primary"},{"slot":"4k"}]`, "null")))

	if req.Outcome != "accepted" || *req.TitleID != created.ID {
		t.Fatalf("request = %+v", req)
	}
	_, _, profile, version := req.slot(t, "standard")
	if profile != "hd-original" || version != created.Versions[0].ID {
		t.Errorf("hd reports %s / %d, want the existing Version unchanged", profile, version)
	}
	got := decode[titleJSON](t, s.valid("GET", fmt.Sprintf("/titles/%d", created.ID), ""))
	if len(got.Versions) != 2 || got.Versions[0].Profile != "hd-original" || got.Versions[1].Slot != "4k" {
		t.Errorf("versions = %+v", got.Versions)
	}
}

func TestASlotWithNoEnabledProfileRejectsTheRequestAndAddsNothing(t *testing.T) {
	s := newSearchBare(t)
	for _, k := range []string{"4k-primary", "4k-original"} {
		s.valid("PATCH", "/profiles/"+k, `{"enabled":false}`)
	}

	r := s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null"))

	if r.Status != 201 {
		t.Fatalf("status = %d %s, a rejection is still a 201", r.Status, r.Body)
	}
	req := decode[requestJSON](t, r)
	if req.Outcome != "rejected" || req.RejectReason == nil || *req.RejectReason != "no_enabled_profile" || req.TitleID != nil {
		t.Errorf("request = %+v", req)
	}
	if st, _, _, _ := req.slot(t, "standard"); st != "failed" {
		t.Errorf("hd = %s", st)
	}
	if rows := decode[struct {
		Items []rowJSON `json:"items"`
	}](t, s.valid("GET", "/titles", "")).Items; len(rows) != 0 {
		t.Errorf("a rejected Request added %d Titles", len(rows))
	}
}

func TestRetryingARejectedRequestEvaluatesItAgain(t *testing.T) {
	s := newSearchBare(t)
	for _, k := range []string{"4k-primary", "4k-original"} {
		s.valid("PATCH", "/profiles/"+k, `{"enabled":false}`)
	}
	first := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null")))
	if first.Outcome != "rejected" {
		t.Fatalf("first = %+v", first)
	}
	if r := s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null")); r.Status != 200 || decode[requestJSON](t, r).ID != first.ID {
		t.Fatalf("a retry that is still rejected = %d %s, want the stored one", r.Status, r.Body)
	}

	s.valid("PATCH", "/profiles/4k-primary", `{"enabled":true}`)
	r := s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null"))

	if r.Status != 201 {
		t.Fatalf("retry after the cause is fixed = %d %s, want 201", r.Status, r.Body)
	}
	if again := decode[requestJSON](t, r); again.Outcome != "accepted" || again.TitleID == nil {
		t.Errorf("retry = %+v, want accepted", again)
	}
	if list := decode[requestListJSON](t, s.valid("GET", "/requests?source=silo", "")); len(list.Items) != 1 {
		t.Errorf("%d Requests stored, want the one", len(list.Items))
	}
	if r := s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null")); r.Status != 200 {
		t.Errorf("a retry of an accepted Request = %d, want 200", r.Status)
	}
}

func TestAnUnknownTitleIsRejected(t *testing.T) {
	s := newSearchBare(t)
	req := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 999999999, `[{"slot":"standard"}]`, "null")))
	if req.Outcome != "rejected" || req.RejectReason == nil || *req.RejectReason != "unknown_title" {
		t.Errorf("request = %+v", req)
	}
}

func TestMalformedRequestsAre422(t *testing.T) {
	s := newSearchBare(t)
	for name, body := range map[string]string{
		"no slots":       requestBody("a", "movie", 116149, `[]`, "null"),
		"duplicate slot": requestBody("b", "movie", 116149, `[{"slot":"standard"},{"slot":"standard"}]`, "null"),
		"unknown key":    requestBody("c", "movie", 116149, `[{"slot":"standard","profile":"nope"}]`, "null"),
		"wrong slot":     requestBody("d", "movie", 116149, `[{"slot":"standard","profile":"4k-primary"}]`, "null"),
		"movie seasons":  requestBody("e", "movie", 116149, `[{"slot":"standard"}]`, "[1]"),
	} {
		if r := s.do("POST", "/requests", body); r.Status != 422 {
			t.Errorf("%s = %d %s, want 422", name, r.Status, r.Body)
		}
	}
}

func TestStatusFollowsTheFileAndALaterRemovedVersionFails(t *testing.T) {
	s := newSearchBare(t)
	req := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null")))
	_, _, _, hd := req.slot(t, "standard")
	_, _, _, uhd := req.slot(t, "4k")

	if _, err := s.in.st.Write().Exec(`INSERT INTO files (version_id, path, size, release_name, imported_at) VALUES (?, '/x.mkv', 1, 'x', '2026-10-17T12:00:00Z')`, hd); err != nil {
		t.Fatal(err)
	}
	if _, err := s.in.st.Write().Exec(`DELETE FROM versions WHERE id = ?`, uhd); err != nil {
		t.Fatal(err)
	}

	got := decode[requestJSON](t, s.valid("GET", fmt.Sprintf("/requests/%d", req.ID), ""))
	if st, _, _, _ := got.slot(t, "standard"); st != "completed" {
		t.Errorf("hd = %s, want completed", st)
	}
	if st, _, _, v := got.slot(t, "4k"); st != "failed" || v != 0 {
		t.Errorf("uhd = %s version %d, want failed with the Version gone", st, v)
	}
}

func TestACompletedRequestStaysCompletedWhenALaterProfileChangeMakesItsFileAMisfit(t *testing.T) {
	s := newSearchBare(t)
	req := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, `[{"slot":"standard"}]`, "null")))
	_, _, _, hd := req.slot(t, "standard")
	res, err := s.in.st.Write().Exec(`INSERT INTO files (version_id, path, size, release_name, imported_at) VALUES (?, '/x.mkv', 1, 'x', '2026-10-17T12:00:00Z')`, hd)
	if err != nil {
		t.Fatal(err)
	}
	file, _ := res.LastInsertId()
	path := fmt.Sprintf("/requests/%d", req.ID)
	if st, _, _, _ := decode[requestJSON](t, s.valid("GET", path, "")).slot(t, "standard"); st != "completed" {
		t.Fatalf("hd = %s, want completed once a fitting file fills it", st)
	}

	if _, err := s.in.st.Write().Exec(`INSERT INTO file_misfits (file_id) VALUES (?)`, file); err != nil {
		t.Fatal(err)
	}

	if st, _, _, _ := decode[requestJSON](t, s.valid("GET", path, "")).slot(t, "standard"); st != "completed" {
		t.Errorf("hd = %s, want completed: later changes do not reopen a Request", st)
	}
}

func TestARequestForAVersionHoldingAMisfitFileIsNotCompleted(t *testing.T) {
	s := newSearchBare(t)
	first := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, `[{"slot":"standard"}]`, "null")))
	_, _, _, hd := first.slot(t, "standard")
	res, err := s.in.st.Write().Exec(`INSERT INTO files (version_id, path, size, release_name, imported_at) VALUES (?, '/x.mkv', 1, 'x', '2026-10-17T12:00:00Z')`, hd)
	if err != nil {
		t.Fatal(err)
	}
	file, _ := res.LastInsertId()
	if _, err := s.in.st.Write().Exec(`INSERT INTO file_misfits (file_id) VALUES (?)`, file); err != nil {
		t.Fatal(err)
	}

	again := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-2", "movie", 116149, `[{"slot":"standard"}]`, "null")))

	if st, _, _, _ := again.slot(t, "standard"); st == "completed" {
		t.Errorf("hd = %s, want a Wanted misfit not to count as filled", st)
	}
}

func TestTheTitleDetailSaysWhoRequestedItFromWhere(t *testing.T) {
	s := newSearchBare(t)
	req := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null")))

	got := decode[struct {
		Requests []struct {
			ID            int64  `json:"id"`
			Source        string `json:"source"`
			RequesterName string `json:"requester_name"`
		} `json:"requests"`
	}](t, s.valid("GET", fmt.Sprintf("/titles/%d", *req.TitleID), ""))

	if len(got.Requests) != 1 || got.Requests[0].Source != "silo" || got.Requests[0].RequesterName != "Anna" || got.Requests[0].ID != req.ID {
		t.Errorf("requests = %+v", got.Requests)
	}
}

func TestBulkReadReturnsTheNamedRequests(t *testing.T) {
	s := newSearchBare(t)
	a := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null")))
	b := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-2", "movie", 116149, `[{"slot":"standard"}]`, "null")))

	list := decode[requestListJSON](t, s.valid("GET", fmt.Sprintf("/requests?id=%d&id=%d", a.ID, b.ID), ""))
	if len(list.Items) != 2 {
		t.Fatalf("items = %+v", list.Items)
	}
	one := decode[requestListJSON](t, s.valid("GET", fmt.Sprintf("/requests?title_id=%d", *a.TitleID), ""))
	if len(one.Items) != 2 {
		t.Errorf("by title = %d", len(one.Items))
	}
	if r := s.do("GET", "/requests/99999", ""); r.Status != 404 {
		t.Errorf("missing = %d", r.Status)
	}
}

func TestASeasonRequestMonitorsOnlyThoseSeasonsAndNeverUnmonitors(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)

	req := decode[requestJSON](t, l.valid("POST", "/requests", requestBody("s-1", "series", 1396, `[{"slot":"standard"}]`, "[1]")))
	if req.Outcome != "accepted" {
		t.Fatalf("request = %+v", req)
	}
	got := decode[seriesTitleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", *req.TitleID), ""))
	mon := map[int]bool{}
	for _, se := range got.Seasons {
		mon[se.Number] = se.Monitored
	}
	if !mon[1] || mon[0] || mon[2] || mon[3] {
		t.Errorf("seasons = %+v, want only season 1", mon)
	}

	decode[requestJSON](t, l.valid("POST", "/requests", requestBody("s-2", "series", 1396, `[{"slot":"standard"}]`, "[2]")))
	got = decode[seriesTitleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", *req.TitleID), ""))
	mon = map[int]bool{}
	for _, se := range got.Seasons {
		mon[se.Number] = se.Monitored
	}
	if !mon[1] || !mon[2] || mon[3] {
		t.Errorf("seasons = %+v, want 1 kept and 2 added", mon)
	}

	if r := l.do("POST", "/requests", requestBody("s-3", "series", 1396, `[{"slot":"standard"}]`, "[42]")); r.Status != 422 {
		t.Errorf("unknown season = %d %s", r.Status, r.Body)
	}
}

func TestARequestForAChildrensTitleGoesInTheFirstRootFolderWithTheSlotDefault(t *testing.T) {
	for _, c := range []struct {
		name, kind string
		tmdb       int
	}{
		{"movie", "movie", 116149}, // PG in the US
		{"series", "series", 7001}, // TV-Y7
	} {
		t.Run(c.name, func(t *testing.T) {
			l := newLibraryInstance(t, metadatatest.Key)
			l.moreFolders(t)

			r := l.valid("POST", "/requests", requestBody("r-1", c.kind, c.tmdb, `[{"slot":"standard"}]`, "null"))
			req := decode[requestJSON](t, r)

			want := map[string]string{"movie": l.data + "/media/movies", "series": l.data + "/media/tv"}[c.kind]
			if got := l.rootFolderOf(t, r); got != want {
				t.Errorf("root folder = %q, want %q", got, want)
			}
			if _, _, profile, _ := req.slot(t, "standard"); profile != "hd-primary" {
				t.Errorf("profile = %q, want the HD Slot's default", profile)
			}
		})
	}
}

func requestBodyIn(sourceID, kind string, tmdb int, root string) string {
	return fmt.Sprintf(`{"source":"silo","source_request_id":%q,"requester":{"id":"u-1","name":"Anna"},"title":{"kind":%q,"tmdb_id":%d},"slots":[{"slot":"standard"}],"root_folder":%q}`,
		sourceID, kind, tmdb, root)
}

func TestARequestMayNameTheRootFolderOfANewTitle(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	movies, _ := l.moreFolders(t)

	r := l.valid("POST", "/requests", requestBodyIn("r-1", "movie", 116149, movies))
	if r.Status != 201 {
		t.Fatalf("POST /requests = %d %s", r.Status, r.Body)
	}
	if got := l.rootFolderOf(t, r); got != movies {
		t.Errorf("root folder = %q, want %q", got, movies)
	}
}

func TestARequestWithARootFolderOfTheWrongKindOrUnknownIsRefused(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	_, series := l.moreFolders(t)

	for _, root := range []string{l.data + "/media/elsewhere", series} {
		r := l.valid("POST", "/requests", requestBodyIn("r-1", "movie", 116149, root))
		if r.Status != 422 || !strings.Contains(r.Body, "root_folder") {
			t.Errorf("root %q: POST /requests = %d %s, want 422 on root_folder", root, r.Status, r.Body)
		}
	}
}

func TestARequestForATitleInTheLibraryIgnoresTheRootFolder(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	movies, _ := l.moreFolders(t)

	first := l.valid("POST", "/requests", requestBody("r-1", "movie", 116149, `[{"slot":"standard"}]`, "null"))
	if got := l.rootFolderOf(t, first); got != l.data+"/media/movies" {
		t.Fatalf("first root folder = %q", got)
	}
	again := l.valid("POST", "/requests", fmt.Sprintf(`{"source":"silo","source_request_id":"r-2","requester":{"id":"u-1","name":"Anna"},"title":{"kind":"movie","tmdb_id":116149},"slots":[{"slot":"4k"}],"root_folder":%q}`, movies))
	if again.Status != 201 {
		t.Fatalf("second request = %d %s", again.Status, again.Body)
	}
	if got := l.rootFolderOf(t, again); got != l.data+"/media/movies" {
		t.Errorf("root folder = %q, want the Title left where it was", got)
	}
}

func TestARequestMayNameAnAnyProfile(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	req := decode[requestJSON](t, l.valid("POST", "/requests", requestBody("r-1", "movie", 116149, `[{"slot":"standard","profile":"any-original"}]`, "null")))
	if _, _, profile, _ := req.slot(t, "standard"); profile != "any-original" {
		t.Errorf("profile = %q, want the named Any Original", profile)
	}
}
