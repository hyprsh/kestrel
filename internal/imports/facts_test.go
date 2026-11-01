package imports

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestMediaFacts(t *testing.T) {
	name := "Show.S01E01.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR10Plus.H.265-GRP"
	parsed, err := release.Parse(name, release.KindSeries)
	if err != nil {
		t.Fatal(err)
	}
	named := mustJSON(t, parsed)

	tests := []struct {
		label, parsed, probe, name string
		want                       Media
	}{
		{"from the parse", named, "", name, Media{"H.265", "Dolby Vision HDR10+", "DDP Atmos", "5.1"}},
		{"old snapshot parsed again from the name", `{"kind":"series"}`, "", name, Media{"H.265", "Dolby Vision HDR10+", "DDP Atmos", "5.1"}},
		{"nothing known", `{"kind":"series"}`, "", "Show.S01E01-GRP", Media{}},
		{"probe wins", named, mustJSON(t, probe.Info{VideoCodec: "h264", HDR: "HLG", Audio: []probe.AudioTrack{
			{Codec: "aac", Channels: 2}, {Codec: "dts", Channels: 8, Profile: "DTS-HD MA", Default: true},
		}}), name, Media{"H.264", "HLG", "DTS-HD MA", "7.1"}},
		{"probe keeps the name's finer detail", named, mustJSON(t, probe.Info{VideoCodec: "hevc", HDR: "Dolby Vision", Audio: []probe.AudioTrack{{Codec: "eac3", Channels: 6}}}),
			name, Media{"H.265", "Dolby Vision HDR10+", "DDP Atmos", "5.1"}},
		{"probe fills what the name lacks", `{"kind":"series"}`, mustJSON(t, probe.Info{VideoCodec: "av1", Audio: []probe.AudioTrack{{Codec: "truehd", Channels: 8, Profile: "Dolby TrueHD + Dolby Atmos"}}}),
			"Show.S01E01-GRP", Media{VideoCodec: "AV1", AudioCodec: "TrueHD Atmos", AudioChannels: "7.1"}},
	}
	for _, tt := range tests {
		t.Run(tt.label, func(t *testing.T) {
			if got := MediaFacts(tt.parsed, tt.probe, tt.name); got != tt.want {
				t.Errorf("MediaFacts = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestBackfillMedia(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(ctx, store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	db := st.Write()
	if _, err := db.Exec(`PRAGMA foreign_keys = OFF`); err != nil {
		t.Fatal(err)
	}
	ins := func(name, parsed string) {
		t.Helper()
		var p any
		if parsed != "" {
			p = parsed
		}
		if _, err := db.Exec(`INSERT INTO files (version_id, path, size, release_name, parsed_release, imported_at) VALUES (1, ?, 1, ?, ?, '2026-01-01T00:00:00Z')`, "/m/"+name, name, p); err != nil {
			t.Fatal(err)
		}
	}
	ins("Show.S01E01.1080p.WEB-DL.DD5.1.H.264-GRP", `{"kind":"series","quality":{"quality":{"name":"WEBDL-1080p"}}}`)
	ins("Plain.Show.S01E02-GRP", `{"kind":"series"}`)
	ins("Show.S01E03.1080p.x265.AAC2.0-GRP", "")

	n, err := BackfillMedia(ctx, db)
	if err != nil || n != 1 {
		t.Fatalf("BackfillMedia = %d, %v; want 1, nil", n, err)
	}
	var got string
	if err := db.QueryRow(`SELECT parsed_release FROM files WHERE path = '/m/Show.S01E01.1080p.WEB-DL.DD5.1.H.264-GRP'`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	var p release.ParsedRelease
	if err := json.Unmarshal([]byte(got), &p); err != nil {
		t.Fatal(err)
	}
	if p.VideoCodec != "H.264" || p.AudioCodec != "DD" || p.AudioChannels != "5.1" || p.Quality.Quality.Name != "WEBDL-1080p" {
		t.Errorf("backfilled parse = %s", got)
	}
	if n, err := BackfillMedia(ctx, db); err != nil || n != 0 {
		t.Errorf("second BackfillMedia = %d, %v; want 0, nil", n, err)
	}
}
