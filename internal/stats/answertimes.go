package stats

import (
	"context"
	"time"

	"github.com/hyprsh/kestrel/internal/stats/db"
)

// ResponseWindow is how far back an indexer's response time looks: the last day of real searches.
const ResponseWindow = 24 * time.Hour

// ResponseTimes is each indexer's median response time over the last ResponseWindow, from the searches it
// answered (indexer_searches), keyed by the indexer's plugin instance id. An indexer that answered nothing in
// the window has no entry. The Overview's median_answer_ms is the same figure over its own range.
func (s *Service) ResponseTimes(ctx context.Context, now time.Time) (map[int64]time.Duration, error) {
	rows, err := db.New(s.st.Read()).IndexerAnswerTimes(ctx, db.IndexerAnswerTimesParams{FromAt: ts(now.Add(-ResponseWindow)), ToAt: ts(now.Add(time.Second))})
	if err != nil {
		return nil, err
	}
	by := map[int64][]time.Duration{}
	for _, r := range rows {
		by[r.IndexerID] = append(by[r.IndexerID], time.Duration(r.DurationMs)*time.Millisecond)
	}
	out := make(map[int64]time.Duration, len(by))
	for id, ds := range by {
		out[id] = *MedianDuration(ds)
	}
	return out, nil
}
