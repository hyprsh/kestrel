// Command cfgolden is a dev-only tool. It loads the embedded TRaSH Custom
// Formats into a running, pinned Radarr or Sonarr instance, adds a few Titles
// so "Original" resolves, sends a corpus of release names to
// GET /api/v3/parse and records which Custom Formats matched (never the
// Score) as a golden file. CI replays that file offline against
// scoring.Evaluate, with no Docker (internal/scoring parity test).
//
// Run it through scripts/regen-cf-golden.sh, which starts the pinned
// containers.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type title struct {
	Key  string
	ID   int    // tmdbId or tvdbId
	Year int    // movies: the year used in release names
	Name string // the name used in release names, dot separated
}

var movies = []title{
	{"matrix", 603, 1999, "The.Matrix"},      // English original
	{"dasboot", 387, 1981, "Das.Boot"},       // German original
	{"amelie", 194, 2001, "Amelie"},          // French original
	{"spirited", 129, 2001, "Spirited.Away"}, // Japanese original
}

var series = []title{
	{"breakingbad", 81189, 0, "Breaking.Bad"},   // English original
	{"dark", 334824, 0, "Dark"},                 // German original
	{"callmyagent", 300247, 0, "Call.My.Agent"}, // French original
}

// tails are what follows the title in a release name; {G} is a release group.
var tails = []string{
	"1080p.BluRay.x264-{G}",
	"1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-{G}",
	"2160p.UHD.BluRay.REMUX.HDR.HEVC.TrueHD.Atmos.7.1-{G}",
	"2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-{G}",
	"2160p.WEB-DL.DDP5.1.HDR10Plus.H.265-{G}",
	"1080p.WEB-DL.DDP5.1.H.264-{G}",
	"1080p.WEBRip.x265-{G}",
	"720p.WEB-DL.DD5.1.H.264-{G}",
	"720p.BluRay.x264-{G}",
	"480p.DVDRip.x264-{G}",
	"576p.BluRay.x264-{G}",
	"German.DL.1080p.BluRay.x264-{G}",
	"German.DL.2160p.WEB-DL.DDP5.1.HDR.H.265-{G}",
	"German.1080p.WEB-DL.DD5.1.H.264-{G}",
	"German.AC3.DL.720p.BluRay.x264-{G}",
	"German.DL.1080p.WEB.H264-{G}",
	"GERMAN.ML.1080p.BluRay.x264-{G}",
	"German.DL.1080p.BluRay.x265-{G}",
	"German.AC3D.1080p.BluRay.x264-{G}",
	"German.DTS.DL.2160p.UHD.BluRay.x265-{G}",
	"German.Dubbed.LD.1080p.WEB-DL.x264-{G}",
	"German.MD.720p.BluRay.x264-{G}",
	"German.DL.1080p.WEB-DL.AV1-{G}",
	"German.DL.1080p.BluRay.REMUX.AVC-{G}",
	"GERMAN.DL.1080p.BluRay.x264.Upscaled-{G}",
	"German.1080p.BluRay.x264.Subbed-{G}",
	"Swissgerman.1080p.WEB-DL.H264-{G}",
	"TRUEFRENCH.1080p.BluRay.x264-{G}",
	"MULTi.VFF.1080p.BluRay.x264-{G}",
	"MULTi.VF2.2160p.WEB-DL.DDP5.1.HDR.H.265-{G}",
	"FRENCH.1080p.WEB-DL.DD5.1.H.264-{G}",
	"VOSTFR.1080p.BluRay.x264-{G}",
	"MULTi.TRUEFRENCH.720p.WEB.H264-{G}",
	"VFQ.1080p.WEB-DL.H264-{G}",
	"MULTi.VFi.1080p.BluRay.x265-{G}",
	"Japanese.1080p.BluRay.x264-{G}",
	"JPN.DL.1080p.BluRay.x264-{G}",
	"Dual.Audio.1080p.BluRay.x264-{G}",
	"Spanish.1080p.BluRay.x264-{G}",
	"Italian.1080p.WEB-DL.H264-{G}",
	"Korean.1080p.WEB-DL.H264-{G}",
	"iNTERNAL.1080p.BluRay.x264-{G}",
	"PROPER.1080p.BluRay.x264-{G}",
	"REPACK.1080p.WEB-DL.DD5.1.H.264-{G}",
	"EXTENDED.1080p.BluRay.x264-{G}",
	"IMAX.2160p.WEB-DL.DDP5.1.HDR.H.265-{G}",
	"Directors.Cut.1080p.BluRay.x264-{G}",
	"REMASTERED.1080p.BluRay.DTS-HD.MA.5.1.x264-{G}",
	"1080p.BDRip.x264-{G}",
	"1080p.BluRay.AV1.OPUS-{G}",
	"1080p.AMZN.WEB-DL.DDP5.1.H.264-{G}",
	"1080p.NF.WEB-DL.DDP5.1.Atmos.H.264-{G}",
	"1080p.DSNP.WEB-DL.DDP5.1.H.264-{G}",
	"2160p.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-{G}",
	"2160p.UHD.BluRay.DV.HEVC.TrueHD.7.1-{G}",
	"COMPLETE.BLURAY-{G}",
	"1080p.BluRay.AVC.BR-DISK-{G}",
	"1080p.HDTV.x264-{G}",
	"HDCAM.x264-{G}",
	"TS.x264-{G}",
	"SCR.x264-{G}",
	"3D.HSBS.1080p.BluRay.x264-{G}",
	"1080p.BluRay.x264.Hybrid-{G}",
	"Upscaled.2160p.WEB-DL.H265-{G}",
	"1080p.WEB-DL.DD2.0.H.264-{G}",
	"720p.HDTV.x264-{G}",
	"1080p.DTS-X.BluRay.x265-{G}",
}

var episodeForms = []string{".S01E01.", ".S01E01E02.", ".S01.", ".S02E05.", ".S01E03-E04.", ".S03."}

type golden struct {
	App         string        `json:"app"`
	Version     string        `json:"version"`
	Image       string        `json:"image"`
	ImageDigest string        `json:"imageDigest"`
	TrashCommit string        `json:"trashCommit"`
	Endpoint    string        `json:"endpoint"`
	Titles      []goldenTitle `json:"titles"`
	Cases       []goldenCase  `json:"cases"`
}

type goldenTitle struct {
	Key              string   `json:"key"`
	Name             string   `json:"name"`
	Year             int      `json:"year,omitempty"`
	OriginalLanguage language `json:"originalLanguage"`
}

type language struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type goldenCase struct {
	Title     string          `json:"title"`
	Name      string          `json:"name"`
	Languages []language      `json:"languages"`
	Matched   []string        `json:"matched"` // trash_ids, sorted
	Parsed    json.RawMessage `json:"parsed,omitempty"`
}

type client struct {
	base, key string
	http      *http.Client
}

func (c *client) do(method, path string, body any) ([]byte, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Api-Key", c.key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s %s: %s: %s", method, path, resp.Status, out)
	}
	return out, nil
}

func main() {
	app := flag.String("app", "", "radarr or sonarr")
	base := flag.String("url", "", "base URL")
	key := flag.String("key", "", "API key")
	image := flag.String("image", "", "pinned image reference")
	digest := flag.String("digest", "", "pinned image digest")
	wantVersion := flag.String("version", "", "version the instance must report")
	snapshot := flag.String("snapshot", "internal/scoring/trash", "embedded TRaSH snapshot directory")
	out := flag.String("out", "", "golden file to write")
	rootFolder := flag.String("root", "/media", "root folder inside the container")
	flag.Parse()
	if *app == "" || *base == "" || *key == "" || *image == "" || *digest == "" || *wantVersion == "" || *out == "" {
		fatal(fmt.Errorf("-app, -url, -key, -image, -digest, -version and -out are required"))
	}
	c := &client{base: *base, key: *key, http: &http.Client{Timeout: 90 * time.Second}}

	var status struct {
		Version string `json:"version"`
	}
	c.getJSON("/api/v3/system/status", &status)
	if status.Version != *wantVersion {
		fatal(fmt.Errorf("%s at %s is %s, expected %s", *app, *base, status.Version, *wantVersion))
	}

	commit, _ := os.ReadFile(filepath.Join(*snapshot, "COMMIT"))
	g := golden{
		App: *app, Version: status.Version, Image: *image, ImageDigest: *digest,
		TrashCommit: strings.TrimSpace(string(commit)),
		Endpoint:    "GET /api/v3/parse?title=",
	}

	idToTrash := loadFormats(c, filepath.Join(*snapshot, *app, "cf"))
	groups := releaseGroups(filepath.Join(*snapshot, *app, "cf"))

	var profileID int
	var profiles []struct {
		ID int `json:"id"`
	}
	c.getJSON("/api/v3/qualityprofile", &profiles)
	profileID = profiles[0].ID
	if _, err := c.do("POST", "/api/v3/rootfolder", map[string]any{"path": *rootFolder + "/" + *app}); err != nil {
		fmt.Fprintln(os.Stderr, "root folder:", err) // may exist already
	}

	titles := movies
	if *app == "sonarr" {
		titles = series
	}
	for _, t := range titles {
		gt := addTitle(c, *app, t, profileID, *rootFolder+"/"+*app)
		g.Titles = append(g.Titles, gt)
	}
	// Give Sonarr a moment to refresh the new series.
	time.Sleep(10 * time.Second)

	n := 0
	skipped := 0
	for _, t := range titles {
		for i, tail := range tails {
			for gi := 0; gi < 3; gi++ {
				grp := "GRP"
				if gi > 0 {
					grp = groups[(n*7+gi*13)%len(groups)]
				}
				n++
				name := t.Name + "." + fmt.Sprint(t.Year) + "." + strings.ReplaceAll(tail, "{G}", grp)
				if *app == "sonarr" {
					name = t.Name + episodeForms[(i+gi)%len(episodeForms)] + strings.ReplaceAll(tail, "{G}", grp)
				}
				gc, ok, err := parse(c, *app, name, idToTrash)
				if err != nil {
					fatal(fmt.Errorf("%q: %w", name, err))
				}
				if !ok {
					skipped++
					continue
				}
				gc.Title = t.Key
				g.Cases = append(g.Cases, gc)
			}
		}
	}
	if skipped > 0 {
		fmt.Fprintf(os.Stderr, "%d names were not matched to a library title and were skipped\n", skipped)
	}
	if len(g.Cases) < 300 {
		fatal(fmt.Errorf("only %d cases recorded", len(g.Cases)))
	}

	data, err := json.MarshalIndent(g, "", " ")
	if err != nil {
		fatal(err)
	}
	if err := os.WriteFile(*out, append(data, '\n'), 0o644); err != nil {
		fatal(err)
	}
	fmt.Printf("wrote %d cases to %s\n", len(g.Cases), *out)
}

// loadFormats POSTs every TRaSH Custom Format (stripped of trash_* fields) and
// returns the created id -> trash_id map.
func loadFormats(c *client, dir string) map[string]string {
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		fatal(err)
	}
	sort.Strings(files)
	nameToTrash := map[string]string{}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			fatal(err)
		}
		var cf struct {
			TrashID string `json:"trash_id"`
			Name    string `json:"name"`
			Rename  bool   `json:"includeCustomFormatWhenRenaming"`
			Specs   []struct {
				Name           string         `json:"name"`
				Implementation string         `json:"implementation"`
				Negate         bool           `json:"negate"`
				Required       bool           `json:"required"`
				Fields         map[string]any `json:"fields"`
			} `json:"specifications"`
		}
		if err := json.Unmarshal(raw, &cf); err != nil {
			fatal(fmt.Errorf("%s: %w", f, err))
		}
		var specs []map[string]any
		for _, s := range cf.Specs {
			var fields []map[string]any
			keys := make([]string, 0, len(s.Fields))
			for k := range s.Fields {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				fields = append(fields, map[string]any{"name": k, "value": s.Fields[k]})
			}
			specs = append(specs, map[string]any{
				"name": s.Name, "implementation": s.Implementation,
				"negate": s.Negate, "required": s.Required, "fields": fields,
			})
		}
		body := map[string]any{
			"name": cf.Name, "includeCustomFormatWhenRenaming": cf.Rename, "specifications": specs,
		}
		if _, err := c.do("POST", "/api/v3/customformat", body); err != nil {
			fatal(fmt.Errorf("%s: %w", cf.Name, err))
		}
		nameToTrash[cf.Name] = cf.TrashID
	}
	fmt.Printf("loaded %d Custom Formats\n", len(files))
	return nameToTrash
}

var simpleGroup = regexp.MustCompile(`^\^\(([A-Za-z0-9_.\-]+)\)\$$`)

// releaseGroups collects release group names that tier and unwanted Custom
// Formats match, so the corpus exercises them.
func releaseGroups(dir string) []string {
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	sort.Strings(files)
	seen := map[string]bool{}
	var out []string
	for _, f := range files {
		raw, _ := os.ReadFile(f)
		var cf struct {
			Specs []struct {
				Implementation string `json:"implementation"`
				Fields         struct {
					Value any `json:"value"`
				} `json:"fields"`
			} `json:"specifications"`
		}
		if json.Unmarshal(raw, &cf) != nil {
			continue
		}
		for _, s := range cf.Specs {
			if s.Implementation != "ReleaseGroupSpecification" {
				continue
			}
			v, _ := s.Fields.Value.(string)
			if m := simpleGroup.FindStringSubmatch(v); m != nil && !seen[m[1]] {
				seen[m[1]] = true
				out = append(out, m[1])
			}
		}
	}
	if len(out) < 50 {
		fatal(fmt.Errorf("found only %d release groups in %s", len(out), dir))
	}
	return out
}

func addTitle(c *client, app string, t title, profileID int, root string) goldenTitle {
	var lookup []byte
	var err error
	if app == "radarr" {
		lookup, err = c.do("GET", fmt.Sprintf("/api/v3/movie/lookup/tmdb?tmdbId=%d", t.ID), nil)
	} else {
		lookup, err = c.do("GET", "/api/v3/series/lookup?term="+url.QueryEscape(fmt.Sprintf("tvdb:%d", t.ID)), nil)
		if err == nil {
			var list []json.RawMessage
			if err = json.Unmarshal(lookup, &list); err == nil && len(list) > 0 {
				lookup = list[0]
			} else if err == nil {
				err = fmt.Errorf("no series for tvdb:%d", t.ID)
			}
		}
	}
	if err != nil {
		fatal(fmt.Errorf("lookup %s: %w", t.Key, err))
	}
	var res map[string]any
	if err := json.Unmarshal(lookup, &res); err != nil {
		fatal(err)
	}
	res["qualityProfileId"] = profileID
	res["rootFolderPath"] = root
	res["monitored"] = false
	if app == "radarr" {
		res["addOptions"] = map[string]any{"searchForMovie": false}
	} else {
		res["addOptions"] = map[string]any{"searchForMissingEpisodes": false, "monitor": "none"}
		res["languageProfileId"] = 1
	}
	body, err := c.do("POST", "/api/v3/"+map[string]string{"radarr": "movie", "sonarr": "series"}[app], res)
	if err != nil {
		fatal(fmt.Errorf("add %s: %w", t.Key, err))
	}
	var added struct {
		Title            string   `json:"title"`
		Year             int      `json:"year"`
		OriginalLanguage language `json:"originalLanguage"`
	}
	if err := json.Unmarshal(body, &added); err != nil {
		fatal(err)
	}
	fmt.Printf("added %s (%d), original language %s\n", added.Title, added.Year, added.OriginalLanguage.Name)
	return goldenTitle{Key: t.Key, Name: added.Title, Year: added.Year, OriginalLanguage: added.OriginalLanguage}
}

func parse(c *client, app, name string, nameToTrash map[string]string) (goldenCase, bool, error) {
	body, err := c.do("GET", "/api/v3/parse?title="+url.QueryEscape(name), nil)
	if err != nil {
		return goldenCase{}, false, err
	}
	var resp struct {
		Movie         json.RawMessage `json:"movie"`
		Series        json.RawMessage `json:"series"`
		ParsedEpisode json.RawMessage `json:"parsedEpisodeInfo"`
		Languages     []language      `json:"languages"`
		CustomFormats []struct {
			Name string `json:"name"`
		} `json:"customFormats"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return goldenCase{}, false, err
	}
	if (app == "radarr" && resp.Movie == nil) || (app == "sonarr" && resp.Series == nil) {
		return goldenCase{}, false, nil
	}
	gc := goldenCase{Name: name, Languages: resp.Languages, Matched: []string{}}
	for _, cf := range resp.CustomFormats {
		id, ok := nameToTrash[cf.Name]
		if !ok {
			return goldenCase{}, false, fmt.Errorf("unknown Custom Format %q in the answer", cf.Name)
		}
		gc.Matched = append(gc.Matched, id)
	}
	sort.Strings(gc.Matched)
	if app == "sonarr" {
		// Keep what Custom Formats can see, so the test can build the Series
		// input from Sonarr's own parse.
		var full map[string]json.RawMessage
		if err := json.Unmarshal(resp.ParsedEpisode, &full); err != nil {
			return goldenCase{}, false, err
		}
		keep := map[string]json.RawMessage{}
		for _, k := range []string{"releaseTitle", "quality", "languages", "releaseGroup", "releaseType"} {
			keep[k] = full[k]
		}
		gc.Parsed, err = json.Marshal(keep)
		if err != nil {
			return goldenCase{}, false, err
		}
	}
	return gc, true, nil
}

func (c *client) getJSON(path string, v any) {
	b, err := c.do("GET", path, nil)
	if err != nil {
		fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		fatal(err)
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "cfgolden:", err)
	os.Exit(1)
}
