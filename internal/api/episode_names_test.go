package api_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

// tvdbRequests lists the fake TheTVDB's requests whose path contains part.
func tvdbRequests(l library, part string) []string {
	var out []string
	for _, r := range l.tvdb.Requests() {
		if strings.Contains(r, part) {
			out = append(out, r)
		}
	}
	return out
}

func TestAGermanHouseholdSeesEpisodeTitlesInGermanWithTheOriginalTitleKept(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	l.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`)
	created := decode[seriesTitleJSON](t, l.valid("POST", "/titles", addBreakingBad+`}`))

	eps := episodesOf(t, l, created.ID)
	pilot := eps[1]
	if pilot.PrimaryName != "Der Einstieg" || pilot.OriginalName != "Pilot" || pilot.Name != "Pilot" {
		t.Errorf("pilot = %+v, want the German title with the original kept", pilot)
	}
	if grilled := eps[5]; grilled.PrimaryName != "Gegrillt" || grilled.OriginalName != "Grilled" {
		t.Errorf("an episode of the second page = %+v", grilled)
	}
	// TheTVDB has no German title for this one: the original stands in.
	if untranslated := eps[3]; untranslated.PrimaryName != "...And the Bag's in the River" || untranslated.OriginalName != untranslated.PrimaryName {
		t.Errorf("untranslated = %+v", untranslated)
	}
	if got := tvdbRequests(l, "/episodes/official/deu"); len(got) != 2 {
		t.Errorf("German episode requests = %v, want one per page", got)
	}
}

func TestAMissingTranslationFallsBackToTheOriginalTitle(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	l.valid("PATCH", "/settings", `{"language_region":{"primary_language":"fr"}}`)
	r := l.valid("POST", "/titles", addBreakingBad+`}`)
	if r.Status != 201 {
		t.Fatalf("POST /titles = %d %s, want the add to survive TheTVDB having no French list", r.Status, r.Body)
	}
	created := decode[seriesTitleJSON](t, r)

	pilot := episodesOf(t, l, created.ID)[1]
	if pilot.PrimaryName != "Pilot" || pilot.OriginalName != "Pilot" {
		t.Errorf("pilot = %+v", pilot)
	}
	if got := tvdbRequests(l, "/episodes/official/fra"); len(got) != 1 {
		t.Errorf("French episode requests = %v", got)
	}
}

func TestASeriesInThePrimaryLanguageAsksForNoTranslation(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	created := decode[seriesTitleJSON](t, l.valid("POST", "/titles", addBreakingBad+`}`))

	pilot := episodesOf(t, l, created.ID)[1]
	if pilot.PrimaryName != "Pilot" || pilot.OriginalName != "Pilot" {
		t.Errorf("pilot = %+v", pilot)
	}
	if got := tvdbRequests(l, "/episodes/official/"); len(got) != 0 {
		t.Errorf("translation requests = %v, want none for an English Series in an English household", got)
	}
}

func TestARefreshFetchesEpisodeTitlesInANewPrimaryLanguage(t *testing.T) {
	t.Parallel()
	l, _ := newRefreshInstance(t)
	created := decode[seriesTitleJSON](t, l.valid("POST", "/titles", addBreakingBad+`}`))
	l.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`)

	if r := l.valid("POST", fmt.Sprintf("/titles/%d/refresh", created.ID), ""); r.Status != 202 {
		t.Fatalf("POST refresh = %d %s", r.Status, r.Body)
	}
	eventually(t, "the German episode titles", func() bool {
		pilot := episodesOf(t, l, created.ID)[1]
		return pilot.PrimaryName == "Der Einstieg" && pilot.OriginalName == "Pilot"
	})
}

func TestAddingASeriesSurvivesTheTranslatedTitlesFailingAndKeepsTheOriginalOnes(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	l.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`)
	l.tvdb.FailTranslations()

	r := l.valid("POST", "/titles", addBreakingBad+`}`)

	if r.Status != 201 {
		t.Fatalf("POST /titles = %d %s, want the add to survive TheTVDB failing the German titles", r.Status, r.Body)
	}
	created := decode[seriesTitleJSON](t, r)
	if pilot := episodesOf(t, l, created.ID)[1]; pilot.PrimaryName != "Pilot" || pilot.OriginalName != "Pilot" {
		t.Errorf("pilot = %+v, want the original title standing in", pilot)
	}
}
