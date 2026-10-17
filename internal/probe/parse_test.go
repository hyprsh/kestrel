package probe_test

import (
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/probe"
)

func load(t *testing.T, name string) probe.Info {
	t.Helper()
	data, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	info, err := probe.ParseJSON(data)
	if err != nil {
		t.Fatalf("ParseJSON(%s): %v", name, err)
	}
	return info
}

func TestParseHDGermanEnglish(t *testing.T) {
	info := load(t, "hd_german_english.json")

	if !info.HasVideo || info.Width != 1920 || info.Height != 1080 {
		t.Fatalf("video = has %v %dx%d", info.HasVideo, info.Width, info.Height)
	}
	if info.Class() != probe.HD {
		t.Fatalf("Class() = %v, want HD", info.Class())
	}
	if info.VideoCodec != "h264" || info.HDR != "" {
		t.Fatalf("codec %q, HDR %q; want h264 and no HDR", info.VideoCodec, info.HDR)
	}
	if info.Size != 7340032512 {
		t.Fatalf("Size = %d", info.Size)
	}
	if info.Duration != 5412345*time.Millisecond {
		t.Fatalf("Duration = %v", info.Duration)
	}
	want := []probe.AudioTrack{
		{Index: 1, Codec: "eac3", Channels: 6, Language: "deu", Title: "German 5.1", Default: true},
		{Index: 2, Codec: "aac", Channels: 2, Language: "eng", Title: "English 2.0", Default: false},
	}
	if !reflect.DeepEqual(info.Audio, want) {
		t.Fatalf("Audio = %+v, want %+v", info.Audio, want)
	}
}

func TestParseHDR10(t *testing.T) {
	info := load(t, "uhd_hdr10.json")

	if info.Class() != probe.UHD {
		t.Fatalf("Class() = %v, want UHD (1608 high but 3840 wide)", info.Class())
	}
	if info.HDR != "HDR10" {
		t.Fatalf("HDR = %q, want HDR10", info.HDR)
	}
	if info.VideoCodec != "hevc" {
		t.Fatalf("VideoCodec = %q", info.VideoCodec)
	}
}

func TestParseDolbyVision(t *testing.T) {
	info := load(t, "uhd_dolby_vision.json")

	if info.Class() != probe.UHD || info.Height != 2160 {
		t.Fatalf("Class() = %v, height %d", info.Class(), info.Height)
	}
	if info.HDR != "Dolby Vision" {
		t.Fatalf("HDR = %q, want Dolby Vision", info.HDR)
	}
}

func TestParseUntaggedAudioHasNoLanguage(t *testing.T) {
	info := load(t, "untagged_audio.json")

	want := []probe.AudioTrack{
		{Index: 1, Codec: "aac", Channels: 2, Language: "", Default: true},
		{Index: 2, Codec: "ac3", Channels: 2, Language: ""},
	}
	if !reflect.DeepEqual(info.Audio, want) {
		t.Fatalf("Audio = %+v, want %+v", info.Audio, want)
	}
	if info.Class() != probe.HD {
		t.Fatalf("1280x536 Class() = %v, want HD (width >= 1200)", info.Class())
	}
}

func TestParseAudioOnlyHasNoVideo(t *testing.T) {
	info := load(t, "audio_only.json")

	if info.HasVideo {
		t.Fatal("audio-only file reported HasVideo")
	}
	if len(info.Audio) != 1 || info.Audio[0].Language != "eng" {
		t.Fatalf("Audio = %+v", info.Audio)
	}
}

func TestParseRejectsNonJSON(t *testing.T) {
	if _, err := probe.ParseJSON([]byte("not json")); err == nil {
		t.Fatal("ParseJSON accepted non-JSON output")
	}
}
