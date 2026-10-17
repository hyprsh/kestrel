package probe_test

import (
	"reflect"
	"testing"

	"github.com/hyprsh/kestrel/internal/probe"
)

func track(lang string) probe.AudioTrack {
	return probe.AudioTrack{Codec: "aac", Channels: 2, Language: probe.NormalizeLanguage(lang)}
}

func TestNormalizeLanguage(t *testing.T) {
	cases := map[string]string{
		"eng": "eng",
		"ENG": "eng",
		"deu": "deu",
		"ger": "deu", // bibliographic variant (Matroska/ffmpeg may write either)
		"fre": "fra",
		"fra": "fra",
		"und": "", // untagged carries no language
		"":    "",
	}
	for in, want := range cases {
		if got := probe.NormalizeLanguage(in); got != want {
			t.Errorf("NormalizeLanguage(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestResolveLanguages(t *testing.T) {
	cases := []struct {
		name         string
		parsed       []string
		tracks       []probe.AudioTrack
		want         []string
		inconclusive bool
	}{
		{
			name:   "tagged German track replaces parsed English",
			parsed: []string{"eng"},
			tracks: []probe.AudioTrack{track("deu")},
			want:   []string{"deu"},
		},
		{
			name:   "multi-audio keeps every probed language in track order",
			parsed: nil,
			tracks: []probe.AudioTrack{track("deu"), track("eng")},
			want:   []string{"deu", "eng"},
		},
		{
			name:   "duplicate tracks in one language are listed once",
			parsed: nil,
			tracks: []probe.AudioTrack{track("deu"), track("deu")},
			want:   []string{"deu"},
		},
		{
			name:   "bibliographic code counts as its canonical language",
			parsed: []string{"deu"},
			tracks: []probe.AudioTrack{track("ger")},
			want:   []string{"deu"},
		},
		{
			name:         "only untagged tracks is inconclusive, parsed stands",
			parsed:       []string{"deu"},
			tracks:       []probe.AudioTrack{track("und")},
			want:         []string{"deu"},
			inconclusive: true,
		},
		{
			name:         "no audio tracks is inconclusive",
			parsed:       []string{"deu"},
			tracks:       nil,
			want:         []string{"deu"},
			inconclusive: true,
		},
		{
			name:         "eng-only probe against a parsed non-English language is inconclusive",
			parsed:       []string{"deu"},
			tracks:       []probe.AudioTrack{track("eng")},
			want:         []string{"deu"},
			inconclusive: true,
		},
		{
			name:         "eng plus untagged against a parsed non-English language is inconclusive",
			parsed:       []string{"deu", "eng"},
			tracks:       []probe.AudioTrack{track("eng"), track("und")},
			want:         []string{"deu", "eng"},
			inconclusive: true,
		},
		{
			name:   "eng-only probe agrees with parsed English and is conclusive",
			parsed: []string{"eng"},
			tracks: []probe.AudioTrack{track("eng")},
			want:   []string{"eng"},
		},
		{
			name:   "untagged track alongside a German track is ignored",
			parsed: []string{"deu"},
			tracks: []probe.AudioTrack{track("und"), track("deu")},
			want:   []string{"deu"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, inconclusive := probe.ResolveLanguages(tc.parsed, tc.tracks)
			if !reflect.DeepEqual(got, tc.want) || inconclusive != tc.inconclusive {
				t.Fatalf("ResolveLanguages() = %v, inconclusive %v; want %v, inconclusive %v",
					got, inconclusive, tc.want, tc.inconclusive)
			}
		})
	}
}
