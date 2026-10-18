package api_test

import (
	"fmt"
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

const dualSlots = `[{"slot":"hd","profile":null},{"slot":"uhd"}]`

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
	if st, label, profile, _ := req.slot(t, "hd"); st != "queued" || label != "Searching" || profile != "kids-primary" {
		t.Errorf("hd = %s %q %s", st, label, profile)
	}
	if _, _, profile, _ := req.slot(t, "uhd"); profile != "uhd-primary" {
		t.Errorf("uhd profile = %s, want the resolved Profile", profile)
	}

	s.pass(t, jobs.Search)
	if q := s.queue(t); len(q) != 2 {
		t.Fatalf("queue = %+v, want a Grab per requested Slot", q)
	}
	got := decode[requestJSON](t, s.valid("GET", fmt.Sprintf("/requests/%d", req.ID), ""))
	if st, _, _, _ := got.slot(t, "hd"); st != "downloading" {
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
	created := decode[titleJSON](t, s.valid("POST", "/titles", `{"kind":"movie","tmdb_id":116149,"versions":[{"slot":"hd","profile":"hd-original"}]}`))

	req := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 116149,
		`[{"slot":"hd","profile":"kids-primary"},{"slot":"uhd"}]`, "null")))

	if req.Outcome != "accepted" || *req.TitleID != created.ID {
		t.Fatalf("request = %+v", req)
	}
	_, _, profile, version := req.slot(t, "hd")
	if profile != "hd-original" || version != created.Versions[0].ID {
		t.Errorf("hd reports %s / %d, want the existing Version unchanged", profile, version)
	}
	got := decode[titleJSON](t, s.valid("GET", fmt.Sprintf("/titles/%d", created.ID), ""))
	if len(got.Versions) != 2 || got.Versions[0].Profile != "hd-original" || got.Versions[1].Slot != "uhd" {
		t.Errorf("versions = %+v", got.Versions)
	}
}

func TestASlotWithNoEnabledProfileRejectsTheRequestAndAddsNothing(t *testing.T) {
	s := newSearchBare(t)
	for _, k := range []string{"uhd-primary", "uhd-original"} {
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
	if st, _, _, _ := req.slot(t, "hd"); st != "failed" {
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
	for _, k := range []string{"uhd-primary", "uhd-original"} {
		s.valid("PATCH", "/profiles/"+k, `{"enabled":false}`)
	}
	first := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null")))
	if first.Outcome != "rejected" {
		t.Fatalf("first = %+v", first)
	}
	if r := s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null")); r.Status != 200 || decode[requestJSON](t, r).ID != first.ID {
		t.Fatalf("a retry that is still rejected = %d %s, want the stored one", r.Status, r.Body)
	}

	s.valid("PATCH", "/profiles/uhd-primary", `{"enabled":true}`)
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
	req := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 999999999, `[{"slot":"hd"}]`, "null")))
	if req.Outcome != "rejected" || req.RejectReason == nil || *req.RejectReason != "unknown_title" {
		t.Errorf("request = %+v", req)
	}
}

func TestMalformedRequestsAre422(t *testing.T) {
	s := newSearchBare(t)
	for name, body := range map[string]string{
		"no slots":       requestBody("a", "movie", 116149, `[]`, "null"),
		"duplicate slot": requestBody("b", "movie", 116149, `[{"slot":"hd"},{"slot":"hd"}]`, "null"),
		"unknown key":    requestBody("c", "movie", 116149, `[{"slot":"hd","profile":"nope"}]`, "null"),
		"wrong slot":     requestBody("d", "movie", 116149, `[{"slot":"hd","profile":"uhd-primary"}]`, "null"),
		"movie seasons":  requestBody("e", "movie", 116149, `[{"slot":"hd"}]`, "[1]"),
	} {
		if r := s.do("POST", "/requests", body); r.Status != 422 {
			t.Errorf("%s = %d %s, want 422", name, r.Status, r.Body)
		}
	}
}

func TestStatusFollowsTheFileAndALaterRemovedVersionFails(t *testing.T) {
	s := newSearchBare(t)
	req := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null")))
	_, _, _, hd := req.slot(t, "hd")
	_, _, _, uhd := req.slot(t, "uhd")

	if _, err := s.in.st.Write().Exec(`INSERT INTO files (version_id, path, size, release_name, imported_at) VALUES (?, '/x.mkv', 1, 'x', '2026-10-17T12:00:00Z')`, hd); err != nil {
		t.Fatal(err)
	}
	if _, err := s.in.st.Write().Exec(`DELETE FROM versions WHERE id = ?`, uhd); err != nil {
		t.Fatal(err)
	}

	got := decode[requestJSON](t, s.valid("GET", fmt.Sprintf("/requests/%d", req.ID), ""))
	if st, _, _, _ := got.slot(t, "hd"); st != "completed" {
		t.Errorf("hd = %s, want completed", st)
	}
	if st, _, _, v := got.slot(t, "uhd"); st != "failed" || v != 0 {
		t.Errorf("uhd = %s version %d, want failed with the Version gone", st, v)
	}
}

func TestACompletedRequestStaysCompletedWhenALaterProfileChangeMakesItsFileAMisfit(t *testing.T) {
	s := newSearchBare(t)
	req := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, `[{"slot":"hd"}]`, "null")))
	_, _, _, hd := req.slot(t, "hd")
	res, err := s.in.st.Write().Exec(`INSERT INTO files (version_id, path, size, release_name, imported_at) VALUES (?, '/x.mkv', 1, 'x', '2026-10-17T12:00:00Z')`, hd)
	if err != nil {
		t.Fatal(err)
	}
	file, _ := res.LastInsertId()
	path := fmt.Sprintf("/requests/%d", req.ID)
	if st, _, _, _ := decode[requestJSON](t, s.valid("GET", path, "")).slot(t, "hd"); st != "completed" {
		t.Fatalf("hd = %s, want completed once a fitting file fills it", st)
	}

	if _, err := s.in.st.Write().Exec(`INSERT INTO file_misfits (file_id) VALUES (?)`, file); err != nil {
		t.Fatal(err)
	}

	if st, _, _, _ := decode[requestJSON](t, s.valid("GET", path, "")).slot(t, "hd"); st != "completed" {
		t.Errorf("hd = %s, want completed: later changes do not reopen a Request", st)
	}
}

func TestARequestForAVersionHoldingAMisfitFileIsNotCompleted(t *testing.T) {
	s := newSearchBare(t)
	first := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, `[{"slot":"hd"}]`, "null")))
	_, _, _, hd := first.slot(t, "hd")
	res, err := s.in.st.Write().Exec(`INSERT INTO files (version_id, path, size, release_name, imported_at) VALUES (?, '/x.mkv', 1, 'x', '2026-10-17T12:00:00Z')`, hd)
	if err != nil {
		t.Fatal(err)
	}
	file, _ := res.LastInsertId()
	if _, err := s.in.st.Write().Exec(`INSERT INTO file_misfits (file_id) VALUES (?)`, file); err != nil {
		t.Fatal(err)
	}

	again := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-2", "movie", 116149, `[{"slot":"hd"}]`, "null")))

	if st, _, _, _ := again.slot(t, "hd"); st == "completed" {
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
	b := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-2", "movie", 116149, `[{"slot":"sd"}]`, "null")))

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

	req := decode[requestJSON](t, l.valid("POST", "/requests", requestBody("s-1", "series", 1396, `[{"slot":"hd"}]`, "[1]")))
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

	decode[requestJSON](t, l.valid("POST", "/requests", requestBody("s-2", "series", 1396, `[{"slot":"hd"}]`, "[2]")))
	got = decode[seriesTitleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", *req.TitleID), ""))
	mon = map[int]bool{}
	for _, se := range got.Seasons {
		mon[se.Number] = se.Monitored
	}
	if !mon[1] || !mon[2] || mon[3] {
		t.Errorf("seasons = %+v, want 1 kept and 2 added", mon)
	}

	if r := l.do("POST", "/requests", requestBody("s-3", "series", 1396, `[{"slot":"hd"}]`, "[42]")); r.Status != 422 {
		t.Errorf("unknown season = %d %s", r.Status, r.Body)
	}
}

// kidsFolders saves the default Root folders plus a Kids root folder per kind, and returns those two.
func (l library) kidsFolders(t *testing.T) (movies, series string) {
	t.Helper()
	movies, series = l.data+"/media/kids-movies", l.data+"/media/kids-tv"
	mkdirs(t, l.data+"/media/movies", l.data+"/media/tv", movies, series)
	l.valid("PATCH", "/settings", fmt.Sprintf(`{"root_folders":{"movies":[%q,%q],"series":[%q,%q],"kids_movies":%q,"kids_series":%q}}`,
		l.data+"/media/movies", movies, l.data+"/media/tv", series, movies, series))
	return movies, series
}

func (l library) rootFolderOf(t *testing.T, r reply) string {
	t.Helper()
	req := decode[requestJSON](t, r)
	if req.Outcome != "accepted" || req.TitleID == nil {
		t.Fatalf("request = %+v", req)
	}
	return decode[titleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", *req.TitleID), "")).RootFolder
}

func TestARequestTheKidsRuleCatchesGoesInTheKidsRootFolder(t *testing.T) {
	for _, c := range []struct {
		name, kind string
		tmdb       int
		threshold  int
		kids       bool
	}{
		{"kids movie", "movie", 116149, 6, true}, // PG in the US: age 6
		{"movie above the age", "movie", 116149, 0, false},
		{"kids series", "series", 7001, 6, true}, // TV-Y7
		{"series above the age", "series", 7001, 0, false},
	} {
		t.Run(c.name, func(t *testing.T) {
			l := newLibraryInstance(t, metadatatest.Key)
			kidsMovies, kidsSeries := l.kidsFolders(t)
			l.valid("PATCH", "/settings", fmt.Sprintf(`{"kids_rule":{"enabled":true,"threshold":%d}}`, c.threshold))

			got := l.rootFolderOf(t, l.valid("POST", "/requests", requestBody("r-1", c.kind, c.tmdb, `[{"slot":"hd"}]`, "null")))
			want := map[string]string{"movie": l.data + "/media/movies", "series": l.data + "/media/tv"}[c.kind]
			if c.kids {
				want = map[string]string{"movie": kidsMovies, "series": kidsSeries}[c.kind]
			}
			if got != want {
				t.Errorf("root folder = %q, want %q", got, want)
			}
		})
	}
}

func TestANamedHDProfilePicksTheFolderInsteadOfTheKidsRule(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	l.kidsFolders(t)
	if got := l.rootFolderOf(t, l.valid("POST", "/requests", requestBody("r-1", "movie", 116149, `[{"slot":"hd","profile":"hd-primary"}]`, "null"))); got != l.data+"/media/movies" {
		t.Errorf("a Kids title under a named HD Profile went to %q, want the first folder", got)
	}

	l = newLibraryInstance(t, metadatatest.Key)
	kidsMovies, _ := l.kidsFolders(t)
	l.valid("PATCH", "/settings", `{"kids_rule":{"enabled":false}}`)
	if got := l.rootFolderOf(t, l.valid("POST", "/requests", requestBody("r-1", "movie", 116149, `[{"slot":"hd","profile":"kids-original"}]`, "null"))); got != kidsMovies {
		t.Errorf("a named Kids Profile went to %q, want the Kids folder", got)
	}
}

func TestWithoutKidsRootFoldersARequestGoesInTheFirstRootFolder(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	if got := l.rootFolderOf(t, l.valid("POST", "/requests", requestBody("r-1", "movie", 116149, `[{"slot":"hd"}]`, "null"))); got != l.data+"/media/movies" {
		t.Errorf("root folder = %q", got)
	}
}
