package imports

import (
	"bytes"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"syscall"

	"github.com/hyprsh/kestrel/internal/release"
)

var videoExts = map[string]bool{
	".mkv": true, ".mp4": true, ".m4v": true, ".avi": true, ".mov": true, ".wmv": true,
	".ts": true, ".m2ts": true, ".mpg": true, ".mpeg": true, ".webm": true,
}

// textSubExts are the subtitle formats Import keeps; image subtitles (.sub/.idx, .sup) are not.
var textSubExts = map[string]bool{".srt": true, ".ass": true, ".ssa": true, ".vtt": true, ".smi": true}

var (
	sampleRx  = regexp.MustCompile(`(?i)(^|[^a-z0-9])samples?([^a-z0-9]|$)`)
	extraRx   = regexp.MustCompile(`(?i)[-._ ](trailer|featurette|interview|behindthescenes|deleted)([-._ ]|$)`)
	partRx    = regexp.MustCompile(`(?i)[-._ \[(](cd|dis[ck]|part|pt)[-._ ]?(\d+)([-._ \])]|$)`)
	flagSplit = regexp.MustCompile(`[^\p{L}\p{N}]+`)
)

var extraDirs = map[string]bool{
	"extras": true, "extra": true, "featurettes": true, "featurette": true, "behind the scenes": true,
	"deleted scenes": true, "interviews": true, "trailers": true, "scenes": true, "shorts": true, "other": true, "bonus": true,
}

// sub is a subtitle file found in a download.
type sub struct {
	path   string
	lang   string // canonical code; "" when the name says none
	forced bool
	sdh    bool
}

// selection is what Import takes from a finished download: the main video
// and the text subtitles. Samples, extras and junk are never picked.
type selection struct {
	video string
	// videos are all the episode-sized videos, largest first; a Series
	// download may hold one per episode.
	videos    []string
	multiPart bool
	subs      []sub
}

// selectFiles walks a finished download. The error is the walk's (a missing
// folder is os.ErrNotExist); a download with no video yields an empty video.
func selectFiles(source string) (selection, error) {
	st, err := os.Stat(source)
	if err != nil {
		return selection{}, err
	}
	var sel selection
	if !st.IsDir() {
		if videoExts[strings.ToLower(filepath.Ext(source))] {
			sel.video = source
			sel.videos = []string{source}
		}
		return sel, nil
	}
	type video struct {
		path string
		size int64
	}
	var videos []video
	err = filepath.WalkDir(source, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(source, p)
		if d.IsDir() {
			if rel != "." && (sampleRx.MatchString(d.Name()) || extraDirs[strings.ToLower(d.Name())]) {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		base := strings.TrimSuffix(d.Name(), filepath.Ext(p))
		switch {
		case videoExts[ext]:
			if sampleRx.MatchString(base) || extraRx.MatchString(base) {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return err
			}
			videos = append(videos, video{p, info.Size()})
		case textSubExts[ext]:
			sel.subs = append(sel.subs, subOf(p))
		}
		return nil
	})
	if err != nil {
		return selection{}, err
	}
	if len(videos) > 0 {
		slices.SortFunc(videos, func(a, b video) int {
			switch {
			case a.size != b.size:
				if a.size > b.size {
					return -1
				}
				return 1
			}
			return strings.Compare(a.path, b.path)
		})
		sel.video = videos[0].path
		for _, v := range videos {
			sel.videos = append(sel.videos, v.path)
		}
		parts := map[string]bool{}
		for _, v := range videos {
			if m := partRx.FindStringSubmatch(filepath.Base(v.path)); m != nil {
				parts[m[2]] = true
			}
		}
		sel.multiPart = len(parts) >= 2
	}
	return sel, nil
}

// subOf reads a subtitle's language and flags off its file name.
func subOf(path string) sub {
	s := sub{path: path}
	name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	for _, tok := range flagSplit.Split(strings.ToLower(name), -1) {
		switch tok {
		case "forced":
			s.forced = true
		case "sdh", "hi", "cc":
			s.sdh = true
		}
		if s.lang == "" {
			s.lang = languageToken(tok)
		}
	}
	return s
}

var tokenLanguages = func() map[string]string {
	m := map[string]string{}
	for code, name := range languageNames {
		m[code] = code
		m[strings.ToLower(name)] = code
		if l := release.LanguageByName(name); l.ISO() != "" {
			m[l.ISO()] = code
		}
	}
	return m
}()

func languageToken(tok string) string { return tokenLanguages[tok] }

// sidecars puts the wanted subtitles next to target, named after it. A
// subtitle in Primary or Original Language is kept; any other is left behind.
// It is safe to run again: a subtitle already there with the same content is
// not copied twice.
func (s *Service) sidecars(sel selection, target, primary, original string) {
	dir := filepath.Dir(target)
	stem := strings.TrimSuffix(filepath.Base(target), filepath.Ext(target))
	for _, sb := range sel.subs {
		if sb.lang == "" || (sb.lang != primary && sb.lang != original) {
			continue
		}
		body, err := os.ReadFile(sb.path)
		if err != nil {
			continue
		}
		ext := strings.ToLower(filepath.Ext(sb.path))
		name, err := SubtitleFileName(stem, sb.lang, sb.forced, sb.sdh, ext, func(n string) bool {
			have, err := os.ReadFile(filepath.Join(dir, n))
			return err == nil && !bytes.Equal(have, body)
		})
		if err != nil {
			continue
		}
		dst := filepath.Join(dir, name)
		if exists(dst) {
			continue
		}
		tmp := dst + ".tmp"
		if err := os.WriteFile(tmp, body, 0o666); err != nil {
			continue
		}
		if err := os.Rename(tmp, dst); err != nil {
			_ = os.Remove(tmp)
		}
	}
}

// removeWithSidecars deletes a video and the subtitles named after it.
func removeWithSidecars(video string) {
	_ = os.Remove(video)
	stem := strings.TrimSuffix(video, filepath.Ext(video))
	matches, _ := filepath.Glob(escapeGlob(stem) + ".*")
	for _, m := range matches {
		if textSubExts[strings.ToLower(filepath.Ext(m))] {
			_ = os.Remove(m)
		}
	}
}

func escapeGlob(s string) string {
	return strings.NewReplacer(`\`, `\\`, `*`, `\*`, `?`, `\?`, `[`, `\[`).Replace(s)
}

// place puts src at dst without disturbing src: a hardlink, or on EXDEV a
// verified copy. cross says it had to copy.
func place(link func(src, dst string) error, src, dst string) (cross bool, err error) {
	err = link(src, dst)
	if err == nil {
		return false, nil
	}
	if !errors.Is(err, syscall.EXDEV) {
		return false, err
	}
	return true, copyVerified(src, dst)
}

func copyVerified(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o666)
	if err != nil {
		return err
	}
	n, err := io.Copy(out, in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		var want os.FileInfo
		if want, err = os.Stat(src); err == nil && want.Size() != n {
			err = errors.New("copy is shorter than the source")
		}
	}
	if err != nil {
		_ = os.Remove(dst)
	}
	return err
}
