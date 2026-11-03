// Package stats computes the Overview's statistics from what Kestrel already keeps: finished Grabs, the
// searches each indexer answered (indexer_searches), when the download client started and finished a
// Grab, files with their parse and size, Requests, and the Root folders' disks. It writes nothing.
package stats

import (
	"context"
	"database/sql"
	"encoding/json"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/stats/db"
	"github.com/hyprsh/kestrel/internal/store"
)

// Range is how far back the Overview looks: the last Days UTC days, today included.
type Range struct {
	Key  string
	Days int
}

// Ranges are the choices of the Overview's range selector.
var Ranges = []Range{{"7d", 7}, {"30d", 30}, {"90d", 90}}

// DefaultRange is the range when none is asked for.
var DefaultRange = Ranges[1]

// ParseRange reads "7d", "30d" or "90d".
func ParseRange(s string) (Range, bool) {
	for _, r := range Ranges {
		if r.Key == s {
			return r, true
		}
	}
	return Range{}, false
}

// SpeedDays is how many days the download client's speed chart covers, whatever the range.
const SpeedDays = 14

// BestMinHitRate is the lowest Hit rate an indexer can have and still be called the best.
const BestMinHitRate = 0.5

// Service computes the statistics.
type Service struct {
	st *store.Store
	// belowCutoff counts the files below their Profile's cutoff; nil counts none.
	belowCutoff func(ctx context.Context) (int, error)
}

// WithBelowCutoff sets where the count of files below their Profile's cutoff comes from. The Profiles own the
// cutoff and the TRaSH ladder it is read against, so the count is theirs; the Overview only shows it.
func (s *Service) WithBelowCutoff(f func(ctx context.Context) (int, error)) *Service {
	s.belowCutoff = f
	return s
}

// New returns a Service over the store.
func New(st *store.Store) *Service { return &Service{st: st} }

// Disk is one Root folder's disk.
type Disk struct {
	Path        string
	Free, Total int64
}

// Window is the range's days as instants: [From, To) is the UTC midnight of the first day up to the
// midnight after today, and Previous is the span of the same length before it.
type Window struct {
	From, To         time.Time
	PrevFrom, PrevTo time.Time
}

// WindowOf is the window of a range at now.
func WindowOf(now time.Time, r Range) Window {
	today := dayOf(now)
	to := today.AddDate(0, 0, 1)
	from := to.AddDate(0, 0, -r.Days)
	return Window{From: from, To: to, PrevFrom: from.AddDate(0, 0, -r.Days), PrevTo: from}
}

// PeriodDays is how many days a chart column covers in the range: one for 7 days, a week for 30 and 90.
func (r Range) PeriodDays() int {
	if r.Days <= 7 {
		return 1
	}
	return 7
}

// Period is a run of whole UTC days: From is its first day, To its last (both inclusive).
type Period struct{ From, To time.Time }

// Periods cut the window into the chart columns of its range, oldest first. They are aligned to the end of the
// range, so every period but the oldest is a full one and the oldest is the part of a period the range starts in.
// Grabs per day and the download client's speed share them, so both charts have the same columns.
func (w Window) Periods(r Range) []Period {
	n := r.PeriodDays()
	var out []Period
	for end := w.To; end.After(w.From); end = end.AddDate(0, 0, -n) {
		start := end.AddDate(0, 0, -n)
		if start.Before(w.From) {
			start = w.From
		}
		out = append(out, Period{From: start, To: end.AddDate(0, 0, -1)})
	}
	slices.Reverse(out)
	return out
}

func dayOf(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func ts(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func nullTS(t time.Time) sql.NullString { return sql.NullString{String: ts(t), Valid: true} }

func parse(s string) time.Time {
	t, _ := time.Parse(time.RFC3339, s)
	return t
}

// Day is one UTC day of finished Grabs.
type Day struct {
	Day              time.Time
	Imported, Failed int
}

// Column is one chart column of finished Grabs: a Period of the range's days added up.
type Column struct {
	Period
	Imported, Failed int
}

// Indexer is how one indexer did in the range.
type Indexer struct {
	ID       int64
	Name     string
	Imported int
	Failed   int
	Searches int
	// Hits are the answered searches that returned a Release fitting a Slot; HitRate is Hits over Answered, nil with no answered search.
	Hits    int
	HitRate *float64
	// MedianAnswer is nil when no search of the indexer was answered in the range.
	MedianAnswer *time.Duration
}

// Library is the Library's size.
type Library struct {
	Titles, Movies, Series int
	Bytes                  int64
}

// Client is what the download client did.
type Client struct {
	Completed, Failed int
	// AvgBytesPerSecond is the bytes of the finished downloads over the time they took; nil with none.
	AvgBytesPerSecond *float64
	MedianDownload    *time.Duration
	// SpeedPerDay is the average speed of each of the last SpeedDays days, oldest first; nil for a day with no download.
	SpeedPerDay []SpeedDay
}

// SpeedDay is one day of the speed chart.
type SpeedDay struct {
	Day            time.Time
	BytesPerSecond *float64
}

// Quality is a Slot's files by the class of their source.
type Quality struct {
	Slot                          string
	Files                         int
	RemuxBluray, WebDL, WebRipLow int
}

// Group is a release group and the files it brought.
type Group struct {
	Name  string
	Files int
}

// Requester is who asked for how much.
type Requester struct {
	Name, Source   string
	Requests, Done int
}

// Requests is the Requests created in the range.
type Requests struct {
	Total, Searching int
	MedianFulfil     *time.Duration
	Requesters       []Requester
}

// Storage is the Root folders' disks and how fast the Library grows.
type Storage struct {
	Disks []Disk
	// Free and Total add the disks up, counting a disk shared by several Root folders once (see DistinctDisks).
	Free, Total int64
	// GrowthBytesPerWeek is the size of the files that Grabs brought in the range, per week; nil when none came.
	GrowthBytesPerWeek *int64
	// SeriesShare is the part of all file bytes that Series take, 0 to 1; nil with no files.
	SeriesShare *float64
	// MonthsUntilFull is free space over the growth, nil unless the growth is measurable.
	MonthsUntilFull *float64
}

// Result is everything the database can say.
type Result struct {
	Range   Range
	Window  Window
	Library Library
	// Days are the range's UTC days; Columns are the same Grabs grouped by the range's Periods.
	Days     []Day
	Columns  []Column
	Imported int
	Failed   int
	Indexers []Indexer
	// Best is the index in Indexers of the best indexer, -1 for none.
	Best    int
	Client  Client
	Quality []Quality
	// BelowCutoff is how many files fit their Version but are below their Profile's cutoff: Upgrades are wanted.
	BelowCutoff int
	Groups      []Group
	Requests    Requests
	Storage     Storage
}

// Compute reads the statistics for a range at now. disks are the Root folders' disks as the caller read them.
func (s *Service) Compute(ctx context.Context, now time.Time, r Range, disks []Disk) (Result, error) {
	q := db.New(s.st.Read())
	w := WindowOf(now, r)
	res := Result{Range: r, Window: w, Best: -1}
	from, to := ts(w.From), ts(w.To)

	// Grabs per day, zero for the days without one.
	perDay, err := q.GrabsPerDay(ctx, db.GrabsPerDayParams{FromAt: from, ToAt: to})
	if err != nil {
		return res, err
	}
	byDay := map[string]db.GrabsPerDayRow{}
	for _, d := range perDay {
		byDay[d.Day] = d
	}
	for i := 0; i < r.Days; i++ {
		day := w.From.AddDate(0, 0, i)
		d := byDay[day.Format("2006-01-02")]
		res.Days = append(res.Days, Day{Day: day, Imported: int(d.Imported), Failed: int(d.Failed)})
		res.Imported += int(d.Imported)
		res.Failed += int(d.Failed)
	}

	for _, p := range w.Periods(r) {
		c := Column{Period: p}
		for _, d := range res.Days {
			if !d.Day.Before(p.From) && !d.Day.After(p.To) {
				c.Imported += d.Imported
				c.Failed += d.Failed
			}
		}
		res.Columns = append(res.Columns, c)
	}

	if res.Indexers, err = s.indexers(ctx, q, from, to); err != nil {
		return res, err
	}
	res.Best = BestIndexer(res.Indexers)

	totals, err := q.LibraryTotals(ctx)
	if err != nil {
		return res, err
	}
	res.Library = Library{Titles: int(totals.Titles), Movies: int(totals.Movies), Series: int(totals.Series)}
	kinds, err := q.FileBytesByKind(ctx)
	if err != nil {
		return res, err
	}
	var seriesBytes int64
	for _, k := range kinds {
		res.Library.Bytes += k.Bytes
		if k.Kind == "series" {
			seriesBytes = k.Bytes
		}
	}

	if res.Client, err = s.client(ctx, q, now, from, to); err != nil {
		return res, err
	}
	if res.Quality, err = s.quality(ctx, q); err != nil {
		return res, err
	}
	if s.belowCutoff != nil {
		if res.BelowCutoff, err = s.belowCutoff(ctx); err != nil {
			return res, err
		}
	}
	grabbed, err := q.GrabbedFiles(ctx, db.GrabbedFilesParams{FromAt: from, ToAt: to})
	if err != nil {
		return res, err
	}
	var grabbedBytes int64
	groups := map[string]int{}
	for _, f := range grabbed {
		grabbedBytes += f.Size
		if g := parsedOf(f.ParsedRelease).ReleaseGroup; g != "" {
			groups[g]++
		}
	}
	res.Groups = TopGroups(groups, 5)
	if res.Requests, err = s.requests(ctx, q, from, to); err != nil {
		return res, err
	}

	res.Storage = StorageOf(disks, grabbedBytes, r.Days, res.Library.Bytes, seriesBytes)
	return res, nil
}

func (s *Service) indexers(ctx context.Context, q *db.Queries, from, to string) ([]Indexer, error) {
	grabs, err := q.IndexerGrabs(ctx, db.IndexerGrabsParams{FromAt: from, ToAt: to})
	if err != nil {
		return nil, err
	}
	searches, err := q.IndexerSearchCounts(ctx, db.IndexerSearchCountsParams{FromAt: from, ToAt: to})
	if err != nil {
		return nil, err
	}
	times, err := q.IndexerAnswerTimes(ctx, db.IndexerAnswerTimesParams{FromAt: from, ToAt: to})
	if err != nil {
		return nil, err
	}
	byID := map[int64]*Indexer{}
	get := func(id int64, name string) *Indexer {
		if ix, ok := byID[id]; ok {
			return ix
		}
		ix := &Indexer{ID: id, Name: name}
		byID[id] = ix
		return ix
	}
	for _, g := range grabs {
		ix := get(g.IndexerID, g.Name)
		ix.Imported, ix.Failed = int(g.Imported), int(g.Failed)
	}
	for _, c := range searches {
		ix := get(c.IndexerID, c.Name)
		ix.Name = c.Name
		ix.Searches, ix.Hits = int(c.Searches), int(c.Hits)
		if c.Answered > 0 {
			rate := float64(c.Hits) / float64(c.Answered)
			ix.HitRate = &rate
		}
	}
	answers := map[int64][]time.Duration{}
	for _, t := range times {
		answers[t.IndexerID] = append(answers[t.IndexerID], time.Duration(t.DurationMs)*time.Millisecond)
	}
	for id, ds := range answers {
		m := MedianDuration(ds)
		byID[id].MedianAnswer = m
	}
	out := make([]Indexer, 0, len(byID))
	for _, ix := range byID {
		out = append(out, *ix)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Imported != out[j].Imported {
			return out[i].Imported > out[j].Imported
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// BestIndexer is the index of the best indexer, -1 for none: the one with the most imported Grabs among
// those whose Hit rate is at least BestMinHitRate (ties go to the higher Hit rate, then fewer failed Grabs,
// then the name). An indexer without a Hit rate, or without an imported Grab, is never the best.
func BestIndexer(ixs []Indexer) int {
	best := -1
	for i, ix := range ixs {
		if ix.Imported == 0 || ix.HitRate == nil || *ix.HitRate < BestMinHitRate {
			continue
		}
		if best < 0 || betterIndexer(ix, ixs[best]) {
			best = i
		}
	}
	return best
}

func betterIndexer(a, b Indexer) bool {
	switch {
	case a.Imported != b.Imported:
		return a.Imported > b.Imported
	case *a.HitRate != *b.HitRate:
		return *a.HitRate > *b.HitRate
	case a.Failed != b.Failed:
		return a.Failed < b.Failed
	}
	return a.Name < b.Name
}

func (s *Service) client(ctx context.Context, q *db.Queries, now time.Time, from, to string) (Client, error) {
	var c Client
	rows, err := q.Downloads(ctx, db.DownloadsParams{FromAt: sql.NullString{String: from, Valid: true}, ToAt: sql.NullString{String: to, Valid: true}})
	if err != nil {
		return c, err
	}
	c.Completed = len(rows)
	var bytes int64
	var secs float64
	var took []time.Duration
	for _, r := range rows {
		d := parse(r.DownloadDoneAt.String).Sub(parse(r.DownloadStartedAt.String))
		if d <= 0 {
			continue
		}
		bytes += r.Size
		secs += d.Seconds()
		took = append(took, d)
	}
	if secs > 0 {
		v := float64(bytes) / secs
		c.AvgBytesPerSecond = &v
	}
	c.MedianDownload = MedianDuration(took)
	failed, err := q.ClientFailures(ctx, db.ClientFailuresParams{FromAt: from, ToAt: to})
	if err != nil {
		return c, err
	}
	c.Failed = int(failed)

	end := dayOf(now).AddDate(0, 0, 1)
	start := end.AddDate(0, 0, -SpeedDays)
	recent, err := q.Downloads(ctx, db.DownloadsParams{FromAt: nullTS(start), ToAt: nullTS(end)})
	if err != nil {
		return c, err
	}
	type acc struct {
		bytes int64
		secs  float64
	}
	days := map[string]*acc{}
	for _, r := range recent {
		done := parse(r.DownloadDoneAt.String)
		d := done.Sub(parse(r.DownloadStartedAt.String))
		if d <= 0 {
			continue
		}
		k := done.Format("2006-01-02")
		if days[k] == nil {
			days[k] = &acc{}
		}
		days[k].bytes += r.Size
		days[k].secs += d.Seconds()
	}
	for i := 0; i < SpeedDays; i++ {
		day := start.AddDate(0, 0, i)
		sd := SpeedDay{Day: day}
		if a := days[day.Format("2006-01-02")]; a != nil && a.secs > 0 {
			v := float64(a.bytes) / a.secs
			sd.BytesPerSecond = &v
		}
		c.SpeedPerDay = append(c.SpeedPerDay, sd)
	}
	return c, nil
}

// parsed is the part of a file's stored parse the statistics read.
type parsed struct {
	ReleaseGroup string `json:"releaseGroup"`
	Quality      struct {
		Quality struct {
			Source   string `json:"source"`
			Modifier string `json:"modifier"`
		} `json:"quality"`
	} `json:"quality"`
}

func parsedOf(raw sql.NullString) parsed {
	var p parsed
	if raw.Valid {
		_ = json.Unmarshal([]byte(raw.String), &p)
	}
	return p
}

// QualityClass puts a file's source into one of the three classes of the quality bar.
type QualityClass int

const (
	ClassRemuxBluray QualityClass = iota
	ClassWebDL
	ClassWebRipLow
)

// ClassOf is the class of a parsed source and modifier: Blu-ray and Remux, WEB-DL, or anything lower (WEBRip, TV, DVD, ...).
func ClassOf(source, modifier string) QualityClass {
	switch {
	case modifier == "remux" || source == "bluray" || source == "blurayraw":
		return ClassRemuxBluray
	case source == "webdl":
		return ClassWebDL
	}
	return ClassWebRipLow
}

func (s *Service) quality(ctx context.Context, q *db.Queries) ([]Quality, error) {
	rows, err := q.FileQualities(ctx)
	if err != nil {
		return nil, err
	}
	bySlot := map[string]*Quality{}
	for _, r := range rows {
		ql := bySlot[r.Slot]
		if ql == nil {
			ql = &Quality{Slot: r.Slot}
			bySlot[r.Slot] = ql
		}
		n := int(r.Files)
		ql.Files += n
		switch ClassOf(r.Source, r.Modifier) {
		case ClassRemuxBluray:
			ql.RemuxBluray += n
		case ClassWebDL:
			ql.WebDL += n
		default:
			ql.WebRipLow += n
		}
	}
	var out []Quality
	for _, slot := range []string{"standard", "4k"} {
		if ql := bySlot[slot]; ql != nil {
			out = append(out, *ql)
		}
	}
	return out, nil
}

// TopGroups are the n release groups with the most files, most first, ties by name.
func TopGroups(counts map[string]int, n int) []Group {
	out := make([]Group, 0, len(counts))
	for name, c := range counts {
		out = append(out, Group{Name: name, Files: c})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Files != out[j].Files {
			return out[i].Files > out[j].Files
		}
		return out[i].Name < out[j].Name
	})
	if len(out) > n {
		out = out[:n]
	}
	return out
}

func (s *Service) requests(ctx context.Context, q *db.Queries, from, to string) (Requests, error) {
	var out Requests
	rows, err := q.RequestsInWindow(ctx, db.RequestsInWindowParams{FromAt: from, ToAt: to})
	if err != nil {
		return out, err
	}
	by := map[string]*Requester{}
	var order []string
	var took []time.Duration
	for _, r := range rows {
		out.Total++
		key := r.Source + "\x00" + r.RequesterID
		rq := by[key]
		if rq == nil {
			rq = &Requester{Name: r.RequesterName, Source: r.Source}
			by[key] = rq
			order = append(order, key)
		}
		rq.Name = r.RequesterName
		rq.Requests++
		if r.Slots > 0 && r.Filled == r.Slots {
			rq.Done++
			if d := parse(r.FilledAt).Sub(parse(r.CreatedAt)); d >= 0 {
				took = append(took, d)
			}
		} else {
			out.Searching++
		}
	}
	out.MedianFulfil = MedianDuration(took)
	for _, k := range order {
		out.Requesters = append(out.Requesters, *by[k])
	}
	sort.SliceStable(out.Requesters, func(i, j int) bool { return out.Requesters[i].Requests > out.Requesters[j].Requests })
	return out, nil
}

// StorageOf joins the disks with the growth. grabbedBytes are the bytes the files that Grabs brought in `days` days
// come to; libraryBytes and seriesBytes the bytes of all files and of Series files.
func StorageOf(disks []Disk, grabbedBytes int64, days int, libraryBytes, seriesBytes int64) Storage {
	st := Storage{Disks: disks}
	for _, d := range DistinctDisks(disks) {
		st.Free += d.Free
		st.Total += d.Total
	}
	if libraryBytes > 0 {
		share := float64(seriesBytes) / float64(libraryBytes)
		st.SeriesShare = &share
	}
	if grabbedBytes > 0 && days > 0 {
		weekly := int64(float64(grabbedBytes) / (float64(days) / 7))
		st.GrowthBytesPerWeek = &weekly
		if weekly > 0 && st.Free > 0 {
			months := float64(st.Free) / (float64(weekly) * 52 / 12)
			st.MonthsUntilFull = &months
		}
	}
	return st
}

// DistinctDisks drops a Root folder whose free and total bytes equal an earlier one's: two folders on one
// disk would count it twice.
func DistinctDisks(disks []Disk) []Disk {
	var out []Disk
	for _, d := range disks {
		if !slices.ContainsFunc(out, func(o Disk) bool { return o.Free == d.Free && o.Total == d.Total }) {
			out = append(out, d)
		}
	}
	return out
}

// MedianDuration is the median of ds (the mean of the middle two for an even count); nil for none.
func MedianDuration(ds []time.Duration) *time.Duration {
	if len(ds) == 0 {
		return nil
	}
	s := slices.Clone(ds)
	slices.Sort(s)
	m := s[len(s)/2]
	if len(s)%2 == 0 {
		m = (s[len(s)/2-1] + s[len(s)/2]) / 2
	}
	return &m
}

// TitleCase is a source name for people: "plex" becomes "Plex".
func TitleCase(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
