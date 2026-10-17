// Package conformance is the indexer.v1 conformance suite. Every adapter, and
// the in-memory fake, runs it with Run. It is the executable definition of the
// contract: a behaviour the host relies on is asserted here, once, for all
// implementations.
package conformance

import (
	"bytes"
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/plugintest"
)

// Backend lets the suite move the indexer's side of the world along. An adapter
// test implements it over its fake server; the in-memory fake implements it directly.
type Backend interface {
	// Publish makes the indexer offer r, with nzb behind its download URL. The
	// indexer assigns GUID and DownloadURL; r's other fields are what it serves.
	Publish(r indexer.Release, nzb []byte) error
	// Remove takes the release titled title off the indexer, so its NZB is gone.
	Remove(title string)
	// Exhaust spends a budget: until Replenish, requests of that kind (plugin.LimitSearch
	// or plugin.LimitGrab) are refused with retryAfter as the indexer's wait (0 for none).
	Exhaust(limit string, retryAfter time.Duration)
	// Replenish clears every spent budget.
	Replenish()
}

// Subject is what the suite exercises.
type Subject struct {
	Indexer indexer.Indexer
	// Conn reaches a working indexer.
	Conn plugin.Connection
	// BadAuth reaches the same indexer but with credentials it rejects.
	BadAuth plugin.Connection
	// Unreachable points at nothing listening.
	Unreachable plugin.Connection
	Backend     Backend
}

var nzb = []byte(`<?xml version="1.0"?><nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"><file subject="x"/></nzb>`)

var published = time.Date(2025, 3, 4, 5, 6, 7, 0, time.UTC)

// Run runs the whole suite against s.
func Run(t *testing.T, s Subject) {
	ctx := context.Background()
	code := func(t *testing.T, err error, want plugin.Code) *plugin.Error {
		t.Helper()
		if err == nil {
			t.Fatalf("want a %s error, got none", want)
		}
		var pe *plugin.Error
		if !errors.As(err, &pe) {
			t.Fatalf("want *plugin.Error, got %T: %v", err, err)
		}
		if pe.Code != want {
			t.Fatalf("want code %s, got %s (%s)", want, pe.Code, pe.Message)
		}
		return pe
	}
	publish := func(t *testing.T, r indexer.Release, data []byte) {
		t.Helper()
		if err := s.Backend.Publish(r, data); err != nil {
			t.Fatalf("Publish: %v", err)
		}
	}
	search := func(t *testing.T, q indexer.SearchQuery) []indexer.Release {
		t.Helper()
		res, err := s.Indexer.Search(ctx, s.Conn, q)
		if err != nil {
			t.Fatalf("Search %+v: %v", q, err)
		}
		return res.Releases
	}
	titled := func(rs []indexer.Release, title string) (indexer.Release, bool) {
		for _, r := range rs {
			if r.Title == title {
				return r, true
			}
		}
		return indexer.Release{}, false
	}
	t.Cleanup(s.Backend.Replenish)

	t.Run("manifest describes a valid usenet indexer", func(t *testing.T) {
		m := s.Indexer.Describe()
		if err := m.Validate(); err != nil {
			t.Fatal(err)
		}
		if m.Contract != indexer.Contract.ID {
			t.Fatalf("contract %q", m.Contract)
		}
		if !reflect.DeepEqual(m.Capabilities["protocols"], []string{"usenet"}) {
			t.Fatalf("capabilities.protocols %v", m.Capabilities["protocols"])
		}
		for _, f := range m.Fields {
			if f.Live {
				t.Errorf("field %q is live but ListOptions is not part of an indexer", f.Key)
			}
		}
	})

	t.Run("Test passes for good credentials and says why it fails otherwise", func(t *testing.T) {
		if _, err := s.Indexer.Test(ctx, s.Conn); err != nil {
			t.Fatalf("Test: %v", err)
		}
		_, err := s.Indexer.Test(ctx, s.BadAuth)
		code(t, err, plugin.CodeAuth)
		_, err = s.Indexer.Test(ctx, s.Unreachable)
		code(t, err, plugin.CodeUnavailable)
	})

	t.Run("ListOptions has no live fields", func(t *testing.T) {
		_, err := s.Indexer.ListOptions(ctx, s.Conn, "anything")
		code(t, err, plugin.CodeInvalid)
	})

	t.Run("Caps reports the page size and the searches it offers", func(t *testing.T) {
		c, err := s.Indexer.Caps(ctx, s.Conn)
		if err != nil {
			t.Fatal(err)
		}
		if c.PageSize <= 0 || c.MaxPageSize < c.PageSize {
			t.Errorf("page size %d, max %d", c.PageSize, c.MaxPageSize)
		}
		if !c.Movie.Available || !c.TV.Available || !c.Text.Available {
			t.Errorf("searches offered: %+v", c)
		}
		if len(c.Categories) == 0 {
			t.Error("no categories")
		}
	})

	t.Run("a Movie is found by IMDb id, TMDB id and text, with everything the indexer knows", func(t *testing.T) {
		want := indexer.Release{
			Title: "Conformance.Movie.2025.1080p.WEB-DL-GRP", PublishDate: published, Size: 4_000_000_000,
			Categories: []int{2040}, IMDBID: "tt0133093", TMDBID: 603, Languages: []string{"English", "German"},
			Grabs: 12, Scene: true, Password: 0, Group: "alt.binaries.movies",
		}
		publish(t, want, nzb)
		other := indexer.Release{Title: "Another.Movie.1999.720p.BluRay-GRP", PublishDate: published, Size: 1, Categories: []int{2040}, IMDBID: "tt0000001"}
		publish(t, other, nzb)

		for name, q := range map[string]indexer.SearchQuery{
			"imdb": {Media: indexer.MediaMovie, Mode: indexer.ModeIDs, IMDBID: "tt0133093"},
			"tmdb": {Media: indexer.MediaMovie, Mode: indexer.ModeIDs, TMDBID: 603},
			"text": {Media: indexer.MediaMovie, Mode: indexer.ModeText, Text: "Conformance Movie 2025"},
		} {
			got, ok := titled(search(t, q), want.Title)
			if !ok {
				t.Errorf("%s search did not find the release", name)
				continue
			}
			if _, leaked := titled(search(t, q), other.Title); leaked && name != "text" {
				t.Errorf("%s search returned an unrelated release", name)
			}
			if got.GUID == "" || got.DownloadURL == "" {
				t.Errorf("%s: guid %q download url %q", name, got.GUID, got.DownloadURL)
			}
			if !got.PublishDate.Equal(want.PublishDate) || got.Size != want.Size || got.IMDBID != want.IMDBID ||
				got.Grabs != want.Grabs || !got.Scene || got.Group != want.Group ||
				!reflect.DeepEqual(got.Categories, want.Categories) || !reflect.DeepEqual(got.Languages, want.Languages) {
				t.Errorf("%s: release lost data:\n got %+v\nwant %+v", name, got, want)
			}
		}
	})

	t.Run("a Series search narrows by TVDB id, season and episode", func(t *testing.T) {
		mk := func(title, season, episode string) indexer.Release {
			return indexer.Release{Title: title, PublishDate: published, Size: 1, Categories: []int{5040}, TVDBID: 81189, Season: season, Episode: episode}
		}
		publish(t, mk("Conf.Show.S01E01.1080p", "1", "1"), nzb)
		publish(t, mk("Conf.Show.S01E02.1080p", "1", "2"), nzb)
		publish(t, mk("Conf.Show.S02E01.1080p", "2", "1"), nzb)
		publish(t, mk("Conf.Show.S00E01.Special.1080p", "0", "1"), nzb)

		base := indexer.SearchQuery{Media: indexer.MediaTV, Mode: indexer.ModeIDs, TVDBID: 81189}
		count := func(season, episode string) map[string]bool {
			q := base
			q.Season, q.Episode = season, episode
			out := map[string]bool{}
			for _, r := range search(t, q) {
				out[r.Title] = true
			}
			return out
		}
		if got := count("", ""); len(got) != 4 {
			t.Errorf("whole series: %v", got)
		}
		if got := count("1", ""); len(got) != 2 || !got["Conf.Show.S01E01.1080p"] || !got["Conf.Show.S01E02.1080p"] {
			t.Errorf("season 1 pack: %v", got)
		}
		if got := count("1", "2"); len(got) != 1 || !got["Conf.Show.S01E02.1080p"] {
			t.Errorf("S01E02: %v", got)
		}
		if got := count("0", ""); len(got) != 1 || !got["Conf.Show.S00E01.Special.1080p"] {
			t.Errorf("specials: %v", got)
		}
	})

	t.Run("RSS lists the newest releases of the media first and pages", func(t *testing.T) {
		for i, name := range []string{"Rss.Old.2020.1080p", "Rss.Mid.2020.1080p", "Rss.New.2020.1080p"} {
			publish(t, indexer.Release{Title: name, PublishDate: published.Add(time.Duration(i+1) * 24 * time.Hour), Size: 1, Categories: []int{2040}}, nzb)
		}
		publish(t, indexer.Release{Title: "Rss.Show.S01E01.1080p", PublishDate: published.Add(time.Hour), Size: 1, Categories: []int{5040}, Season: "1", Episode: "1"}, nzb)

		movies := search(t, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeRSS})
		for i := 1; i < len(movies); i++ {
			if movies[i].PublishDate.After(movies[i-1].PublishDate) {
				t.Fatalf("RSS is not newest first: %v then %v", movies[i-1].PublishDate, movies[i].PublishDate)
			}
		}
		if _, ok := titled(movies, "Rss.New.2020.1080p"); !ok {
			t.Error("newest release missing")
		}
		if _, tv := titled(movies, "Rss.Show.S01E01.1080p"); tv {
			t.Error("a Series release is in the Movie feed")
		}
		if movies[0].Title != "Rss.New.2020.1080p" {
			t.Errorf("first is %q", movies[0].Title)
		}

		page := search(t, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeRSS, Limit: 1, Offset: 1})
		if len(page) != 1 || page[0].GUID != movies[1].GUID {
			t.Errorf("offset 1 limit 1 returned %+v, want the second release", page)
		}
		tv := search(t, indexer.SearchQuery{Media: indexer.MediaTV, Mode: indexer.ModeRSS})
		if _, ok := titled(tv, "Rss.Show.S01E01.1080p"); !ok {
			t.Error("Series feed misses a Series release")
		}
	})

	t.Run("Categories on the query override the instance's", func(t *testing.T) {
		publish(t, indexer.Release{Title: "Cat.Movie.UHD.2025.2160p", PublishDate: published, Size: 1, Categories: []int{2045}}, nzb)
		in := search(t, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeText, Text: "Cat Movie UHD", Categories: []int{2045}})
		if _, ok := titled(in, "Cat.Movie.UHD.2025.2160p"); !ok {
			t.Error("not found in its own category")
		}
		out := search(t, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeText, Text: "Cat Movie UHD", Categories: []int{2030}})
		if _, ok := titled(out, "Cat.Movie.UHD.2025.2160p"); ok {
			t.Error("found in a category it is not in")
		}
	})

	t.Run("Fetch returns the NZB behind a release", func(t *testing.T) {
		publish(t, indexer.Release{Title: "Fetch.Me.2025.1080p", PublishDate: published, Size: 1, Categories: []int{2040}}, nzb)
		r, ok := titled(search(t, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeText, Text: "Fetch Me"}), "Fetch.Me.2025.1080p")
		if !ok {
			t.Fatal("not found")
		}
		got, err := s.Indexer.Fetch(ctx, s.Conn, r.DownloadURL)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, nzb) {
			t.Errorf("got %q", got)
		}
	})

	t.Run("Fetch of a release the indexer no longer has is not_found", func(t *testing.T) {
		publish(t, indexer.Release{Title: "Gone.2025.1080p", PublishDate: published, Size: 1, Categories: []int{2040}}, nzb)
		r, _ := titled(search(t, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeText, Text: "Gone"}), "Gone.2025.1080p")
		s.Backend.Remove("Gone.2025.1080p")
		_, err := s.Indexer.Fetch(ctx, s.Conn, r.DownloadURL)
		code(t, err, plugin.CodeNotFound)
	})

	t.Run("a spent request budget is rate_limited for search, with the wait", func(t *testing.T) {
		s.Backend.Exhaust(plugin.LimitSearch, 90*time.Second)
		defer s.Backend.Replenish()
		_, err := s.Indexer.Search(ctx, s.Conn, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeRSS})
		pe := code(t, err, plugin.CodeRateLimited)
		if pe.Limit != plugin.LimitSearch || pe.RetryAfter != 90*time.Second {
			t.Errorf("limit %q retry after %v", pe.Limit, pe.RetryAfter)
		}
	})

	t.Run("a spent request budget with no stated wait leaves RetryAfter zero", func(t *testing.T) {
		s.Backend.Exhaust(plugin.LimitSearch, 0)
		defer s.Backend.Replenish()
		_, err := s.Indexer.Search(ctx, s.Conn, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeRSS})
		pe := code(t, err, plugin.CodeRateLimited)
		if pe.Limit != plugin.LimitSearch || pe.RetryAfter != 0 {
			t.Errorf("limit %q retry after %v", pe.Limit, pe.RetryAfter)
		}
	})

	t.Run("a spent download budget is rate_limited for grab and leaves search working", func(t *testing.T) {
		publish(t, indexer.Release{Title: "Budget.2025.1080p", PublishDate: published, Size: 1, Categories: []int{2040}}, nzb)
		r, _ := titled(search(t, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeText, Text: "Budget"}), "Budget.2025.1080p")
		s.Backend.Exhaust(plugin.LimitGrab, 2*time.Minute)
		defer s.Backend.Replenish()
		_, err := s.Indexer.Fetch(ctx, s.Conn, r.DownloadURL)
		pe := code(t, err, plugin.CodeRateLimited)
		if pe.Limit != plugin.LimitGrab || pe.RetryAfter != 2*time.Minute {
			t.Errorf("limit %q retry after %v", pe.Limit, pe.RetryAfter)
		}
		if _, err := s.Indexer.Search(ctx, s.Conn, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeRSS}); err != nil {
			t.Errorf("search while only grabs are limited: %v", err)
		}
	})

	t.Run("calls with bad credentials fail with auth", func(t *testing.T) {
		// Some indexers serve caps to anyone; searching is what must be refused.
		_, err := s.Indexer.Search(ctx, s.BadAuth, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeRSS})
		code(t, err, plugin.CodeAuth)
	})

	t.Run("an unreachable indexer is unavailable", func(t *testing.T) {
		_, err := s.Indexer.Search(ctx, s.Unreachable, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeRSS})
		code(t, err, plugin.CodeUnavailable)
		_, err = s.Indexer.Caps(ctx, s.Unreachable)
		code(t, err, plugin.CodeUnavailable)
	})

	t.Run("a search that cannot be asked is invalid", func(t *testing.T) {
		_, err := s.Indexer.Search(ctx, s.Conn, indexer.SearchQuery{Media: "music", Mode: indexer.ModeText, Text: "x"})
		code(t, err, plugin.CodeInvalid)
		_, err = s.Indexer.Search(ctx, s.Conn, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeText})
		code(t, err, plugin.CodeInvalid)
	})

	// ADR 0008: every contract type must survive JSON, so a plugin can leave the process later.
	plugintest.RoundTrip[indexer.Caps](t)
	plugintest.RoundTrip[indexer.SearchQuery](t)
	plugintest.RoundTrip[indexer.SearchResult](t)
	plugintest.RoundTrip[indexer.Release](t)
	plugintest.RoundTrip[plugin.Manifest](t)
	plugintest.RoundTrip[plugin.Connection](t)
	plugintest.RoundTrip[plugin.Error](t)
	plugintest.RoundTrip[plugin.TestResult](t)
	plugintest.RoundTrip[plugin.Option](t)
}
