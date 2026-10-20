package scoring_test

import (
	"github.com/hyprsh/kestrel/internal/slot"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// gateSnapshot has no Custom Formats: scores are 0, so only the gates decide.
func gateSnapshot(t testing.TB) *scoring.Snapshot {
	return newFakeSnapshot().load(t)
}

func verdict(t testing.TB, spec scoring.ProfileSpec, name string, title scoring.Title, tweak func(*scoring.Release)) scoring.Verdict {
	t.Helper()
	prof, err := gateSnapshot(t).Profile(spec)
	if err != nil {
		t.Fatal(err)
	}
	rel := scoring.Release{Parsed: mustMovie(t, name)}
	if tweak != nil {
		tweak(&rel)
	}
	return scoring.Evaluate(rel, title, prof)
}

func rejections(v scoring.Verdict) []scoring.Rejection { return v.Rejections }

var (
	germanHD = scoring.ProfileSpec{Slot: slot.Standard, Rule: scoring.PrimaryLanguage, Primary: release.LangGerman}
	titleEN  = scoring.Title{Name: "A Movie", OriginalLanguage: release.LangEnglish}
	titleDE  = scoring.Title{Name: "Ein Film", OriginalLanguage: release.LangGerman}
)

const (
	nameEnglish1080 = "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-GRP"
	nameGermanDL    = "A.Movie.2020.German.DL.1080p.WEB-DL.DD5.1.H264-GRP"
	nameGermanOnly  = "A.Movie.2020.German.1080p.WEB-DL.DD5.1.H264-GRP"
)

func TestPrimaryLanguageProfileNeedsThePrimaryAudio(t *testing.T) {
	cases := []struct {
		name  string
		spec  scoring.ProfileSpec
		rel   string
		title scoring.Title
		want  []scoring.Rejection
	}{
		{"German profile, German release", germanHD, nameGermanOnly, titleEN, nil},
		{"German profile, German DL release", germanHD, nameGermanDL, titleEN, nil},
		{"German profile rejects an English release", germanHD, nameEnglish1080, titleEN, []scoring.Rejection{scoring.RejectLanguage}},
		{"English profile, untagged release of an English Title",
			englishHD, nameEnglish1080, titleEN, nil},
		{"English profile rejects a German-only release of an English Title",
			englishHD, nameGermanOnly, titleEN, []scoring.Rejection{scoring.RejectLanguage}},
		{"French profile, French release",
			scoring.ProfileSpec{Slot: slot.Standard, Rule: scoring.PrimaryLanguage, Primary: release.LangFrench},
			"A.Movie.2020.TRUEFRENCH.1080p.WEB-DL.DD5.1.H264-GRP", titleEN, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v := verdict(t, tc.spec, tc.rel, tc.title, nil)
			if !reflect.DeepEqual(rejections(v), tc.want) {
				t.Errorf("rejections = %v, want %v (languages %v)", v.Rejections, tc.want, v.Languages)
			}
			if v.Accepted != (len(tc.want) == 0) {
				t.Errorf("Accepted = %v with rejections %v", v.Accepted, v.Rejections)
			}
		})
	}
}

func TestOriginalLanguageFallback(t *testing.T) {
	withFallback := germanHD
	withFallback.Original = scoring.OriginalAccept

	// An English Title, only English audio: German Profile accepts it with the
	// fallback, rejects it without.
	if v := verdict(t, withFallback, nameEnglish1080, titleEN, nil); !v.Accepted {
		t.Errorf("fallback on: rejected %v", v.Rejections)
	}
	if v := verdict(t, germanHD, nameEnglish1080, titleEN, nil); v.Accepted {
		t.Error("fallback off: accepted an English release under a German Profile")
	}
	// The fallback does not make a release of some other language acceptable.
	if v := verdict(t, withFallback, "A.Movie.2020.FRENCH.1080p.WEB-DL.DD5.1.H264-GRP", titleEN, nil); v.Accepted {
		t.Error("fallback accepted a French release of an English Title")
	}
	// No effect when Original equals Primary: a Title originally in German
	// needs German audio either way.
	if v := verdict(t, withFallback, nameEnglish1080, titleDE, func(r *scoring.Release) {
		r.IndexerLanguages = []release.Language{release.LangEnglish}
	}); v.Accepted {
		t.Error("fallback changed the outcome although Original == Primary")
	}
	// No effect when Original is unknown.
	if v := verdict(t, withFallback, nameEnglish1080, scoring.Title{Name: "A Movie"}, nil); v.Accepted {
		t.Error("fallback accepted a release of a Title with unknown Original Language")
	}
}

func TestOfferingTheOriginalLanguage(t *testing.T) {
	offer := germanHD
	offer.Original = scoring.OriginalOffer

	// An Original-only Release is held back with its own code, not language.
	v := verdict(t, offer, nameEnglish1080, titleEN, nil)
	if !reflect.DeepEqual(v.Rejections, []scoring.Rejection{scoring.RejectOriginalOnly}) {
		t.Errorf("rejections = %v, want [original_only]", v.Rejections)
	}
	// Primary-Language audio is accepted as ever.
	if v := verdict(t, offer, nameGermanDL, titleEN, nil); !v.Accepted {
		t.Errorf("DL rejected %v", v.Rejections)
	}
	// Some other language is still a language rejection.
	v = verdict(t, offer, "A.Movie.2020.FRENCH.1080p.WEB-DL.DD5.1.H264-GRP", titleEN, nil)
	if !reflect.DeepEqual(v.Rejections, []scoring.Rejection{scoring.RejectLanguage}) {
		t.Errorf("French: rejections = %v, want [language]", v.Rejections)
	}
	// Nothing to offer when the Original Language is unknown.
	v = verdict(t, offer, nameEnglish1080, scoring.Title{Name: "A Movie"}, nil)
	if !reflect.DeepEqual(v.Rejections, []scoring.Rejection{scoring.RejectLanguage}) {
		t.Errorf("unknown Original: rejections = %v, want [language]", v.Rejections)
	}
}

func TestOriginalLanguageProfile(t *testing.T) {
	origHD := scoring.ProfileSpec{Slot: slot.Standard, Rule: scoring.OriginalLanguage, Primary: release.LangGerman}

	// The Original Language is English: an untagged release is English.
	if v := verdict(t, origHD, nameEnglish1080, titleEN, nil); !v.Accepted {
		t.Errorf("rejected %v", v.Rejections)
	}
	// A German-only dub of an English Title lacks the Original Language.
	if v := verdict(t, origHD, nameGermanOnly, titleEN, nil); !reflect.DeepEqual(v.Rejections, []scoring.Rejection{scoring.RejectLanguage}) {
		t.Errorf("rejections = %v, want [language]", v.Rejections)
	}
	// German DL carries the Original Language too.
	if v := verdict(t, origHD, nameGermanDL, titleEN, nil); !v.Accepted {
		t.Errorf("DL rejected %v", v.Rejections)
	}
	// Unknown Original Language: nothing to require.
	v := verdict(t, origHD, nameEnglish1080, scoring.Title{Name: "A Movie"}, nil)
	if !reflect.DeepEqual(v.Rejections, []scoring.Rejection{scoring.RejectOriginalLanguageUnknown}) {
		t.Errorf("rejections = %v, want [original_language_unknown]", v.Rejections)
	}
	// The fallback flag is ignored on Original-Language Profiles.
	withFallback := origHD
	withFallback.Original = scoring.OriginalAccept
	if v := verdict(t, withFallback, nameEnglish1080, scoring.Title{Name: "A Movie"}, nil); v.Accepted {
		t.Error("an Original-Language Profile accepted a Title with unknown Original Language")
	}
}

func TestLanguagesOfTheVerdict(t *testing.T) {
	// "Original" (from DL) is resolved to the Title's Original Language.
	v := verdict(t, germanHD, nameGermanDL, titleEN, nil)
	if want := []release.Language{release.LangGerman, release.LangEnglish}; !reflect.DeepEqual(v.Languages, want) {
		t.Errorf("languages = %v, want %v", v.Languages, want)
	}
	// If the Original Language is already there, Unknown takes its place.
	v = verdict(t, germanHD, nameGermanDL, titleDE, nil)
	if want := []release.Language{release.LangGerman, release.LangUnknown}; !reflect.DeepEqual(v.Languages, want) {
		t.Errorf("languages = %v, want %v", v.Languages, want)
	}
	// Indexer languages win over parsed ones.
	v = verdict(t, germanHD, nameGermanOnly, titleEN, func(r *scoring.Release) {
		r.IndexerLanguages = []release.Language{release.LangFrench}
	})
	if want := []release.Language{release.LangFrench}; !reflect.DeepEqual(v.Languages, want) {
		t.Errorf("languages = %v, want %v", v.Languages, want)
	}
}

func TestResolutionClasses(t *testing.T) {
	wide := scoring.ProfileSpec{Slot: slot.Standard, Any: true, Rule: scoring.PrimaryLanguage, Primary: release.LangEnglish}
	uhd := scoring.ProfileSpec{Slot: slot.FourK, Rule: scoring.PrimaryLanguage, Primary: release.LangEnglish}

	names := map[string]string{
		"480p":  "A.Movie.2020.480p.WEB-DL.DD5.1.H264-GRP",
		"576p":  "A.Movie.2020.576p.BluRay.x264-GRP",
		"720p":  "A.Movie.2020.720p.WEB-DL.DD5.1.H264-GRP",
		"1080p": nameEnglish1080,
		"2160p": "A.Movie.2020.2160p.WEB-DL.DD5.1.H265-GRP",
	}
	cases := []struct {
		profile string
		spec    scoring.ProfileSpec
		accepts map[string]bool
	}{
		{"HD", englishHD, map[string]bool{"720p": true, "1080p": true}},
		{"Any", wide, map[string]bool{"480p": true, "576p": true, "720p": true, "1080p": true}},
		{"4K", uhd, map[string]bool{"2160p": true}},
	}
	for _, tc := range cases {
		for res, name := range names {
			t.Run(tc.profile+" "+res, func(t *testing.T) {
				v := verdict(t, tc.spec, name, titleEN, nil)
				if got := !v.Rejected(scoring.RejectResolution); got != tc.accepts[res] {
					t.Errorf("accepts %s = %v, want %v (rejections %v)", res, got, tc.accepts[res], v.Rejections)
				}
			})
		}
	}
}

func TestUnknownResolutionIsRejected(t *testing.T) {
	v := verdict(t, englishHD, "A.Movie.2020.WEB-DL.DD5.1.H264-GRP", titleEN, nil)
	if !v.Rejected(scoring.RejectResolution) {
		t.Errorf("rejections = %v, want resolution", v.Rejections)
	}
}

func TestMinimumScoreIsInclusive(t *testing.T) {
	build := func(score, min int) scoring.Verdict {
		snap := newFakeSnapshot().
			cf("radarr", "cf1", "CF", `{"default":`+strconv.Itoa(score)+`}`, titleSpec("1080p", false, false)).
			profile("radarr", "hd-bluray-web", "p1", "", min, map[string]string{"CF": "cf1"}).
			load(t)
		prof, err := snap.Profile(englishHD)
		if err != nil {
			t.Fatal(err)
		}
		return scoring.Evaluate(scoring.Release{Parsed: mustMovie(t, nameEnglish1080)}, titleEN, prof)
	}
	if v := build(0, 0); !v.Accepted || v.MinScore != 0 {
		t.Errorf("score 0, min 0: %+v", v)
	}
	if v := build(10, 10); !v.Accepted {
		t.Errorf("score at the minimum was rejected: %v", v.Rejections)
	}
	v := build(9, 10)
	if !reflect.DeepEqual(v.Rejections, []scoring.Rejection{scoring.RejectBelowMinScore}) {
		t.Errorf("score below the minimum: rejections %v", v.Rejections)
	}
	if v := build(-35000, 0); v.Accepted {
		t.Error("an unwanted -35000 release was accepted")
	}
}

func TestBlocklistedAndEveryOtherRejectionAreReported(t *testing.T) {
	v := verdict(t, germanHD, nameEnglish1080, titleEN, func(r *scoring.Release) { r.Blocklisted = true })
	want := []scoring.Rejection{scoring.RejectLanguage, scoring.RejectBlocklisted}
	if !reflect.DeepEqual(v.Rejections, want) {
		t.Errorf("rejections = %v, want %v", v.Rejections, want)
	}
	if v.Accepted {
		t.Error("accepted")
	}
	if v := verdict(t, englishHD, nameEnglish1080, titleEN, func(r *scoring.Release) { r.Blocklisted = true }); !reflect.DeepEqual(v.Rejections, []scoring.Rejection{scoring.RejectBlocklisted}) {
		t.Errorf("rejections = %v, want [blocklisted]", v.Rejections)
	}
}

func TestAPathologicalRegexTimesOutWithoutHangingEvaluate(t *testing.T) {
	old := scoring.MatchTimeout
	scoring.MatchTimeout = 50 * time.Millisecond
	t.Cleanup(func() { scoring.MatchTimeout = old })

	snap := newFakeSnapshot().
		cf("radarr", "bad", "Catastrophic", `{"default":-35000}`, titleSpec(`^(a+)+$`, false, false)).
		cf("radarr", "neg", "Negated catastrophe", `{"default":-1000}`, titleSpec(`^(a+)+$`, true, false)).
		cf("radarr", "ok", "Fine", `{"default":5}`, titleSpec("1080p", false, false)).
		profile("radarr", "hd-bluray-web", "p1", "", 0, map[string]string{"Catastrophic": "bad", "Negated catastrophe": "neg", "Fine": "ok"}).
		load(t)
	prof, err := snap.Profile(englishHD)
	if err != nil {
		t.Fatal(err)
	}
	rel := scoring.Release{Parsed: mustMovie(t, nameEnglish1080)}
	rel.Parsed.SimpleReleaseTitle = strings.Repeat("a", 40) + "!1080p"

	done := make(chan scoring.Verdict, 1)
	go func() { done <- scoring.Evaluate(rel, titleEN, prof) }()
	select {
	case v := <-done:
		// A timed-out condition counts as no match, negated or not; the rest
		// of the Profile still scores.
		if got := matchedNames(v); !reflect.DeepEqual(got, []string{"Fine"}) {
			t.Errorf("matched = %v, want [Fine]", got)
		}
		if v.Score != 5 {
			t.Errorf("Score = %d, want 5", v.Score)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Evaluate hung on a pathological regex")
	}
}
