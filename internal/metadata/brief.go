package metadata

import (
	"context"
	"net/url"
	"strconv"
	"sync"
	"time"
)

// Brief is what tells two search results apart beyond their title: the network
// (a Series) or the first production company (a Movie), the country it comes
// from, the number of seasons of a Series and a Movie's or typical episode's
// runtime. Fields TMDB does not know are zero.
type Brief struct {
	Network string
	Country string // ISO 3166-1 alpha-2
	Seasons int
	Runtime int // minutes
}

const (
	briefTTL = 24 * time.Hour
	briefCap = 512
)

type briefKey struct {
	kind Kind
	id   int
}

type briefEntry struct {
	brief   Brief
	expires time.Time
}

// briefCache keeps Briefs for a day, so typing a query again, or one letter more, asks TMDB for none of them again.
type briefCache struct {
	mu sync.Mutex
	m  map[briefKey]briefEntry
}

func (b *briefCache) get(k briefKey) (Brief, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	e, ok := b.m[k]
	if !ok || time.Now().After(e.expires) {
		delete(b.m, k)
		return Brief{}, false
	}
	return e.brief, true
}

func (b *briefCache) put(k briefKey, v Brief) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.m == nil {
		b.m = map[briefKey]briefEntry{}
	}
	if len(b.m) >= briefCap {
		now := time.Now()
		for key, e := range b.m {
			if now.After(e.expires) {
				delete(b.m, key)
			}
		}
		if len(b.m) >= briefCap {
			clear(b.m)
		}
	}
	b.m[k] = briefEntry{brief: v, expires: time.Now().Add(briefTTL)}
}

// Brief reads a light details call (no appended records) for one Movie or Series, cached for a day.
func (c *TMDB) Brief(ctx context.Context, kind Kind, id int) (Brief, error) {
	key := briefKey{kind, id}
	if b, ok := c.briefs.get(key); ok {
		return b, nil
	}
	var b Brief
	q := url.Values{"language": {"en-US"}}
	if kind == Series {
		var r struct {
			Networks []struct {
				Name string `json:"name"`
			} `json:"networks"`
			OriginCountry  []string `json:"origin_country"`
			NumberSeasons  int      `json:"number_of_seasons"`
			EpisodeRunTime []int    `json:"episode_run_time"`
		}
		if err := c.get(ctx, "/tv/"+strconv.Itoa(id), q, &r); err != nil {
			return Brief{}, err
		}
		b.Seasons = r.NumberSeasons
		if len(r.Networks) > 0 {
			b.Network = r.Networks[0].Name
		}
		b.Country = first(r.OriginCountry)
		if len(r.EpisodeRunTime) > 0 {
			b.Runtime = r.EpisodeRunTime[0]
		}
	} else {
		var r struct {
			Runtime             int `json:"runtime"`
			ProductionCompanies []struct {
				Name string `json:"name"`
			} `json:"production_companies"`
			ProductionCountries []struct {
				Code string `json:"iso_3166_1"`
			} `json:"production_countries"`
			OriginCountry []string `json:"origin_country"`
		}
		if err := c.get(ctx, "/movie/"+strconv.Itoa(id), q, &r); err != nil {
			return Brief{}, err
		}
		b.Runtime = r.Runtime
		if len(r.ProductionCompanies) > 0 {
			b.Network = r.ProductionCompanies[0].Name
		}
		if b.Country = first(r.OriginCountry); b.Country == "" && len(r.ProductionCountries) > 0 {
			b.Country = r.ProductionCountries[0].Code
		}
	}
	c.briefs.put(key, b)
	return b, nil
}

func first(s []string) string {
	if len(s) == 0 {
		return ""
	}
	return s[0]
}
