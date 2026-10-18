package imports

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/release"
)

// CleanupCategory groups the Unmanaged files Clean up can delete.
type CleanupCategory string

// The Clean up categories.
const (
	CleanupJunk               CleanupCategory = "junk"
	CleanupSamples            CleanupCategory = "samples"
	CleanupOrphanedSubtitles  CleanupCategory = "orphaned_subtitles"
	CleanupEmptyFolders       CleanupCategory = "empty_folders"
	CleanupOtherLangSubtitles CleanupCategory = "other_language_subtitles"
	CleanupArtwork            CleanupCategory = "artwork"
	CleanupExtras             CleanupCategory = "extras"
	CleanupUnmanagedVideos    CleanupCategory = "unmanaged_videos"
)

// cleanupOrder is the order the categories are shown in.
var cleanupOrder = []CleanupCategory{
	CleanupJunk, CleanupSamples, CleanupOrphanedSubtitles, CleanupEmptyFolders,
	CleanupOtherLangSubtitles, CleanupArtwork, CleanupExtras, CleanupUnmanagedVideos,
}

// DefaultTicked says whether a category is safe enough to be ticked by default.
func (c CleanupCategory) DefaultTicked() bool {
	switch c {
	case CleanupJunk, CleanupSamples, CleanupOrphanedSubtitles, CleanupEmptyFolders:
		return true
	}
	return false
}

var (
	// ErrNoPreview means the preview is unknown or expired.
	ErrNoPreview = errors.New("no such Clean up preview")
	// ErrNoTitle means the Title is not tracked or has no folder yet.
	ErrNoTitle = errors.New("no such Title folder")

	junkExts   = map[string]bool{".nfo": true, ".sfv": true, ".txt": true, ".url": true, ".exe": true}
	junkNames  = map[string]bool{"thumbs.db": true, ".ds_store": true}
	imageExts  = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".tbn": true}
	artworkRx  = regexp.MustCompile(`(?i)(^|[-_. ])(poster|fanart|folder|banner|logo|clearart|clearlogo|landscape|thumb|backdrop|background|cover|disc|keyart)$|^season[-0-9a-z ]*$`)
	cleanupTTL = time.Hour
)

const maxPreviews = 8

// CleanupFile is an Unmanaged file (or empty folder) a category lists.
type CleanupFile struct {
	Path    string
	Size    int64
	TitleID int64
}

// CleanupGroup is one category of a preview.
type CleanupGroup struct {
	Key           CleanupCategory
	DefaultTicked bool
	Size          int64
	Files         []CleanupFile
}

// CleanupPreview is what Clean up would delete, by category.
type CleanupPreview struct {
	ID         string
	Categories []CleanupGroup
}

// CleanupResult is what a run deleted.
type CleanupResult struct {
	Deleted, Failed int
	Bytes           int64
}

// CleanupDeps are what Clean up needs.
type CleanupDeps struct {
	Library  AdoptLibrary
	Profiles AdoptProfiles
	History  *history.Service
	Clock    func() time.Time
	// FolderChanged, when set, is told each Title folder files were deleted
	// from, so the media servers can be asked to refresh it.
	FolderChanged func(ctx context.Context, folder string)
}

// Cleanup deletes Unmanaged files inside tracked Titles' folders, by category.
// It is manual and permanent: a preview lists, a run deletes what it listed.
type Cleanup struct {
	d        CleanupDeps
	mu       sync.Mutex
	previews map[string]storedPreview
}

type storedPreview struct {
	at      time.Time
	preview CleanupPreview
	folders map[int64]string
}

// NewCleanup returns the Clean up service.
func NewCleanup(d CleanupDeps) *Cleanup {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	return &Cleanup{d: d, previews: map[string]storedPreview{}}
}

// Preview lists the Unmanaged files of the named tracked Titles, or of every
// tracked Title when none is named. Files any Version holds are never listed.
func (c *Cleanup) Preview(ctx context.Context, titleIDs []int64) (CleanupPreview, error) {
	tracked, err := c.d.Library.Tracked(ctx)
	if err != nil {
		return CleanupPreview{}, err
	}
	held, err := c.d.Library.HeldPaths(ctx)
	if err != nil {
		return CleanupPreview{}, err
	}
	region, _, err := c.d.Profiles.Region(ctx)
	if err != nil {
		return CleanupPreview{}, err
	}
	primary := codeOfLanguage(region.Primary.Release())

	byCat := map[CleanupCategory]*CleanupGroup{}
	for _, k := range cleanupOrder {
		byCat[k] = &CleanupGroup{Key: k, DefaultTicked: k.DefaultTicked()}
	}
	folders := map[int64]string{}
	known := map[int64]bool{}
	for _, t := range tracked {
		if (len(titleIDs) > 0 && !slices.Contains(titleIDs, t.TitleID)) || t.Folder == "" {
			continue
		}
		known[t.TitleID] = true
		dir := filepath.Join(t.RootFolder, t.Folder)
		if st, err := os.Stat(dir); err != nil || !st.IsDir() {
			continue
		}
		original := ""
		if d, err := c.d.Library.Get(ctx, t.TitleID, library.View{Now: c.d.Clock()}); err == nil {
			original = codeOfLanguage(release.LanguageByISO(d.OriginalLanguage))
		}
		folders[t.TitleID] = dir
		for _, f := range scanFolder(dir, held, primary, original) {
			f.file.TitleID = t.TitleID
			g := byCat[f.cat]
			g.Files = append(g.Files, f.file)
			g.Size += f.file.Size
		}
	}
	for _, id := range titleIDs {
		if !known[id] {
			return CleanupPreview{}, ErrNoTitle
		}
	}
	p := CleanupPreview{ID: newPreviewID()}
	for _, k := range cleanupOrder {
		g := byCat[k]
		sort.Slice(g.Files, func(i, j int) bool { return g.Files[i].Path < g.Files[j].Path })
		p.Categories = append(p.Categories, *g)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.d.Clock()
	for id, sp := range c.previews {
		if now.Sub(sp.at) > cleanupTTL {
			delete(c.previews, id)
		}
	}
	for len(c.previews) >= maxPreviews {
		oldest := ""
		for id, sp := range c.previews {
			if oldest == "" || sp.at.Before(c.previews[oldest].at) {
				oldest = id
			}
		}
		delete(c.previews, oldest)
	}
	c.previews[p.ID] = storedPreview{at: now, preview: p, folders: folders}
	return p, nil
}

func newPreviewID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Run deletes the files the preview listed in the named categories, except
// the excluded paths and any file a Version holds by now.
func (c *Cleanup) Run(ctx context.Context, previewID string, cats []CleanupCategory, exclude []string) (CleanupResult, error) {
	c.mu.Lock()
	sp, ok := c.previews[previewID]
	c.mu.Unlock()
	if !ok || c.d.Clock().Sub(sp.at) > cleanupTTL {
		return CleanupResult{}, ErrNoPreview
	}
	held, err := c.d.Library.HeldPaths(ctx)
	if err != nil {
		return CleanupResult{}, err
	}
	skip := map[string]bool{}
	for _, p := range exclude {
		skip[p] = true
	}
	ticked := map[CleanupCategory]bool{}
	for _, k := range cats {
		ticked[k] = true
	}
	var res CleanupResult
	perTitle := map[int64]*CleanupResult{}
	var dirs []string
	for _, g := range sp.preview.Categories {
		if !ticked[g.Key] {
			continue
		}
		for _, f := range g.Files {
			if skip[f.Path] || held[f.Path] {
				continue
			}
			tr := perTitle[f.TitleID]
			if tr == nil {
				tr = &CleanupResult{}
				perTitle[f.TitleID] = tr
			}
			if g.Key == CleanupEmptyFolders {
				dirs = append(dirs, f.Path)
				continue
			}
			if st, err := os.Lstat(f.Path); err != nil || !st.Mode().IsRegular() {
				continue
			}
			if err := os.Remove(f.Path); err != nil {
				res.Failed++
				tr.Failed++
				continue
			}
			res.Deleted++
			res.Bytes += f.Size
			tr.Deleted++
			tr.Bytes += f.Size
			if ticked[CleanupEmptyFolders] {
				dirs = append(dirs, filepath.Dir(f.Path))
			}
		}
	}
	removeEmptyDirs(dirs, sp.folders)
	titles := make([]int64, 0, len(perTitle))
	for id := range perTitle {
		titles = append(titles, id)
	}
	sort.Slice(titles, func(i, j int) bool { return titles[i] < titles[j] })
	for _, id := range titles {
		tr := perTitle[id]
		if tr.Deleted == 0 {
			continue
		}
		c.d.History.Record(ctx, history.Event{
			Kind: history.CleanupDone, TitleID: id,
			Message: fmt.Sprintf("Cleaned up %d Unmanaged file(s), %d bytes", tr.Deleted, tr.Bytes),
		})
		if c.d.FolderChanged != nil {
			c.d.FolderChanged(ctx, sp.folders[id])
		}
	}
	c.mu.Lock()
	delete(c.previews, previewID)
	c.mu.Unlock()
	return res, nil
}

// removeEmptyDirs removes each directory and, while they are empty, its
// parents, never reaching a Title folder itself.
func removeEmptyDirs(dirs []string, folders map[int64]string) {
	roots := map[string]bool{}
	for _, f := range folders {
		roots[f] = true
	}
	sort.Slice(dirs, func(i, j int) bool { return len(dirs[i]) > len(dirs[j]) })
	for _, d := range dirs {
		for !roots[d] && inside(folders, d) {
			if os.Remove(d) != nil {
				break
			}
			d = filepath.Dir(d)
		}
	}
}

func inside(folders map[int64]string, p string) bool {
	for _, f := range folders {
		if strings.HasPrefix(p, f+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

type found struct {
	cat  CleanupCategory
	file CleanupFile
}

// scanFolder classifies the Unmanaged files and empty folders under a Title folder.
func scanFolder(root string, held map[string]bool, primary, original string) []found {
	var out []found
	// videos maps a directory to its videos' path stems, each marked held or not.
	videos := map[string]map[string]bool{}
	var files, dirs []string
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if p != root {
				dirs = append(dirs, p)
			}
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		name := d.Name()
		if strings.HasPrefix(name, ".kestrel-") || strings.HasSuffix(name, ".partial") || strings.HasSuffix(name, ".tmp") {
			return nil
		}
		files = append(files, p)
		if videoExts[strings.ToLower(filepath.Ext(name))] {
			dir := filepath.Dir(p)
			if videos[dir] == nil {
				videos[dir] = map[string]bool{}
			}
			videos[dir][strings.TrimSuffix(p, filepath.Ext(p))] = held[p]
		}
		return nil
	})
	add := func(cat CleanupCategory, p string) {
		var size int64
		if st, err := os.Stat(p); err == nil {
			size = st.Size()
		}
		out = append(out, found{cat: cat, file: CleanupFile{Path: p, Size: size}})
	}
	for _, p := range files {
		if held[p] {
			continue
		}
		name := filepath.Base(p)
		ext := strings.ToLower(filepath.Ext(name))
		base := strings.TrimSuffix(name, filepath.Ext(name))
		rel, _ := filepath.Rel(root, filepath.Dir(p))
		inSample, inExtra := false, false
		if rel != "." {
			for _, part := range strings.Split(rel, string(filepath.Separator)) {
				inSample = inSample || sampleRx.MatchString(part)
				inExtra = inExtra || extraDirs[strings.ToLower(part)]
			}
		}
		switch {
		case junkExts[ext] || junkNames[strings.ToLower(name)]:
			add(CleanupJunk, p)
		case videoExts[ext]:
			switch {
			case inSample || sampleRx.MatchString(base):
				add(CleanupSamples, p)
			case inExtra || extraRx.MatchString(base):
				add(CleanupExtras, p)
			default:
				add(CleanupUnmanagedVideos, p)
			}
		case subtitleExts[ext]:
			attached, heldVideo := false, false
			for stem, h := range videos[filepath.Dir(p)] {
				if strings.HasPrefix(p, stem+".") {
					attached = true
					heldVideo = heldVideo || h
				}
			}
			if !attached {
				add(CleanupOrphanedSubtitles, p)
			} else if heldVideo {
				if s := subOf(p); s.lang != "" && s.lang != primary && s.lang != original {
					add(CleanupOtherLangSubtitles, p)
				}
			}
		case imageExts[ext] && artworkRx.MatchString(base):
			add(CleanupArtwork, p)
		}
	}
	// Empty folders: no file anywhere below.
	hasFile := map[string]bool{}
	for _, p := range files {
		for d := filepath.Dir(p); len(d) > len(root); d = filepath.Dir(d) {
			hasFile[d] = true
		}
	}
	for _, d := range dirs {
		if !hasFile[d] {
			out = append(out, found{cat: CleanupEmptyFolders, file: CleanupFile{Path: d}})
		}
	}
	return out
}
