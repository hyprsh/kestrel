package imports_test

import (
	"errors"
	"github.com/hyprsh/kestrel/internal/slot"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
)

// rel builds the parsed side of a file: quality name, revision, edition and group.
func rel(quality string, rev release.Revision, edition, group string) release.ParsedRelease {
	return release.ParsedRelease{
		Edition:      edition,
		ReleaseGroup: group,
		Quality: release.QualityModel{
			Quality:  release.Quality{Name: quality},
			Revision: rev,
		},
	}
}

var (
	duneTitle = imports.Title{Name: "Dune", Year: 2021, TMDBID: 438631, OriginalLanguage: "eng"}
	// duneFolder is the Movie folder for duneTitle; every Movie file starts with it.
	duneFolder = "Dune (2021) {tmdb-438631}"
	plain      = rel("Bluray-1080p", release.Revision{Version: 1}, "", "GRP")
)

func TestFolders(t *testing.T) {
	tests := []struct {
		name  string
		title imports.Title
		want  string
	}{
		{"movie with year", imports.Title{Name: "Dune", Year: 2021, TMDBID: 438631}, "Dune (2021) {tmdb-438631}"},
		{"movie without year", imports.Title{Name: "Dune", TMDBID: 438631}, "Dune {tmdb-438631}"},
		{"colon becomes a spaced dash", imports.Title{Name: "Mission: Impossible", Year: 1996, TMDBID: 954}, "Mission - Impossible (1996) {tmdb-954}"},
		{"colon without a space becomes a dash", imports.Title{Name: "Star Wars:Episode", Year: 1999, TMDBID: 1}, "Star Wars-Episode (1999) {tmdb-1}"},
		{"illegal characters are stripped", imports.Title{Name: "What/If? <A>|B", Year: 2020, TMDBID: 2}, "WhatIf AB (2020) {tmdb-2}"},
		{"trailing dots and spaces are trimmed", imports.Title{Name: "Title... ", Year: 2020, TMDBID: 3}, "Title (2020) {tmdb-3}"},
		{"unicode is kept", imports.Title{Name: "Amélie", Year: 2001, TMDBID: 4}, "Amélie (2001) {tmdb-4}"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := imports.MovieFolder(tt.title)
			if err != nil {
				t.Fatalf("MovieFolder: %v", err)
			}
			if got != tt.want {
				t.Errorf("MovieFolder = %q, want %q", got, tt.want)
			}
		})
	}

	t.Run("movie folder needs a TMDB id", func(t *testing.T) {
		if _, err := imports.MovieFolder(imports.Title{Name: "Dune", Year: 2021}); err == nil {
			t.Error("MovieFolder without TMDB id: want error")
		}
	})

	series := imports.Title{Name: "Dark", Year: 2017, TVDBID: 334824}
	t.Run("series folder", func(t *testing.T) {
		got, err := imports.SeriesFolder(series)
		if err != nil {
			t.Fatalf("SeriesFolder: %v", err)
		}
		if want := "Dark (2017) {tvdb-334824}"; got != want {
			t.Errorf("SeriesFolder = %q, want %q", got, want)
		}
	})
	t.Run("series folder needs a TVDB id", func(t *testing.T) {
		if _, err := imports.SeriesFolder(imports.Title{Name: "Dark", Year: 2017}); err == nil {
			t.Error("SeriesFolder without TVDB id: want error")
		}
	})

	seasons := map[int]string{0: "Specials", 1: "Season 01", 12: "Season 12"}
	for season, want := range seasons {
		if got := imports.SeasonFolder(season); got != want {
			t.Errorf("SeasonFolder(%d) = %q, want %q", season, got, want)
		}
	}
}

func TestMovieFileNameBracketsInOrder(t *testing.T) {
	// One file carrying every bracket: quality, edition, language, audio,
	// HDR, video codec, then -GROUP.
	f := imports.FileFacts{
		Release: rel("Bluray-2160p Remux", release.Revision{Version: 2}, "Extended", "GRP"),
		Probe: probe.Info{
			HDR:        "Dolby Vision",
			VideoCodec: "hevc",
			Audio:      []probe.AudioTrack{{Codec: "truehd", Channels: 8, Language: "eng", Default: true}},
		},
		Languages: []string{"eng", "deu"},
		Primary:   "deu",
	}
	got, err := imports.MovieFileName(duneTitle, slot.FourK, f, ".mkv")
	if err != nil {
		t.Fatalf("MovieFileName: %v", err)
	}
	want := duneFolder + " - [4K][Bluray-2160p Remux Proper][Extended][German DL][TrueHD 7.1][Dolby Vision][h265]-GRP.mkv"
	if got != want {
		t.Errorf("MovieFileName =\n  %q\nwant\n  %q", got, want)
	}
}

func TestMovieFileNameSlotLabels(t *testing.T) {
	tests := []struct {
		slot slot.Slot
		want string
	}{
		{slot.Standard, "[Standard]"},
		{slot.FourK, "[4K]"},
	}
	for _, tt := range tests {
		f := imports.FileFacts{Release: plain}
		got, err := imports.MovieFileName(duneTitle, tt.slot, f, ".mkv")
		if err != nil {
			t.Fatalf("MovieFileName: %v", err)
		}
		want := duneFolder + " - " + tt.want + "[Bluray-1080p]-GRP.mkv"
		if got != want {
			t.Errorf("slot %v: got %q, want %q", tt.slot, got, want)
		}
	}
}

func TestMovieFileNameQualityRevision(t *testing.T) {
	tests := []struct {
		name string
		rel  release.ParsedRelease
		want string
	}{
		{"plain release", rel("WEBDL-1080p", release.Revision{Version: 1}, "", "GRP"), "[WEBDL-1080p]-GRP.mkv"},
		{"proper", rel("WEBDL-1080p", release.Revision{Version: 2}, "", "GRP"), "[WEBDL-1080p Proper]-GRP.mkv"},
		{"repack", rel("WEBDL-1080p", release.Revision{Version: 2, IsRepack: true}, "", "GRP"), "[WEBDL-1080p Repack]-GRP.mkv"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := imports.MovieFileName(duneTitle, slot.Standard, imports.FileFacts{Release: tt.rel}, ".mkv")
			if err != nil {
				t.Fatalf("MovieFileName: %v", err)
			}
			if want := duneFolder + " - [Standard]" + tt.want; got != want {
				t.Errorf("got %q, want %q", got, want)
			}
		})
	}
}

func TestMovieFileNameAudioAndVideoFromProbe(t *testing.T) {
	tests := []struct {
		name  string
		probe probe.Info
		want  string
	}{
		{
			"default track wins over first",
			probe.Info{VideoCodec: "h264", Audio: []probe.AudioTrack{
				{Codec: "ac3", Channels: 2},
				{Codec: "dts", Channels: 6, Default: true},
			}},
			"[DTS 5.1][h264]",
		},
		{
			"first track when none is default",
			probe.Info{VideoCodec: "h264", Audio: []probe.AudioTrack{
				{Codec: "aac", Channels: 2},
				{Codec: "ac3", Channels: 6},
			}},
			"[AAC 2.0][h264]",
		},
		{"stereo", probe.Info{Audio: []probe.AudioTrack{{Codec: "opus", Channels: 2, Default: true}}}, "[Opus 2.0]"},
		{"mono", probe.Info{Audio: []probe.AudioTrack{{Codec: "mp3", Channels: 1, Default: true}}}, "[MP3 1.0]"},
		{"7.1 eac3", probe.Info{Audio: []probe.AudioTrack{{Codec: "eac3", Channels: 8, Default: true}}}, "[EAC3 7.1]"},
		{"pcm collapses", probe.Info{Audio: []probe.AudioTrack{{Codec: "pcm_s24le", Channels: 2, Default: true}}}, "[PCM 2.0]"},
		{"hevc is h265", probe.Info{VideoCodec: "hevc"}, "[h265]"},
		{"av1", probe.Info{VideoCodec: "av1"}, "[AV1]"},
		{"no audio and no video leave no brackets", probe.Info{}, ""},
		{"HDR10", probe.Info{HDR: "HDR10"}, "[HDR10]"},
		{"HLG", probe.Info{HDR: "HLG"}, "[HLG]"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := imports.MovieFileName(duneTitle, slot.Standard, imports.FileFacts{Release: plain, Probe: tt.probe}, ".mkv")
			if err != nil {
				t.Fatalf("MovieFileName: %v", err)
			}
			want := duneFolder + " - [Standard][Bluray-1080p]" + tt.want + "-GRP.mkv"
			if got != want {
				t.Errorf("got %q, want %q", got, want)
			}
		})
	}
}

func TestMovieFileNameEditionAndGroup(t *testing.T) {
	t.Run("no group leaves no dash", func(t *testing.T) {
		f := imports.FileFacts{Release: rel("Bluray-1080p", release.Revision{Version: 1}, "", "")}
		got, err := imports.MovieFileName(duneTitle, slot.Standard, f, ".mkv")
		if err != nil {
			t.Fatalf("MovieFileName: %v", err)
		}
		if want := duneFolder + " - [Standard][Bluray-1080p].mkv"; got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})
	t.Run("edition is a plain bracket after quality", func(t *testing.T) {
		f := imports.FileFacts{Release: rel("Bluray-1080p", release.Revision{Version: 1}, "Director's Cut", "GRP")}
		got, err := imports.MovieFileName(duneTitle, slot.Standard, f, ".mkv")
		if err != nil {
			t.Fatalf("MovieFileName: %v", err)
		}
		if want := duneFolder + " - [Standard][Bluray-1080p][Director's Cut]-GRP.mkv"; got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})
}

func TestMovieFileNameLanguageTag(t *testing.T) {
	// Settled 4: P is the household Primary Language, O the Title's Original
	// Language, both matched against the probed audio. Extra tracks are ignored.
	prefix := duneFolder + " - [Standard][Bluray-1080p]"
	suffix := "-GRP.mkv"
	tests := []struct {
		name     string
		primary  string
		original string
		probed   []string
		want     string
	}{
		{"P and O, German primary DL", "deu", "eng", []string{"deu", "eng"}, "[German DL]"},
		{"P and O, French primary MULTi", "fra", "eng", []string{"fra", "eng"}, "[French MULTi]"},
		{"P and O, English primary DUAL", "eng", "deu", []string{"eng", "deu"}, "[English DUAL]"},
		{"P and O in track order", "deu", "eng", []string{"eng", "deu"}, "[German DL]"},
		{"extra track ignored", "deu", "eng", []string{"deu", "eng", "spa"}, "[German DL]"},
		{"only P", "deu", "eng", []string{"deu"}, "[German]"},
		{"P equals O", "eng", "eng", []string{"eng"}, "[English]"},
		{"O without P", "deu", "jpn", []string{"jpn"}, "[Japanese]"},
		{"neither: first known probed language", "deu", "jpn", []string{"spa", "ita"}, "[Spanish]"},
		{"neither: unknown codes skipped", "deu", "jpn", []string{"xyz", "ita"}, "[Italian]"},
		{"none known: no language bracket", "deu", "jpn", []string{"xyz"}, ""},
		{"no tracks: no language bracket", "deu", "jpn", nil, ""},
		{"original unknown: P only", "deu", "", []string{"deu"}, "[German]"},
		{"original unknown, P absent", "deu", "", []string{"eng"}, "[English]"},
		{"French primary, original unknown, P only", "fra", "", []string{"fra"}, "[French]"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			title := duneTitle
			title.OriginalLanguage = tt.original
			f := imports.FileFacts{Release: plain, Languages: tt.probed, Primary: tt.primary}
			got, err := imports.MovieFileName(title, slot.Standard, f, ".mkv")
			if err != nil {
				t.Fatalf("MovieFileName: %v", err)
			}
			want := prefix + tt.want + suffix
			if tt.want == "" {
				want = prefix + suffix
			}
			if got != want {
				t.Errorf("got %q, want %q", got, want)
			}
		})
	}
}

func TestMovieFileNameFileNameCap(t *testing.T) {
	// Words of 9 letters, so every cut lands on a word boundary.
	long := strings.TrimSpace(strings.Repeat("abcdefghi ", 40))
	title := imports.Title{Name: long, Year: 2021, TMDBID: 1, OriginalLanguage: "eng"}
	f := imports.FileFacts{Release: plain, Languages: []string{"deu", "eng"}, Primary: "deu"}
	got, err := imports.MovieFileName(title, slot.Standard, f, ".mkv")
	if err != nil {
		t.Fatalf("MovieFileName: %v", err)
	}
	if n := len(got); n > 255 {
		t.Fatalf("file name is %d bytes, want <= 255", n)
	}
	tail := " (2021) {tmdb-1} - [Standard][Bluray-1080p][German DL]-GRP.mkv"
	if !strings.HasSuffix(got, tail) {
		t.Fatalf("brackets and ID tag must stay intact; got %q", got)
	}
	trimmed := strings.TrimSuffix(got, tail)
	if !strings.HasPrefix(long, trimmed) {
		t.Errorf("trimmed title %q is not a prefix of the original", trimmed)
	}
	if !strings.HasSuffix(trimmed, " abcdefghi") && trimmed != "abcdefghi" {
		t.Errorf("title must end on a whole word, got %q", trimmed)
	}

	folder, err := imports.MovieFolder(title)
	if err != nil {
		t.Fatalf("MovieFolder: %v", err)
	}
	if len(folder) > 255 {
		t.Errorf("folder is %d bytes, want <= 255", len(folder))
	}
}

func TestMovieFileNameKeepsFolderPrefixWhenItFits(t *testing.T) {
	// 15 words of 9 letters: the folder and the file both fit untrimmed, so
	// the file starts with the folder name (Jellyfin groups Versions by it).
	title := imports.Title{Name: strings.TrimSpace(strings.Repeat("abcdefghi ", 15)), Year: 2021, TMDBID: 1, OriginalLanguage: "eng"}
	f := imports.FileFacts{Release: plain, Languages: []string{"deu", "eng"}, Primary: "deu"}
	got, err := imports.MovieFileName(title, slot.Standard, f, ".mkv")
	if err != nil {
		t.Fatalf("MovieFileName: %v", err)
	}
	folder, err := imports.MovieFolder(title)
	if err != nil {
		t.Fatalf("MovieFolder: %v", err)
	}
	if !strings.HasPrefix(got, folder+" - [Standard]") {
		t.Errorf("file %q must start with folder %q", got, folder)
	}
}

func TestMovieFileNameCapKeepsRunesWhole(t *testing.T) {
	long := strings.Repeat("Äö Ü", 80)
	title := imports.Title{Name: long, Year: 2021, TMDBID: 1}
	got, err := imports.MovieFileName(title, slot.Standard, imports.FileFacts{Release: plain}, ".mkv")
	if err != nil {
		t.Fatalf("MovieFileName: %v", err)
	}
	if !utf8.ValidString(got) {
		t.Errorf("file name is not valid UTF-8: %q", got)
	}
	if len(got) > 255 {
		t.Errorf("file name is %d bytes, want <= 255", len(got))
	}
}

func TestMovieFileNameErrorsWhenBracketsDoNotFit(t *testing.T) {
	f := imports.FileFacts{Release: rel("Bluray-1080p", release.Revision{Version: 1}, strings.Repeat("x", 300), "GRP")}
	_, err := imports.MovieFileName(duneTitle, slot.Standard, f, ".mkv")
	if !errors.Is(err, imports.ErrTooLong) {
		t.Errorf("err = %v, want ErrTooLong", err)
	}
}

func TestMovieFileNameRequiresTitleAndDottedExt(t *testing.T) {
	if _, err := imports.MovieFileName(imports.Title{Year: 2021, TMDBID: 1}, slot.Standard, imports.FileFacts{Release: plain}, ".mkv"); err == nil {
		t.Error("empty title: want error")
	}
	if _, err := imports.MovieFileName(duneTitle, slot.Standard, imports.FileFacts{Release: plain}, "mkv"); err == nil {
		t.Error("extension without dot: want error")
	}
}

func TestEpisodeFileNames(t *testing.T) {
	dark := imports.Title{Name: "Dark", Year: 2017, TVDBID: 334824, OriginalLanguage: "deu"}
	f := imports.FileFacts{
		Release:   rel("WEBDL-1080p", release.Revision{Version: 1}, "", "GRP"),
		Probe:     probe.Info{VideoCodec: "h264", Audio: []probe.AudioTrack{{Codec: "eac3", Channels: 6, Default: true}}},
		Languages: []string{"deu"},
		Primary:   "deu",
	}
	tests := []struct {
		name string
		ep   imports.Episode
		slot slot.Slot
		want string
	}{
		{"single episode carries no episode title", imports.Episode{Season: 1, First: 1, Last: 1}, slot.Standard,
			"Dark (2017) - S01E01 - [Standard][WEBDL-1080p][German][EAC3 5.1][h264]-GRP.mkv"},
		{"multi-episode range", imports.Episode{Season: 1, First: 1, Last: 2}, slot.Standard,
			"Dark (2017) - S01E01-E02 - [Standard][WEBDL-1080p][German][EAC3 5.1][h264]-GRP.mkv"},
		{"specials are season 0", imports.Episode{Season: 0, First: 3, Last: 3}, slot.Standard,
			"Dark (2017) - S00E03 - [Standard][WEBDL-1080p][German][EAC3 5.1][h264]-GRP.mkv"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := imports.EpisodeFileName(dark, tt.slot, tt.ep, f, ".mkv")
			if err != nil {
				t.Fatalf("EpisodeFileName: %v", err)
			}
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
	t.Run("last before first is rejected", func(t *testing.T) {
		if _, err := imports.EpisodeFileName(dark, slot.Standard, imports.Episode{Season: 1, First: 2, Last: 1}, f, ".mkv"); err == nil {
			t.Error("want error")
		}
	})
}

func TestSubtitleFileNames(t *testing.T) {
	stem := "Dune (2021) {tmdb-438631} - [Standard][Bluray-1080p][German DL]-GRP"
	none := func(string) bool { return false }
	tests := []struct {
		name   string
		lang   string
		forced bool
		sdh    bool
		want   string
	}{
		{"language", "deu", false, false, stem + ".deu.srt"},
		{"forced", "deu", true, false, stem + ".deu.forced.srt"},
		{"sdh", "eng", false, true, stem + ".eng.sdh.srt"},
		{"forced and sdh", "eng", true, true, stem + ".eng.forced.sdh.srt"},
		{"empty language is und", "", false, false, stem + ".und.srt"},
		{"und is und", "und", false, false, stem + ".und.srt"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := imports.SubtitleFileName(stem, tt.lang, tt.forced, tt.sdh, ".srt", none)
			if err != nil {
				t.Fatalf("SubtitleFileName: %v", err)
			}
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}

	t.Run("collisions get a counter before the extension", func(t *testing.T) {
		taken := map[string]bool{
			stem + ".und.srt":   true,
			stem + ".und.2.srt": true,
		}
		got, err := imports.SubtitleFileName(stem, "", false, false, ".srt", func(n string) bool { return taken[n] })
		if err != nil {
			t.Fatalf("SubtitleFileName: %v", err)
		}
		if want := stem + ".und.3.srt"; got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})
	t.Run("counter goes after forced and sdh", func(t *testing.T) {
		taken := map[string]bool{stem + ".deu.forced.srt": true}
		got, err := imports.SubtitleFileName(stem, "deu", true, false, ".srt", func(n string) bool { return taken[n] })
		if err != nil {
			t.Fatalf("SubtitleFileName: %v", err)
		}
		if want := stem + ".deu.forced.2.srt"; got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})
}
