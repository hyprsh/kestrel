// Package imports holds the pure rules for turning a release into library
// names (ADR 0003, PRD #22 Naming and Settled 4). It does no I/O: the Import
// and Adoption code passes in the parsed and probed facts and gets back the
// folder and file names to use.
package imports

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
)

// Slot is the place in a Title that one Version fills. It shares the
// resolution-class type with probe.ClassOf until a shared home exists (#28).
type Slot = probe.Class

// maxNameBytes is the longest file or folder name the naming scheme makes.
const maxNameBytes = 255

var (
	// ErrTooLong means the brackets and ID tag alone do not fit in a name, so
	// the title cannot be trimmed enough.
	ErrTooLong = errors.New("name does not fit in 255 bytes")
	// ErrMissingTitle means the Title has no name to build a name from.
	ErrMissingTitle = errors.New("title has no name")
	// ErrMissingID means the Title has no provider ID for its folder tag.
	ErrMissingID = errors.New("title has no provider id for its folder tag")
	// ErrInvalidEpisode means the episode range is not a range of episodes.
	ErrInvalidEpisode = errors.New("episode range is invalid")
	// ErrInvalidExt means the extension does not start with a dot.
	ErrInvalidExt = errors.New("file extension must start with a dot")
)

// Title is what the folder and file names need to know about a Title.
// Name is the English title (the caller falls back to the original), Year is 0
// when unknown, and the provider IDs are the folder tags.
type Title struct {
	Name             string
	Year             int
	TMDBID           int    // Movies: {tmdb-N}
	TVDBID           int    // Series: {tvdb-N}
	OriginalLanguage string // canonical code; "" when unknown
}

// FileFacts are the facts about one file that its name is built from.
//
// Release carries the quality (source and resolution, from the name),
// revision, edition and release group. Probe carries the HDR, video codec and
// audio tracks. Languages are the canonical codes the file's audio is known to
// carry, as probe.ResolveLanguages returns them. Primary is the household's
// Primary Language, a canonical code.
type FileFacts struct {
	Release   release.ParsedRelease
	Probe     probe.Info
	Languages []string
	Primary   string
}

// Episode is the episode or range of episodes in one Series file. Specials are
// season 0.
type Episode struct {
	Season int
	First  int
	Last   int
}

// MovieFolder is the folder a Movie lives in: `Title (Year) {tmdb-N}`.
func MovieFolder(t Title) (string, error) {
	if t.TMDBID <= 0 {
		return "", ErrMissingID
	}
	tail := yearPart(t.Year) + fmt.Sprintf(" {tmdb-%d}", t.TMDBID)
	return nameWithTitle(t.Name, tail, "")
}

// SeriesFolder is the folder a Series lives in: `Title (Year) {tvdb-N}`.
func SeriesFolder(t Title) (string, error) {
	if t.TVDBID <= 0 {
		return "", ErrMissingID
	}
	tail := yearPart(t.Year) + fmt.Sprintf(" {tvdb-%d}", t.TVDBID)
	return nameWithTitle(t.Name, tail, "")
}

// SeasonFolder is the folder an episode's season lives in: `Season 01`, or
// `Specials` for season 0.
func SeasonFolder(season int) string {
	if season == 0 {
		return "Specials"
	}
	return fmt.Sprintf("Season %02d", season)
}

// MovieFileName is a Movie Version's file: the Movie folder, ` - `, the Slot
// label and the brackets, then the extension (which includes its dot). Every
// file of a Movie starts with the folder name, so Jellyfin groups the Versions.
func MovieFileName(t Title, slot Slot, f FileFacts, ext string) (string, error) {
	if t.TMDBID <= 0 {
		return "", ErrMissingID
	}
	tail := yearPart(t.Year) + fmt.Sprintf(" {tmdb-%d}", t.TMDBID)
	return fileName(t, tail, slot, f, ext)
}

// EpisodeFileName is a Series episode's file: `Title (Year) - S01E01`, the
// Slot label and the brackets, then the extension. Episode titles are left
// out, so TheTVDB edits never rename a file. A range is `S01E01-E02`.
func EpisodeFileName(t Title, slot Slot, ep Episode, f FileFacts, ext string) (string, error) {
	if ep.First < 1 || ep.Last < ep.First || ep.Season < 0 {
		return "", ErrInvalidEpisode
	}
	code := fmt.Sprintf(" - S%02dE%02d", ep.Season, ep.First)
	if ep.Last > ep.First {
		code += fmt.Sprintf("-E%02d", ep.Last)
	}
	return fileName(t, yearPart(t.Year)+code, slot, f, ext)
}

// SubtitleFileName names a subtitle sidecar `<stem>.<lang>[.forced][.sdh].<ext>`
// for the video file whose name without extension is stem. An empty or
// untagged language is `und`. When taken reports that a candidate already
// exists, a counter `.2`, `.3`, ... goes before the extension.
func SubtitleFileName(stem, lang string, forced, sdh bool, ext string, taken func(string) bool) (string, error) {
	if !strings.HasPrefix(ext, ".") {
		return "", ErrInvalidExt
	}
	lang = probe.NormalizeLanguage(lang)
	if lang == "" {
		lang = "und"
	}
	base := stem + "." + lang
	if forced {
		base += ".forced"
	}
	if sdh {
		base += ".sdh"
	}
	name := base + ext
	for n := 2; taken != nil && taken(name); n++ {
		name = fmt.Sprintf("%s.%d%s", base, n, ext)
	}
	if len(name) > maxNameBytes {
		return "", ErrTooLong
	}
	return name, nil
}

// fileName assembles `Title<tail> - [Slot]<brackets>-GROUP<ext>`, with the
// title trimmed so the whole name fits. tail is what sits between the title
// and the Slot label (the year and ID tag, and any episode code).
func fileName(t Title, tail string, slot Slot, f FileFacts, ext string) (string, error) {
	if !strings.HasPrefix(ext, ".") {
		return "", ErrInvalidExt
	}
	rest := " - [" + slot.String() + "]" + brackets(t, f)
	group := ""
	if g := sanitizeBracket(f.Release.ReleaseGroup); g != "" {
		group = "-" + g
	}
	return nameWithTitle(t.Name, tail, rest+group+ext)
}

// nameWithTitle is the sanitized title, then tail, then suffix, with the
// title trimmed so the whole name fits 255 bytes. The title is first trimmed
// for the folder (tail alone), so a file keeps the folder's title whenever its
// whole name fits. Only a file that would overflow is trimmed further.
func nameWithTitle(title, tail, suffix string) (string, error) {
	clean := sanitizeTitle(title)
	if clean == "" {
		return "", ErrMissingTitle
	}
	folderTitle, err := fitTitle(clean, len(tail))
	if err != nil {
		return "", err
	}
	if len(folderTitle)+len(tail)+len(suffix) <= maxNameBytes {
		return folderTitle + tail + suffix, nil
	}
	trimmed, err := fitTitle(clean, len(tail)+len(suffix))
	if err != nil {
		return "", err
	}
	return trimmed + tail + suffix, nil
}

// fitTitle trims title on a word boundary so that the title plus reserve bytes
// fits in maxNameBytes. Runes are kept whole. A title that cannot keep one
// word is ErrTooLong.
func fitTitle(title string, reserve int) (string, error) {
	budget := maxNameBytes - reserve
	if len(title) <= budget {
		return title, nil
	}
	if budget <= 0 {
		return "", ErrTooLong
	}
	cut := budget
	for cut > 0 && !utf8.RuneStart(title[cut]) {
		cut--
	}
	head := title[:cut]
	if i := strings.LastIndexByte(head, ' '); i > 0 {
		head = head[:i]
	}
	head = strings.TrimRight(head, ". ")
	if head == "" {
		return "", ErrTooLong
	}
	return head, nil
}

// sanitizeTitle applies the Smart colon replacement and strips the characters
// no file system accepts, then trims trailing dots and spaces.
func sanitizeTitle(s string) string {
	s = strings.ReplaceAll(s, ": ", " - ")
	s = strings.ReplaceAll(s, ":", "-")
	return strings.TrimRight(stripIllegal(s), ". ")
}

// sanitizeBracket makes bracket text (edition, group) safe for a file name.
func sanitizeBracket(s string) string {
	return strings.TrimSpace(stripIllegal(s))
}

func stripIllegal(s string) string {
	return strings.Map(func(r rune) rune {
		if strings.ContainsRune(`\/*?"<>|`, r) {
			return -1
		}
		return r
	}, s)
}

func yearPart(year int) string {
	if year <= 0 {
		return ""
	}
	return fmt.Sprintf(" (%d)", year)
}

// brackets returns the bracket run after the Slot label in Radarr's order:
// quality (with Proper or Repack), edition, language, audio, HDR, video codec.
func brackets(t Title, f FileFacts) string {
	var b strings.Builder
	b.WriteString(qualityBracket(f.Release.Quality))
	if e := sanitizeBracket(f.Release.Edition); e != "" {
		b.WriteString("[" + e + "]")
	}
	primary := probe.NormalizeLanguage(f.Primary)
	if l := languageTag(primary, probe.NormalizeLanguage(t.OriginalLanguage), canonicalCodes(f.Languages)); l != "" {
		b.WriteString(l)
	}
	if a := audioBracket(f.Probe); a != "" {
		b.WriteString("[" + a + "]")
	}
	if f.Probe.HDR != "" {
		b.WriteString("[" + f.Probe.HDR + "]")
	}
	if v := videoCodec(f.Probe.VideoCodec); v != "" {
		b.WriteString("[" + v + "]")
	}
	return b.String()
}

func qualityBracket(q release.QualityModel) string {
	if q.Quality.Name == "" {
		return ""
	}
	name := q.Quality.Name
	switch {
	case q.Revision.IsRepack:
		name += " Repack"
	case q.Revision.Version > 1:
		name += " Proper"
	}
	return "[" + name + "]"
}

// audioBracket is the codec and channel layout of the default audio track, or
// the first track when none is marked default, such as `DTS 5.1`.
func audioBracket(info probe.Info) string {
	if len(info.Audio) == 0 {
		return ""
	}
	track := info.Audio[0]
	for _, tr := range info.Audio {
		if tr.Default {
			track = tr
			break
		}
	}
	codec := audioCodec(track.Codec)
	if codec == "" {
		return ""
	}
	if layout := channelLayout(track.Channels); layout != "" {
		return codec + " " + layout
	}
	return codec
}

func audioCodec(codec string) string {
	switch {
	case codec == "":
		return ""
	case strings.HasPrefix(codec, "pcm_"):
		return "PCM"
	}
	if name, ok := audioCodecNames[codec]; ok {
		return name
	}
	return strings.ToUpper(codec)
}

var audioCodecNames = map[string]string{
	"dts":    "DTS",
	"eac3":   "EAC3",
	"ac3":    "AC3",
	"aac":    "AAC",
	"truehd": "TrueHD",
	"flac":   "FLAC",
	"opus":   "Opus",
	"mp3":    "MP3",
	"vorbis": "Vorbis",
}

var channelLayouts = map[int]string{
	1: "1.0",
	2: "2.0",
	3: "2.1",
	4: "4.0",
	5: "5.0",
	6: "5.1",
	7: "6.1",
	8: "7.1",
}

func channelLayout(channels int) string {
	return channelLayouts[channels]
}

var videoCodecNames = map[string]string{
	"h264":       "h264",
	"hevc":       "h265",
	"av1":        "AV1",
	"vp9":        "VP9",
	"mpeg2video": "MPEG2",
	"vc1":        "VC1",
}

func videoCodec(codec string) string {
	if name, ok := videoCodecNames[codec]; ok {
		return name
	}
	return codec
}
