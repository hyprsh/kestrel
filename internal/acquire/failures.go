package acquire

import (
	"context"

	"github.com/hyprsh/kestrel/internal/acquire/db"
)

// LastFailures maps a Version id to why its latest failed Grab failed
// (download_failed, encrypted, language, ...); Versions that never failed one are left out.
func (s *Service) LastFailures(ctx context.Context) (map[int64]string, error) {
	rows, err := db.New(s.st.Read()).ListLastFailures(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]string, len(rows))
	for _, r := range rows {
		out[r.VersionID.Int64] = r.Failure.String
	}
	return out, nil
}
