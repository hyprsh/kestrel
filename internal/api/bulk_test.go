package api_test

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

// bulkLibrary is Paddington in Standard and 4K, Memento in 4K only and Breaking Bad in Standard.
type bulkLibrary struct {
	library
	paddington, memento, breakingBad int64
}

func newBulkLibrary(t *testing.T) bulkLibrary {
	t.Helper()
	l := newLibraryInstance(t, metadatatest.Key)
	add := func(body string) int64 {
		r := l.valid("POST", "/titles", body)
		if r.Status != 201 {
			t.Fatalf("POST /titles = %d %s", r.Status, r.Body)
		}
		return decode[titleJSON](t, r).ID
	}
	return bulkLibrary{
		library:     l,
		paddington:  add(addPaddington),
		memento:     add(`{"kind":"movie","tmdb_id":77,"versions":[{"slot":"4k","profile":"4k-primary"}]}`),
		breakingBad: add(addBreakingBad + `}`),
	}
}

// bulk posts one bulk call, checks it answered 200 and returns its items.
func (b bulkLibrary) bulk(t *testing.T, body string) bulkJSON {
	t.Helper()
	r := b.valid("POST", "/titles/bulk", body)
	if r.Status != 200 {
		t.Fatalf("bulk %s = %d %s", body, r.Status, r.Body)
	}
	return decode[bulkJSON](t, r)
}

// ids is the JSON array of the three Titles plus one that does not exist.
func (b bulkLibrary) ids() string {
	return fmt.Sprintf("[%d,%d,%d,999]", b.paddington, b.memento, b.breakingBad)
}

// profileIn is the Profile of a Title's Version in the Slot, or "" when it has none there.
func (b bulkLibrary) profileIn(t *testing.T, id int64, slot string) string {
	t.Helper()
	for _, v := range decode[titleJSON](t, b.valid("GET", fmt.Sprintf("/titles/%d", id), "")).Versions {
		if v.Slot == slot {
			return v.Profile
		}
	}
	return ""
}

func TestSwitchingTheStandardProfileInBulkSkipsTitlesWithoutAStandardVersion(t *testing.T) {
	t.Parallel()
	b := newBulkLibrary(t)
	body := `{"action":"switch_profile","slot":"standard","profile":"any-primary","title_ids":` + b.ids() + `}`

	got := b.bulk(t, body)

	if o := got.outcomes(); o["changed"] != 2 || o["skipped/no_version"] != 1 || o["skipped/not_found"] != 1 {
		t.Errorf("outcomes = %v", o)
	}
	if got.Items[1].TitleID != b.memento || got.Items[1].Reason == nil || *got.Items[1].Reason != "no_version" {
		t.Errorf("Memento = %+v, want skipped as no_version", got.Items[1])
	}
	for _, id := range []int64{b.paddington, b.breakingBad} {
		if p := b.profileIn(t, id, "standard"); p != "any-primary" {
			t.Errorf("Title %d is on %q, want any-primary", id, p)
		}
	}
	if p := b.profileIn(t, b.paddington, "4k"); p != "4k-primary" {
		t.Errorf("the 4K Version moved to %q", p)
	}
	if o := b.bulk(t, body).outcomes(); o["skipped/unchanged"] != 2 {
		t.Errorf("second call = %v, want 2 unchanged", o)
	}
}

func TestABulkProfileSwitchToAProfileOfAnotherSlotIsRefused(t *testing.T) {
	t.Parallel()
	b := newBulkLibrary(t)

	r := b.valid("POST", "/titles/bulk", fmt.Sprintf(`{"action":"switch_profile","slot":"standard","profile":"4k-primary","title_ids":[%d]}`, b.paddington))

	if r.Status != 422 {
		t.Errorf("wrong Slot = %d %s, want 422", r.Status, r.Body)
	}
	if p := b.profileIn(t, b.paddington, "standard"); p != "hd-primary" {
		t.Errorf("Paddington moved to %q", p)
	}
}

func TestAddingAVersionInBulkFillsEmptySlotsAndSkipsTakenOnes(t *testing.T) {
	t.Parallel()
	b := newBulkLibrary(t)
	body := `{"action":"add_version","slot":"4k","profile":"4k-primary","title_ids":` + b.ids() + `}`

	got := b.bulk(t, body)

	if o := got.outcomes(); o["changed"] != 1 || o["skipped/slot_taken"] != 2 || o["skipped/not_found"] != 1 {
		t.Errorf("outcomes = %v", o)
	}
	if got.Items[2].TitleID != b.breakingBad || got.Items[2].Outcome != "changed" {
		t.Errorf("Breaking Bad = %+v, want changed", got.Items[2])
	}
	if p := b.profileIn(t, b.breakingBad, "4k"); p != "4k-primary" {
		t.Errorf("Breaking Bad's 4K Version is on %q", p)
	}
	if o := b.bulk(t, body).outcomes(); o["skipped/slot_taken"] != 3 {
		t.Errorf("second call = %v, want 3 taken", o)
	}
}

func TestSearchingInBulkSearchesTheTitlesWantedVersionsNow(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	memento := decode[titleJSON](t, s.valid("POST", "/titles", fmt.Sprintf(addHD, 77))).ID
	s.pass(t, jobs.Search) // the searches on add find nothing
	s.valid("PATCH", fmt.Sprintf("/titles/%d", memento), `{"monitored":false}`)
	s.publish(t, goodRelease)
	s.pass(t, jobs.Search)
	if q := s.queue(t); len(q) != 0 {
		t.Fatalf("the sweep searched before the bulk call: queue = %+v", q)
	}

	r := s.valid("POST", "/titles/bulk", fmt.Sprintf(`{"action":"search","title_ids":[%d,%d,999]}`, s.title, memento))

	if r.Status != 200 {
		t.Fatalf("bulk = %d %s", r.Status, r.Body)
	}
	got := decode[bulkJSON](t, r)
	if o := got.outcomes(); o["changed"] != 1 || o["skipped/nothing_wanted"] != 1 || o["skipped/not_found"] != 1 {
		t.Errorf("outcomes = %v", o)
	}
	if got.Items[0].TitleID != s.title || got.Items[0].Outcome != "changed" {
		t.Errorf("Paddington = %+v, want changed", got.Items[0])
	}
	s.pass(t, jobs.Search)
	if q := s.queue(t); len(q) != 1 || q[0].ReleaseName != goodRelease {
		t.Errorf("queue = %+v, want Paddington grabbed", q)
	}
}

func TestFreezingInBulkFreezesTheTitlesAndASecondCallChangesNothing(t *testing.T) {
	t.Parallel()
	b := newBulkLibrary(t)
	freeze := func(frozen bool) bulkJSON {
		return b.bulk(t, fmt.Sprintf(`{"action":"freeze","frozen":%t,"title_ids":%s}`, frozen, b.ids()))
	}

	if o := freeze(true).outcomes(); o["changed"] != 3 || o["skipped/not_found"] != 1 {
		t.Errorf("freezing = %v", o)
	}
	for _, id := range []int64{b.paddington, b.memento, b.breakingBad} {
		if d := decode[struct {
			Frozen bool `json:"metadata_frozen"`
		}](t, b.valid("GET", fmt.Sprintf("/titles/%d", id), "")); !d.Frozen {
			t.Errorf("Title %d is not frozen", id)
		}
	}
	if o := freeze(true).outcomes(); o["skipped/unchanged"] != 3 {
		t.Errorf("freezing again = %v, want 3 unchanged", o)
	}
	if o := freeze(false).outcomes(); o["changed"] != 3 {
		t.Errorf("unfreezing = %v, want 3 changed", o)
	}
}

func TestRefreshingInBulkRefreshesEachTitleButTheFrozenOnes(t *testing.T) {
	t.Parallel()
	l, meta := newRefreshInstance(t)
	paddington := decode[titleJSON](t, l.valid("POST", "/titles", addPaddington)).ID
	memento := decode[titleJSON](t, l.valid("POST", "/titles", fmt.Sprintf(addHD, 77))).ID
	l.valid("PATCH", fmt.Sprintf("/titles/%d", memento), `{"metadata_frozen":true}`)
	meta.retitled.Store(true)

	r := l.valid("POST", "/titles/bulk", fmt.Sprintf(`{"action":"refresh","title_ids":[%d,%d,999]}`, paddington, memento))

	if r.Status != 200 {
		t.Fatalf("bulk = %d %s", r.Status, r.Body)
	}
	got := decode[bulkJSON](t, r)
	if o := got.outcomes(); o["changed"] != 1 || o["skipped/frozen"] != 1 || o["skipped/not_found"] != 1 {
		t.Errorf("outcomes = %v", o)
	}
	if got.Items[1].TitleID != memento || got.Items[1].Outcome != "skipped" {
		t.Errorf("Memento = %+v, want skipped", got.Items[1])
	}
	eventually(t, "the refresh to apply", func() bool {
		return decode[titleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", paddington), "")).Title == "Paddington Bear"
	})
}

// importPaddington adds Paddington in Standard and imports a nine-byte file for it.
func importPaddington(t *testing.T) (s search, file string) {
	t.Helper()
	s = newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	s.prober.set(goodProbe(), nil)
	s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)
	v := s.version(t, s.hd)
	if v.File == nil {
		t.Fatal("the Version holds no file")
	}
	return s, v.File.Path
}

func TestTheLibraryListGivesEachTitleTheSizeOfItsFiles(t *testing.T) {
	t.Parallel()
	s, _ := importPaddington(t)
	memento := decode[titleJSON](t, s.valid("POST", "/titles", fmt.Sprintf(addHD, 77))).ID

	rows := decode[struct {
		Items []struct {
			ID   int64 `json:"id"`
			Size int64 `json:"size"`
		} `json:"items"`
	}](t, s.valid("GET", "/titles", "")).Items

	sizes := map[int64]int64{}
	for _, r := range rows {
		sizes[r.ID] = r.Size
	}
	detail := decode[struct {
		Versions []struct {
			File *struct {
				Size int64 `json:"size"`
			} `json:"file"`
		} `json:"versions"`
	}](t, s.valid("GET", fmt.Sprintf("/titles/%d", s.title), ""))
	if want := detail.Versions[0].File.Size; want == 0 || sizes[s.title] != want || sizes[memento] != 0 {
		t.Errorf("sizes = %v, want Paddington %d as its file and Memento 0", sizes, want)
	}
}

func TestRemovingTitlesInBulkKeepsTheirFilesUnlessAsked(t *testing.T) {
	t.Parallel()
	for _, deleteFiles := range []bool{false, true} {
		t.Run(fmt.Sprint("delete_files=", deleteFiles), func(t *testing.T) {
			t.Parallel()
			s, file := importPaddington(t)
			memento := decode[titleJSON](t, s.valid("POST", "/titles", fmt.Sprintf(addHD, 77))).ID
			body := fmt.Sprintf(`{"action":"remove","delete_files":%t,"title_ids":[%d,%d,999]}`, deleteFiles, s.title, memento)

			r := s.valid("POST", "/titles/bulk", body)

			if r.Status != 200 {
				t.Fatalf("bulk = %d %s", r.Status, r.Body)
			}
			if o := decode[bulkJSON](t, r).outcomes(); o["changed"] != 2 || o["skipped/not_found"] != 1 {
				t.Errorf("outcomes = %v", o)
			}
			if rows := decode[struct {
				Items []struct{} `json:"items"`
			}](t, s.valid("GET", "/titles", "")).Items; len(rows) != 0 {
				t.Errorf("%d Titles left in the Library", len(rows))
			}
			if _, err := os.Stat(file); (err == nil) == deleteFiles {
				t.Errorf("the file after removing: %v, want it gone only with delete_files", err)
			}
			if o := decode[bulkJSON](t, s.valid("POST", "/titles/bulk", body)).outcomes(); o["skipped/not_found"] != 3 {
				t.Errorf("second call = %v, want 3 not found", o)
			}
		})
	}
}

func TestRemovingThe4KVersionInBulkSkipsTitlesWithoutOne(t *testing.T) {
	t.Parallel()
	b := newBulkLibrary(t)
	body := `{"action":"remove_version","slot":"4k","title_ids":` + b.ids() + `}`

	got := b.bulk(t, body)

	if o := got.outcomes(); o["changed"] != 2 || o["skipped/no_version"] != 1 || o["skipped/not_found"] != 1 {
		t.Errorf("outcomes = %v", o)
	}
	for _, id := range []int64{b.paddington, b.memento} {
		if p := b.profileIn(t, id, "4k"); p != "" {
			t.Errorf("Title %d still has a 4K Version on %q", id, p)
		}
	}
	if p := b.profileIn(t, b.paddington, "standard"); p != "hd-primary" {
		t.Errorf("Paddington's Standard Version is on %q", p)
	}
	if o := b.bulk(t, body).outcomes(); o["skipped/no_version"] != 3 {
		t.Errorf("second call = %v, want 3 without a 4K Version", o)
	}
}

func TestATitleWhoseDownloadCannotBeCanceledFailsToBeRemovedInBulkAndSaysWhy(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.pass(t, jobs.Search)
	if q := s.queue(t); len(q) != 1 {
		t.Fatalf("queue = %+v, want one Grab", q)
	}
	s.setKey(t, s.instanceID(t, "fake"), "rejected")

	r := s.valid("POST", "/titles/bulk", fmt.Sprintf(`{"action":"remove","title_ids":[%d]}`, s.title))

	if r.Status != 200 {
		t.Fatalf("bulk = %d %s", r.Status, r.Body)
	}
	got := decode[bulkJSON](t, r).Items
	if len(got) != 1 || got[0].Outcome != "failed" || got[0].Reason == nil || *got[0].Reason != "download_client" ||
		got[0].Message == nil || !strings.Contains(*got[0].Message, "API key rejected") {
		t.Errorf("items = %+v, want failed as download_client with the client's message", got)
	}
}
