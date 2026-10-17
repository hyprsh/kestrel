package library

import (
	"context"

	"github.com/hyprsh/kestrel/internal/library/db"
)

// Named is a Title with every name a release may call it by, for matching
// the releases of an RSS feed to the Library.
type Named struct {
	ID        int64
	Kind      Kind
	Monitored bool
	Year      int // 0 when unknown
	TMDBID    int
	TVDBID    int
	IMDbID    string
	// Names are the English, original and Primary-Language titles and every
	// alias, without repeats.
	Names []string
}

// Names lists every Title with its names.
func (s *Service) Names(ctx context.Context) ([]Named, error) {
	q := db.New(s.st.Read())
	titles, err := q.ListTitles(ctx)
	if err != nil {
		return nil, err
	}
	aliases, err := q.ListAliasesForSearch(ctx)
	if err != nil {
		return nil, err
	}
	byTitle := map[int64][]string{}
	for _, a := range aliases {
		byTitle[a.TitleID] = append(byTitle[a.TitleID], a.Alias)
	}
	out := make([]Named, 0, len(titles))
	for _, t := range titles {
		n := Named{
			ID: t.ID, Kind: Kind(t.Kind), Monitored: t.Monitored == 1, Year: int(t.Year.Int64),
			TMDBID: int(t.TmdbID.Int64), TVDBID: int(t.TvdbID.Int64), IMDbID: t.ImdbID.String,
		}
		seen := map[string]bool{}
		for _, name := range append([]string{t.Title, t.OriginalTitle, t.PrimaryTitle}, byTitle[t.ID]...) {
			if name != "" && !seen[name] {
				seen[name] = true
				n.Names = append(n.Names, name)
			}
		}
		out = append(out, n)
	}
	return out, nil
}
