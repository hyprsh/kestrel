package metadata_test

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

func newTMDB(t *testing.T, key string) (*metadata.TMDB, *metadatatest.Server) {
	t.Helper()
	srv := metadatatest.New(t)
	return metadata.NewTMDB(metadata.TMDBOptions{BaseURL: srv.APIBase(), Keys: metadata.StaticKey(key)}), srv
}

func TestSearchFindsMoviesAndSeriesAndSkipsPeople(t *testing.T) {
	tm, srv := newTMDB(t, metadatatest.Key)
	got, err := tm.Search(context.Background(), "paddington")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d results, want a movie and a series: %+v", len(got), got)
	}
	m, s := got[0], got[1]
	if m.Kind != metadata.Movie || m.TMDBID != 116149 || m.Title != "Paddington" || m.Year != 2014 || m.PosterPath != "/pyFVnLq1sG1jdXZQhxNdCP0DLg3.jpg" {
		t.Errorf("movie = %+v", m)
	}
	if s.Kind != metadata.Series || s.TMDBID != 61814 || s.Title != "The Adventures of Paddington Bear" || s.Year != 1997 {
		t.Errorf("series = %+v", s)
	}
	req := srv.Requests()[0]
	for _, want := range []string{"/3/search/multi?", "query=paddington", "language=en-US", "include_adult=false"} {
		if !strings.Contains(req, want) {
			t.Errorf("request %q lacks %q", req, want)
		}
	}
}

func TestMovieDetails(t *testing.T) {
	tm, srv := newTMDB(t, metadatatest.Key)
	d, err := tm.Movie(context.Background(), 116149)
	if err != nil {
		t.Fatal(err)
	}
	if d.TMDBID != 116149 || d.IMDbID != "tt1109624" || d.Title != "Paddington" || d.OriginalTitle != "Paddington" ||
		d.OriginalLanguage != "en" || d.Year != 2014 || d.Runtime != 95 || d.PosterPath != "/pyFVnLq1sG1jdXZQhxNdCP0DLg3.jpg" {
		t.Errorf("details = %+v", d)
	}
	if got := d.TitleIn("de"); got != "Ein Bär namens Paddington" {
		t.Errorf("German title = %q", got)
	}
	if got := d.TitleIn("fr"); got != "" {
		t.Errorf("an empty translation is no title, got %q", got)
	}
	var aliases []string
	for _, a := range d.Aliases {
		aliases = append(aliases, a.Country+":"+a.Title)
	}
	if strings.Join(aliases, "|") != "DE:Paddington (2014)|FR:Paddington, l'ours" {
		t.Errorf("aliases = %v", aliases)
	}
	if len(d.ReleaseDates) != 9 {
		t.Errorf("%d release dates, want all 9 across US, DE and GB", len(d.ReleaseDates))
	}
	req := srv.Requests()[0]
	if !strings.Contains(req, "append_to_response=release_dates%2Calternative_titles%2Ctranslations%2Cexternal_ids") {
		t.Errorf("request %q does not append everything in one call", req)
	}
}

func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

func TestReleaseDatesUseTheCountryThenTheUSThenTheEarliestAnywhere(t *testing.T) {
	tm, _ := newTMDB(t, metadatatest.Key)
	pad, err := tm.Movie(context.Background(), 116149)
	if err != nil {
		t.Fatal(err)
	}
	lost, err := tm.Movie(context.Background(), 77)
	if err != nil {
		t.Fatal(err)
	}

	// The country's own date wins.
	if got, ok := pad.ReleaseDates.Date(metadata.Theatrical, "DE"); !ok || !got.Equal(day(2015, 1, 22)) {
		t.Errorf("DE theatrical = %v %v", got, ok)
	}
	// Germany has no digital release: the US one stands in.
	if got, ok := pad.ReleaseDates.Date(metadata.Digital, "DE"); !ok || !got.Equal(day(2015, 4, 14)) {
		t.Errorf("DE digital falls back to the US, got %v %v", got, ok)
	}
	// Neither Germany nor the US has a TV date: the earliest anywhere (GB) stands in.
	if got, ok := pad.ReleaseDates.Date(metadata.TV, "DE"); !ok || !got.Equal(day(2015, 3, 23)) {
		t.Errorf("DE TV falls back to the earliest anywhere, got %v %v", got, ok)
	}
	// The Lost Film: no DE, no US theatrical; FR (May) beats JP (July).
	if got, ok := lost.ReleaseDates.Date(metadata.Theatrical, "DE"); !ok || !got.Equal(day(2020, 5, 1)) {
		t.Errorf("earliest anywhere = %v %v", got, ok)
	}
	if _, ok := lost.ReleaseDates.Date(metadata.Physical, "DE"); ok {
		t.Error("a type nobody released has no date")
	}

	// Released is the earliest digital or physical date; the US digital date is April 14.
	if got, ok := pad.ReleaseDates.Released("US"); !ok || !got.Equal(day(2015, 4, 14)) {
		t.Errorf("US released = %v %v", got, ok)
	}
	// Germany has its own physical date (June 18): the US digital date does not stand in for it.
	if got, ok := pad.ReleaseDates.Released("DE"); !ok || !got.Equal(day(2015, 6, 18)) {
		t.Errorf("DE released = %v %v", got, ok)
	}
}

func TestReleasedIsTheEarliestHomeDateElseTheatricalPlus90Days(t *testing.T) {
	d := func(y int, m time.Month, dd int) time.Time { return time.Date(y, m, dd, 0, 0, 0, 0, time.UTC) }
	cases := []struct {
		name  string
		dates metadata.ReleaseDates
		want  time.Time
		ok    bool
	}{
		{"digital beats a later physical", metadata.ReleaseDates{
			{Country: "DE", Type: metadata.Theatrical, Date: d(2020, 1, 1)},
			{Country: "DE", Type: metadata.Physical, Date: d(2020, 5, 1)},
			{Country: "DE", Type: metadata.Digital, Date: d(2020, 4, 1)},
		}, d(2020, 4, 1), true},
		{"the home date wins even when it is later than theatrical plus 90 days", metadata.ReleaseDates{
			{Country: "DE", Type: metadata.Theatrical, Date: d(2020, 1, 1)},
			{Country: "DE", Type: metadata.Digital, Date: d(2020, 8, 1)},
		}, d(2020, 8, 1), true},
		{"theatrical alone is released 90 days later", metadata.ReleaseDates{
			{Country: "DE", Type: metadata.Theatrical, Date: d(2020, 1, 1)},
		}, d(2020, 3, 31), true},
		{"the earlier of limited and wide theatrical counts", metadata.ReleaseDates{
			{Country: "DE", Type: metadata.TheatricalLimited, Date: d(2020, 1, 1)},
			{Country: "DE", Type: metadata.Theatrical, Date: d(2020, 2, 1)},
		}, d(2020, 3, 31), true},
		{"a TV date stands as it is", metadata.ReleaseDates{{Country: "DE", Type: metadata.TV, Date: d(2020, 1, 1)}}, d(2020, 1, 1), true},
		{"no dates is unknown", nil, time.Time{}, false},
		{"the household's country decides: its theatrical date counts even when the US has a home date", metadata.ReleaseDates{
			{Country: "DE", Type: metadata.Theatrical, Date: d(2020, 1, 1)},
			{Country: "US", Type: metadata.Digital, Date: d(2020, 2, 1)},
		}, d(2020, 3, 31), true},
		{"a country with no dates at all falls back to the US", metadata.ReleaseDates{
			{Country: "FR", Type: metadata.Digital, Date: d(2020, 2, 1)},
			{Country: "US", Type: metadata.Digital, Date: d(2020, 6, 1)},
		}, d(2020, 6, 1), true},
		{"with neither the country nor the US, the earliest anywhere", metadata.ReleaseDates{
			{Country: "JP", Type: metadata.Digital, Date: d(2020, 7, 1)},
			{Country: "FR", Type: metadata.Theatrical, Date: d(2020, 1, 1)},
		}, d(2020, 7, 1), true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := c.dates.Released("DE")
			if ok != c.ok || !got.Equal(c.want) {
				t.Fatalf("Released = %v %v, want %v %v", got, ok, c.want, c.ok)
			}
		})
	}
}

func TestCertificationUsesTheCountryThenTheUSThenTheEarliestAnywhere(t *testing.T) {
	tm, _ := newTMDB(t, metadatatest.Key)
	pad, _ := tm.Movie(context.Background(), 116149)
	lost, _ := tm.Movie(context.Background(), 77)

	for _, c := range []struct {
		name         string
		d            metadata.MovieDetails
		country      string
		wantCountry  string
		wantCert     string
		wantFallback bool
	}{
		{"own country", pad, "DE", "DE", "0", false},
		{"US when the country has none", pad, "FR", "US", "PG", true},
		{"a blank certification is none: GB's TV entry is skipped", pad, "GB", "GB", "PG", false},
		{"the US, though the Movie premiered in France", lost, "DE", "US", "PG-13", true},
		{"earliest anywhere when the US has none either", metadata.MovieDetails{ReleaseDates: metadata.ReleaseDates{
			{Country: "JP", Type: metadata.Theatrical, Date: day(2020, 7, 1), Certification: "G"},
			{Country: "FR", Type: metadata.Theatrical, Date: day(2020, 5, 1), Certification: "U"},
			{Country: "US", Type: metadata.Digital, Date: day(2021, 1, 1)},
		}}, "DE", "FR", "U", true},
	} {
		country, cert := c.d.ReleaseDates.Certification(c.country)
		if country != c.wantCountry || cert != c.wantCert {
			t.Errorf("%s: got %s %q, want %s %q", c.name, country, cert, c.wantCountry, c.wantCert)
		}
	}
}

func TestErrorsCarryAStableCode(t *testing.T) {
	ctx := context.Background()
	tm, _ := newTMDB(t, "wrong-key")
	_, err := tm.Search(ctx, "paddington")
	var me *metadata.Error
	if !errors.As(err, &me) || me.Code != metadata.CodeAuth {
		t.Errorf("a refused key = %v, want code auth", err)
	}

	tm, _ = newTMDB(t, metadatatest.Key)
	_, err = tm.Movie(ctx, 424242)
	if !errors.As(err, &me) || me.Code != metadata.CodeNotFound {
		t.Errorf("unknown movie = %v, want code not_found", err)
	}

	tm = metadata.NewTMDB(metadata.TMDBOptions{BaseURL: "http://127.0.0.1:1", Keys: metadata.StaticKey("k")})
	_, err = tm.Search(ctx, "x")
	if !errors.As(err, &me) || me.Code != metadata.CodeUnavailable {
		t.Errorf("unreachable = %v, want code unavailable", err)
	}
}

func TestRateLimitIsReportedWithRetryAfter(t *testing.T) {
	srv := metadatatest.New(t)
	limited := metadata.NewTMDB(metadata.TMDBOptions{
		BaseURL: srv.APIBase(),
		Keys:    metadata.StaticKey(metadatatest.Key),
		HTTP: &http.Client{Transport: roundTripper(func(*http.Request) (*http.Response, error) {
			h := http.Header{}
			h.Set("Retry-After", "7")
			return &http.Response{StatusCode: 429, Header: h, Body: http.NoBody}, nil
		})},
	})
	_, err := limited.Search(context.Background(), "x")
	var me *metadata.Error
	if !errors.As(err, &me) || me.Code != metadata.CodeRateLimited || me.RetryAfter != 7*time.Second {
		t.Errorf("429 = %v", err)
	}
}

type roundTripper func(*http.Request) (*http.Response, error)

func (f roundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestNoKeyAnywhereIsAnAuthError(t *testing.T) {
	tm, srv := newTMDB(t, "")
	_, err := tm.Search(context.Background(), "paddington")
	var me *metadata.Error
	if !errors.As(err, &me) || me.Code != metadata.CodeAuth {
		t.Errorf("no key = %v, want code auth", err)
	}
	if n := len(srv.Requests()); n != 0 {
		t.Errorf("%d requests went out with no key", n)
	}
}
