package release

import (
	"regexp"
	"strings"
)

// Media facts are not part of the *arr grammar: Radarr and Sonarr read the
// source and resolution into the quality and leave codec, HDR and audio to
// Custom Formats. Kestrel shows them on files and Releases, so this file reads
// them off the same release name with a few ordered patterns. A fact the name
// does not state stays empty; nothing is guessed.

// Video codec, HDR and audio labels as shown in the SPA.
const (
	VideoH264  = "H.264"
	VideoH265  = "H.265"
	VideoAV1   = "AV1"
	VideoVC1   = "VC-1"
	VideoMPEG2 = "MPEG-2"
	VideoVP9   = "VP9"
	VideoXviD  = "XviD"
	VideoDivX  = "DivX"
)

// left and right keep a token from matching inside a longer word.
const (
	mLeft  = `(?:^|[^a-z0-9])`
	mRight = `(?:[^a-z]|$)`
)

type mediaPattern struct {
	re    *regexp.Regexp
	label string
}

func mediaPatterns(tokens ...[2]string) []mediaPattern {
	out := make([]mediaPattern, len(tokens))
	for i, t := range tokens {
		out[i] = mediaPattern{regexp.MustCompile(`(?i)` + mLeft + `(?:` + t[0] + `)` + mRight), t[1]}
	}
	return out
}

var videoPatterns = mediaPatterns(
	[2]string{`x[ ._-]?265|h[ ._-]?265|hevc`, VideoH265},
	[2]string{`x[ ._-]?264|h[ ._-]?264|avc(?:hd)?`, VideoH264},
	[2]string{`av1`, VideoAV1},
	[2]string{`vc[ ._-]?1`, VideoVC1},
	[2]string{`mpeg[ ._-]?2`, VideoMPEG2},
	[2]string{`vp9`, VideoVP9},
	[2]string{`xvid`, VideoXviD},
	[2]string{`divx`, VideoDivX},
)

// audioPatterns are ordered most specific first; the first that matches wins.
var audioPatterns = mediaPatterns(
	[2]string{`truehd`, "TrueHD"},
	[2]string{`dts[ ._-]?hd[ ._-]?(?:ma|master(?:[ ._-]?audio)?)`, "DTS-HD MA"},
	[2]string{`dts[ ._-]?hd[ ._-]?(?:hra|hr)`, "DTS-HD HRA"},
	[2]string{`dts[ ._:-]?x`, "DTS:X"},
	[2]string{`dts[ ._-]?hd`, "DTS-HD"},
	[2]string{`dts(?:[ ._-]?es)?`, "DTS"},
	[2]string{`ddp|dd\+|e[ ._-]?ac[ ._-]?3|dolby[ ._-]?digital[ ._-]?plus`, "DDP"},
	[2]string{`dd|ac[ ._-]?3|dolby[ ._-]?digital`, "DD"},
	[2]string{`(?:he[ ._-]?)?aac(?:[ ._-]?lc)?`, "AAC"},
	[2]string{`flac`, "FLAC"},
	[2]string{`opus`, "Opus"},
	[2]string{`mp3`, "MP3"},
	[2]string{`l?pcm`, "PCM"},
)

var (
	atmosRe = regexp.MustCompile(`(?i)` + mLeft + `atmos` + mRight)
	// A "DD+" or "DD+5.1" is not followed by a letter, but its plus is not a
	// letter either, so the generic right edge already allows it.
	channelsRe = regexp.MustCompile(`(?i)(?:^|[^0-9a-z])([1-8])[. ]([01])(?:[^0-9a-z]|$)`)

	hdrDVRe   = regexp.MustCompile(`(?i)` + mLeft + `(?:dv|dovi|dolby[ ._-]?vision)` + mRight)
	hdr10PlRe = regexp.MustCompile(`(?i)` + mLeft + `hdr10(?:\+|[ ._-]?plus)`)
	hdr10Re   = regexp.MustCompile(`(?i)` + mLeft + `hdr10` + mRight)
	hdrRe     = regexp.MustCompile(`(?i)` + mLeft + `hdr` + mRight)
	hlgRe     = regexp.MustCompile(`(?i)` + mLeft + `hlg` + mRight)
)

// ParseMedia reads the video codec, HDR format, audio codec and audio channel
// layout a release name states. Each result is "" when the name does not say.
// The audio codec carries Atmos where the name does ("TrueHD Atmos", "DDP
// Atmos"); channels are "2.0", "5.1", "7.1" and so on.
func ParseMedia(name string) (videoCodec, hdr, audioCodec, audioChannels string) {
	for _, p := range videoPatterns {
		if p.re.MatchString(name) {
			videoCodec = p.label
			break
		}
	}
	hdr = parseHDR(name)

	var audioEnd int
	for _, p := range audioPatterns {
		if loc := p.re.FindStringIndex(name); loc != nil {
			audioCodec, audioEnd = p.label, loc[1]
			break
		}
	}
	atmos := atmosRe.MatchString(name)
	switch {
	case audioCodec == "" && atmos:
		audioCodec = "Atmos"
	case atmos && (audioCodec == "TrueHD" || audioCodec == "DDP" || audioCodec == "DD"):
		audioCodec += " Atmos"
	}
	if audioCodec != "" {
		// Channels count only once an audio codec is named, and only after it
		// ("DDP5.1", "DD+.5.1", "TrueHD.Atmos.7.1"): a bare "5.1" anywhere
		// else in a name is as likely to be a version.
		start := max(audioEnd-1, 0)
		if m := channelsRe.FindStringSubmatch(name[start:]); m != nil {
			audioChannels = m[1] + "." + m[2]
		}
	}
	return
}

func parseHDR(name string) string {
	dv := hdrDVRe.MatchString(name)
	var base string
	switch {
	case hdr10PlRe.MatchString(name):
		base = "HDR10+"
	case hdr10Re.MatchString(name):
		base = "HDR10"
	case hdrRe.MatchString(name):
		base = "HDR"
	case hlgRe.MatchString(name):
		base = "HLG"
	}
	switch {
	case dv && base != "" && base != "HLG":
		return "Dolby Vision " + base
	case dv:
		return "Dolby Vision"
	}
	return base
}

// fillMedia sets the media facts of p from the name it was parsed from.
func fillMedia(p ParsedRelease, name string) ParsedRelease {
	p.VideoCodec, p.HDR, p.AudioCodec, p.AudioChannels = ParseMedia(strings.TrimSpace(name))
	return p
}
