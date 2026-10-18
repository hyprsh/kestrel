package scoring

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/release"
)

//go:embed all:trash
var embeddedFS embed.FS

var (
	embeddedOnce sync.Once
	embeddedSnap *Snapshot
	embeddedErr  error
)

// Embedded returns the TRaSH snapshot compiled into the binary. It is loaded
// once and shared.
func Embedded() (*Snapshot, error) {
	embeddedOnce.Do(func() {
		sub, err := fs.Sub(embeddedFS, "trash")
		if err != nil {
			embeddedErr = err
			return
		}
		embeddedSnap, embeddedErr = LoadSnapshot(sub)
	})
	return embeddedSnap, embeddedErr
}

// Snapshot is a loaded TRaSH data set: for each app its Custom Formats, CF
// groups and quality profiles. Radarr's data scores Movies and Sonarr's scores
// Series. A Snapshot is immutable and safe for concurrent use.
type Snapshot struct {
	commit      string
	committedAt time.Time
	apps        map[release.Kind]*appData
}

// Commit is the TRaSH commit the snapshot was taken from, if recorded.
func (s *Snapshot) Commit() string { return s.commit }

// CommittedAt is when that commit was made (COMMITTED_AT, RFC 3339); zero if not
// recorded. It is what "newer" and the snapshot age mean.
func (s *Snapshot) CommittedAt() time.Time { return s.committedAt }

type appData struct {
	kind     release.Kind
	cfs      map[string]*customFormat // by trash_id
	groups   []*cfGroup
	profiles map[string]*backingProfile // by file name without .json
}

type customFormat struct {
	id     string
	name   string
	scores map[string]int
	specs  []*spec
}

// scoreIn is the CF's score in a score set, falling back to the default set
// and then to 0.
func (c *customFormat) scoreIn(set string) int {
	if set != "" {
		if s, ok := c.scores[set]; ok {
			return s
		}
	}
	return c.scores["default"]
}

type cfGroup struct {
	file      string
	isDefault bool
	include   map[string]bool // trash_ids of the profiles it applies to
	formats   []groupFormat
}

type groupFormat struct {
	id       string
	required bool
	def      bool
}

type backingProfile struct {
	file        string
	id          string
	scoreSet    string
	minScore    int
	formatItems []string // trash_ids, sorted
	qualities   []string // allowed quality names, flattened
}

var apps = []struct {
	dir  string
	kind release.Kind
}{
	{"radarr", release.KindMovie},
	{"sonarr", release.KindSeries},
}

// LoadSnapshot loads TRaSH JSON as it is published: for each of radarr and
// sonarr the directories cf, cf-groups and quality-profiles. It is
// all-or-nothing: an unknown condition type, a regex that does not compile, a
// missing trash_id or a reference to a Custom Format that does not exist
// rejects the whole snapshot with a readable error. An optional COMMIT file
// records the upstream commit.
func LoadSnapshot(fsys fs.FS) (*Snapshot, error) {
	s := &Snapshot{apps: map[release.Kind]*appData{}}
	if b, err := fs.ReadFile(fsys, "COMMIT"); err == nil {
		s.commit = strings.TrimSpace(string(b))
	}
	if b, err := fs.ReadFile(fsys, "COMMITTED_AT"); err == nil {
		s.committedAt, _ = time.Parse(time.RFC3339, strings.TrimSpace(string(b)))
	}
	for _, a := range apps {
		d, err := loadApp(fsys, a.dir, a.kind)
		if err != nil {
			return nil, err
		}
		s.apps[a.kind] = d
	}
	return s, nil
}

func jsonFiles(fsys fs.FS, dir string) ([]string, error) {
	entries, err := fs.ReadDir(fsys, dir)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			out = append(out, path.Join(dir, e.Name()))
		}
	}
	sort.Strings(out)
	return out, nil
}

func readJSON(fsys fs.FS, file string, v any) error {
	b, err := fs.ReadFile(fsys, file)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("%s: %w", file, err)
	}
	return nil
}

func loadApp(fsys fs.FS, dir string, kind release.Kind) (*appData, error) {
	d := &appData{kind: kind, cfs: map[string]*customFormat{}, profiles: map[string]*backingProfile{}}

	files, err := jsonFiles(fsys, dir+"/cf")
	if err != nil {
		return nil, fmt.Errorf("trash snapshot: %w", err)
	}
	for _, f := range files {
		cf, err := loadCF(fsys, f, kind)
		if err != nil {
			return nil, fmt.Errorf("trash snapshot: %w", err)
		}
		if prev, dup := d.cfs[cf.id]; dup {
			return nil, fmt.Errorf("trash snapshot: %s: trash_id %s is also used by %q", f, cf.id, prev.name)
		}
		d.cfs[cf.id] = cf
	}

	files, err = jsonFiles(fsys, dir+"/quality-profiles")
	if err != nil {
		return nil, fmt.Errorf("trash snapshot: %w", err)
	}
	for _, f := range files {
		p, err := loadBackingProfile(fsys, f, d)
		if err != nil {
			return nil, fmt.Errorf("trash snapshot: %w", err)
		}
		d.profiles[p.file] = p
	}

	files, err = jsonFiles(fsys, dir+"/cf-groups")
	if err != nil {
		return nil, fmt.Errorf("trash snapshot: %w", err)
	}
	for _, f := range files {
		g, err := loadGroup(fsys, f, d)
		if err != nil {
			return nil, fmt.Errorf("trash snapshot: %w", err)
		}
		d.groups = append(d.groups, g)
	}
	return d, nil
}

type rawCF struct {
	TrashID string         `json:"trash_id"`
	Name    string         `json:"name"`
	Scores  map[string]int `json:"trash_scores"`
	Specs   []rawSpec      `json:"specifications"`
}

func loadCF(fsys fs.FS, file string, kind release.Kind) (*customFormat, error) {
	var raw rawCF
	if err := readJSON(fsys, file, &raw); err != nil {
		return nil, err
	}
	if raw.TrashID == "" {
		return nil, fmt.Errorf("%s: custom format has no trash_id", file)
	}
	if raw.Name == "" {
		return nil, fmt.Errorf("%s: custom format has no name", file)
	}
	if len(raw.Specs) == 0 {
		return nil, fmt.Errorf("%s: custom format %q has no specifications", file, raw.Name)
	}
	cf := &customFormat{id: raw.TrashID, name: raw.Name, scores: raw.Scores}
	for i, rs := range raw.Specs {
		sp, err := compileSpec(rs, kind)
		if err != nil {
			return nil, fmt.Errorf("%s: custom format %q, specification %d: %w", file, raw.Name, i+1, err)
		}
		cf.specs = append(cf.specs, sp)
	}
	return cf, nil
}

type rawQualityItem struct {
	Name    string   `json:"name"`
	Allowed bool     `json:"allowed"`
	Items   []string `json:"items"`
}

type rawProfile struct {
	TrashID     string            `json:"trash_id"`
	ScoreSet    string            `json:"trash_score_set"`
	MinScore    int               `json:"minFormatScore"`
	Items       []rawQualityItem  `json:"items"`
	FormatItems map[string]string `json:"formatItems"`
}

func loadBackingProfile(fsys fs.FS, file string, d *appData) (*backingProfile, error) {
	var raw rawProfile
	if err := readJSON(fsys, file, &raw); err != nil {
		return nil, err
	}
	if raw.TrashID == "" {
		return nil, fmt.Errorf("%s: quality profile has no trash_id", file)
	}
	p := &backingProfile{
		file:     strings.TrimSuffix(path.Base(file), ".json"),
		id:       raw.TrashID,
		scoreSet: raw.ScoreSet,
		minScore: raw.MinScore,
	}
	for name, id := range raw.FormatItems {
		if _, ok := d.cfs[id]; !ok {
			return nil, fmt.Errorf("%s: formatItems %q refers to unknown trash_id %s", file, name, id)
		}
		p.formatItems = append(p.formatItems, id)
	}
	sort.Strings(p.formatItems)
	for _, it := range raw.Items {
		if !it.Allowed {
			continue
		}
		if len(it.Items) > 0 {
			p.qualities = append(p.qualities, it.Items...)
		} else {
			p.qualities = append(p.qualities, it.Name)
		}
	}
	return p, nil
}

type rawGroup struct {
	Default       json.RawMessage `json:"default"`
	CustomFormats []struct {
		TrashID  string          `json:"trash_id"`
		Required bool            `json:"required"`
		Default  json.RawMessage `json:"default"`
	} `json:"custom_formats"`
	QualityProfiles struct {
		Include map[string]string `json:"include"`
	} `json:"quality_profiles"`
}

// truthy reads TRaSH's flags, which are JSON booleans in some places and the
// strings "true" and "false" in others. Missing is false.
func truthy(raw json.RawMessage) bool {
	s := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	return strings.EqualFold(s, "true")
}

func loadGroup(fsys fs.FS, file string, d *appData) (*cfGroup, error) {
	var raw rawGroup
	if err := readJSON(fsys, file, &raw); err != nil {
		return nil, err
	}
	g := &cfGroup{
		file:      strings.TrimSuffix(path.Base(file), ".json"),
		isDefault: truthy(raw.Default),
		include:   map[string]bool{},
	}
	for _, id := range raw.QualityProfiles.Include {
		g.include[id] = true
	}
	for _, c := range raw.CustomFormats {
		if _, ok := d.cfs[c.TrashID]; !ok {
			return nil, fmt.Errorf("%s: custom format refers to unknown trash_id %q", file, c.TrashID)
		}
		g.formats = append(g.formats, groupFormat{id: c.TrashID, required: c.Required, def: truthy(c.Default)})
	}
	return g, nil
}
