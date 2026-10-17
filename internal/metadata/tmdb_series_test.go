package metadata_test

import (
	"context"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

func TestSeriesDetails(t *testing.T) {
	tm, srv := newTMDB(t, metadatatest.Key)
	d, err := tm.Series(context.Background(), 1396)
	if err != nil {
		t.Fatal(err)
	}
	if d.TMDBID != 1396 || d.TVDBID != 81189 || d.IMDbID != "tt0903747" || d.Title != "Breaking Bad" || d.OriginalLanguage != "en" ||
		d.Year != 2008 || d.Runtime != 47 || d.PosterPath != "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg" {
		t.Errorf("details = %+v", d)
	}
	if got := d.TitleIn("de"); got != "Breaking Bad Deutsch" {
		t.Errorf("German title = %q", got)
	}
	if got := d.TitleIn("fr"); got != "" {
		t.Errorf("an empty translation is no title, got %q", got)
	}
	if len(d.Aliases) != 1 || d.Aliases[0].Country != "DE" || d.Aliases[0].Title != "Breaking Bad - Total verhext" {
		t.Errorf("aliases = %+v", d.Aliases)
	}
	if c, cert := d.Ratings.Certification("DE"); c != "DE" || cert != "16" {
		t.Errorf("DE rating = %q %q", c, cert)
	}
	if c, cert := d.Ratings.Certification("FR"); c != "US" || cert != "TV-MA" {
		t.Errorf("FR falls back to the US rating, got %q %q", c, cert)
	}
	req := srv.Requests()[0]
	for _, want := range []string{"/3/tv/1396?", "append_to_response=external_ids%2Calternative_titles%2Ctranslations%2Ccontent_ratings"} {
		if !strings.Contains(req, want) {
			t.Errorf("request %q lacks %q", req, want)
		}
	}
}

func TestSeriesWithoutATVDBID(t *testing.T) {
	tm, _ := newTMDB(t, metadatatest.Key)
	d, err := tm.Series(context.Background(), 9001)
	if err != nil {
		t.Fatal(err)
	}
	if d.TVDBID != 0 {
		t.Errorf("tvdb id = %d, want none", d.TVDBID)
	}
}

func TestSeriesExternalIDs(t *testing.T) {
	tm, _ := newTMDB(t, metadatatest.Key)
	ids, err := tm.SeriesExternalIDs(context.Background(), 7001)
	if err != nil {
		t.Fatal(err)
	}
	if ids.TVDBID != 0 || ids.IMDbID != "tt7777777" {
		t.Errorf("ids = %+v", ids)
	}
	ids, err = tm.SeriesExternalIDs(context.Background(), 1396)
	if err != nil || ids.TVDBID != 81189 {
		t.Errorf("ids = %+v, %v", ids, err)
	}
}

var _ metadata.Provider = (*metadata.TMDB)(nil)
