package imports

import (
	"encoding/json"
	"strings"

	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
)

// LanguageName is the English name of a canonical language code, or the code
// itself when Kestrel has no name for it.
func LanguageName(code string) string {
	if n, ok := languageNames[code]; ok {
		return n
	}
	return code
}

// Facts reads the quality name and the probed audio languages (English names,
// in track order) off the JSON snapshots stored on a file. Both are empty
// when a snapshot is missing or unreadable.
func Facts(parsedJSON, probeJSON string) (quality string, languages []string) {
	languages = []string{}
	var p release.ParsedRelease
	if json.Unmarshal([]byte(parsedJSON), &p) == nil {
		quality = p.Quality.Quality.Name
	}
	var info probe.Info
	if json.Unmarshal([]byte(probeJSON), &info) == nil {
		seen := map[string]bool{}
		for _, a := range info.Audio {
			if a.Language != "" && !seen[a.Language] {
				seen[a.Language] = true
				languages = append(languages, LanguageName(a.Language))
			}
		}
	}
	return quality, languages
}

// ReleaseGroup reads the release group off the parse snapshot stored on a file;
// "" when the snapshot is missing or the name had no group.
func ReleaseGroup(parsedJSON string) string {
	var p release.ParsedRelease
	if json.Unmarshal([]byte(parsedJSON), &p) != nil {
		return ""
	}
	return p.ReleaseGroup
}

// Media is the video and audio format of a file, each "" when unknown.
type Media struct {
	VideoCodec, HDR, AudioCodec, AudioChannels string
}

// MediaFacts reads the video codec, HDR format, audio codec and channel layout
// of a file. The parse snapshot gives what the release name states (a file
// stored before the parser read these is parsed again from releaseName); the
// ffprobe snapshot, when it has a fact, replaces the name's, since it describes
// the file on disk.
func MediaFacts(parsedJSON, probeJSON, releaseName string) Media {
	var m Media
	var p release.ParsedRelease
	if json.Unmarshal([]byte(parsedJSON), &p) == nil {
		m = Media{p.VideoCodec, p.HDR, p.AudioCodec, p.AudioChannels}
	}
	if m == (Media{}) && releaseName != "" {
		m.VideoCodec, m.HDR, m.AudioCodec, m.AudioChannels = release.ParseMedia(releaseName)
	}
	var info probe.Info
	if json.Unmarshal([]byte(probeJSON), &info) != nil {
		return m
	}
	if v := ProbeVideoCodec(info.VideoCodec); v != "" {
		m.VideoCodec = v
	}
	switch h := info.HDR; {
	case h == "":
	case h == "Dolby Vision" && strings.HasPrefix(m.HDR, "Dolby Vision"):
	case h == "HDR10" && m.HDR == "HDR10+":
	default:
		m.HDR = h
	}
	if t, ok := mainAudio(info.Audio); ok {
		// An older probe snapshot has no profile, so its "dts" must not
		// replace the name's more exact "DTS-HD MA".
		if c := ProbeAudioCodec(t); c != "" && !strings.HasPrefix(m.AudioCodec, c) {
			m.AudioCodec = c
		}
		if ch := ProbeChannels(t.Channels); ch != "" {
			m.AudioChannels = ch
		}
	}
	return m
}

// mainAudio is the default audio track, else the first.
func mainAudio(tracks []probe.AudioTrack) (probe.AudioTrack, bool) {
	for _, t := range tracks {
		if t.Default {
			return t, true
		}
	}
	if len(tracks) > 0 {
		return tracks[0], true
	}
	return probe.AudioTrack{}, false
}

// ProbeVideoCodec names an ffprobe video codec as the parser does.
func ProbeVideoCodec(name string) string {
	switch strings.ToLower(name) {
	case "h264":
		return release.VideoH264
	case "hevc", "h265":
		return release.VideoH265
	case "av1":
		return release.VideoAV1
	case "vc1":
		return release.VideoVC1
	case "mpeg2video":
		return release.VideoMPEG2
	case "vp9":
		return release.VideoVP9
	}
	return ""
}

// ProbeAudioCodec names an ffprobe audio track as the parser does, using the
// codec profile for DTS-HD and Atmos.
func ProbeAudioCodec(t probe.AudioTrack) string {
	profile := strings.ToLower(t.Profile)
	atmos := strings.Contains(profile, "atmos")
	switch strings.ToLower(t.Codec) {
	case "aac":
		return "AAC"
	case "ac3":
		return "DD"
	case "eac3":
		if atmos {
			return "DDP Atmos"
		}
		return "DDP"
	case "truehd":
		if atmos {
			return "TrueHD Atmos"
		}
		return "TrueHD"
	case "dts":
		switch {
		case strings.Contains(profile, "dts-hd ma"):
			return "DTS-HD MA"
		case strings.Contains(profile, "dts-hd hra"):
			return "DTS-HD HRA"
		case strings.Contains(profile, "dts:x"), strings.Contains(profile, "dts-x"):
			return "DTS:X"
		}
		return "DTS"
	case "flac":
		return "FLAC"
	case "opus":
		return "Opus"
	case "mp3":
		return "MP3"
	}
	if strings.HasPrefix(strings.ToLower(t.Codec), "pcm_") {
		return "PCM"
	}
	return ""
}

// ProbeChannels names a channel count as a layout ("5.1"); "" for a count with
// no usual layout.
func ProbeChannels(n int) string {
	switch n {
	case 1:
		return "1.0"
	case 2:
		return "2.0"
	case 3:
		return "2.1"
	case 4:
		return "4.0"
	case 5:
		return "5.0"
	case 6:
		return "5.1"
	case 7:
		return "6.1"
	case 8:
		return "7.1"
	}
	return ""
}
