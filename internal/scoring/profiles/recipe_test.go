package profiles_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

// declareAll is every builtin Profile as the Config File declares it, with the changes in recipes.
func declareAll(t *testing.T, s *profiles.Service, recipes map[string]profiles.State) map[string]profiles.State {
	t.Helper()
	want := map[string]profiles.State{}
	for key, p := range byKey(t, s) {
		if !p.Custom {
			want[key] = profiles.State{Enabled: p.Enabled, OriginalChoice: p.OriginalChoice}
		}
	}
	for key, st := range recipes {
		base := want[key]
		st.Enabled, st.OriginalChoice = base.Enabled, base.OriginalChoice
		if st.OriginalChoice == "" {
			st.OriginalChoice = scoring.OriginalReject
		}
		want[key] = st
	}
	return want
}

func TestBuiltinProfilesAreBlurayWebWithTheirLanguageRule(t *testing.T) {
	m := byKey(t, newService(t))
	for key, p := range m {
		if p.Family != scoring.FamilyBlurayWeb {
			t.Errorf("%s: Release Family %q, want bluray-web", key, p.Family)
		}
	}
	if m["hd-primary"].Rule != scoring.PrimaryLanguage || m["hd-original"].Rule != scoring.OriginalLanguage {
		t.Errorf("language rules changed: %v, %v", m["hd-primary"].Rule, m["hd-original"].Rule)
	}
}

func TestADeclaredRecipeIsBackedByItsTrashProfile(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	want := declareAll(t, s, map[string]profiles.State{
		"hd-primary":  {Family: scoring.FamilyRemuxWeb},
		"4k-primary":  {Family: scoring.FamilyWeb},
		"hd-original": {Family: scoring.FamilyRemuxWeb, Language: "de"}, // named German
	})
	if err := s.SetAll(ctx, want, ""); err != nil {
		t.Fatal(err)
	}
	m := byKey(t, s)
	for key, w := range map[string][2]string{
		"hd-primary":  {"remux-web-1080p", "remux-web-1080p"},
		"4k-primary":  {"web-2160p", "web-2160p"},
		"hd-original": {"german-hd-remux-web", "german-hd-remux-web"},
	} {
		if m[key].TrashMovies != w[0] || m[key].TrashSeries != w[1] {
			t.Errorf("%s: backed by %q / %q, want %q / %q", key, m[key].TrashMovies, m[key].TrashSeries, w[0], w[1])
		}
	}
	if m["hd-original"].Rule != scoring.NamedLanguage || m["hd-original"].Named != profiles.German {
		t.Errorf("hd-original rule = %v %q, want a named German one", m["hd-original"].Rule, m["hd-original"].Named)
	}
	// A named-language Profile has an Original Offer choice, an Original-Language one does not.
	again := declareAll(t, s, nil)
	again["hd-original"] = profiles.State{Enabled: true, OriginalChoice: scoring.OriginalOffer, Family: scoring.FamilyRemuxWeb, Language: "de"}
	if err := s.SetAll(ctx, again, ""); err != nil {
		t.Errorf("a named-language Profile could not offer: %v", err)
	}
	if got := byKey(t, s)["hd-original"].OriginalChoice; got != scoring.OriginalOffer {
		t.Errorf("choice = %q, want offer", got)
	}
}

func TestARecipeWithoutABackingProfileIsRefusedNamingIt(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	cases := []struct {
		name string
		key  string
		st   profiles.State
	}{
		{"German SQP", "hd-primary", profiles.State{Family: scoring.FamilySQP, Language: "de"}},
		{"German WEB", "hd-original", profiles.State{Family: scoring.FamilyWeb, Language: "de"}},
		{"Any with Remux", "any-primary", profiles.State{Family: scoring.FamilyRemuxWeb}},
		{"an unknown family", "hd-primary", profiles.State{Family: "nope"}},
		{"an unknown language", "hd-primary", profiles.State{Language: "xx"}},
	}
	for _, c := range cases {
		err := s.SetAll(ctx, declareAll(t, s, map[string]profiles.State{c.key: c.st}), "")
		wantFieldPrefix(t, err, c.key+".")
	}
	if got := byKey(t, s)["hd-primary"].Family; got != scoring.FamilyBlurayWeb {
		t.Errorf("a refused declaration changed the Release Family to %q", got)
	}
}

// SQP and French Remux have a TRaSH profile for Movies only: they are Movies-only Profiles, not invalid ones.
func TestARecipeBackedForOneKindAppliesToThatKindOnly(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	if err := s.SetAll(ctx, declareAll(t, s, map[string]profiles.State{
		"hd-original": {Family: scoring.FamilySQP},
		"4k-original": {Family: scoring.FamilyRemuxWeb, Language: "fr"},
	}), ""); err != nil {
		t.Fatal(err)
	}
	m := byKey(t, s)
	for key, w := range map[string]string{"hd-original": "sqp-1-1080p", "4k-original": "french-multi-vf-uhd-remux-web"} {
		p := m[key]
		if p.TrashMovies != w || p.TrashSeries != "" || !p.AppliesTo(release.KindMovie) || p.AppliesTo(release.KindSeries) {
			t.Errorf("%s: %q / %q, applies to Movies %v, Series %v; want Movies only, backed by %q", key, p.TrashMovies, p.TrashSeries, p.AppliesTo(release.KindMovie), p.AppliesTo(release.KindSeries), w)
		}
	}
	if m["hd-primary"].AppliesTo(release.KindSeries) == false {
		t.Error("an untouched Profile lost Series")
	}
}

func wantFieldPrefix(t *testing.T, err error, prefix string) {
	t.Helper()
	var ve *profiles.ValidationError
	if !errors.As(err, &ve) || !strings.HasPrefix(ve.Field, prefix) {
		t.Errorf("err = %v, want a ValidationError on %q...", err, prefix)
	}
}
