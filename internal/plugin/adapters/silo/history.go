package silo

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/mediahttp"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
)

var _ mediaserver.PlayHistory = (*Client)(nil)

// historyPage is how many entries one call asks for: Silo's largest page.
const historyPage = 200

type historyEntry struct {
	MediaItemID   string `json:"media_item_id"`
	MediaType     string `json:"media_type"`
	EndedAt       string `json:"ended_at"`
	SeasonNumber  *int   `json:"season_number"`
	EpisodeNumber *int   `json:"episode_number"`
}

// get reads one Silo path with the admin key, acting as profile when it is set;
// a 404 comes back as found=false.
func (c *Client) get(ctx context.Context, conn plugin.Connection, path string, q url.Values, profile string) (raw []byte, found bool, err error) {
	base, err := mediahttp.BaseURL(conn)
	if err != nil {
		return nil, false, err
	}
	key := conn.String("api_key")
	u := base + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	header := map[string]string{"Authorization": "Bearer " + key, "Accept": "application/json"}
	if profile != "" {
		header["X-Profile-Id"] = profile
	}
	status, raw, err := mediahttp.Do(ctx, c.http, mediahttp.Request{
		Method: http.MethodGet, URL: u, Name: "Silo", Secret: key, OKCodes: []int{http.StatusNotFound}, Header: header,
	})
	if err != nil {
		return nil, false, err
	}
	return raw, status != http.StatusNotFound, nil
}

// Plays reads /api/v2/admin/playback-history, which lists the finished plays of
// every account and profile, newest first.
//
// Unlike Plex, Silo cannot sort oldest first, so a read that stopped short
// would lose the older plays rather than the newer ones. It therefore reads
// every page from since on; the caller bounds since to its oldest Watch-ahead
// Request, which keeps that short.
func (c *Client) Plays(ctx context.Context, conn plugin.Connection, since time.Time) (mediaserver.Plays, error) {
	var out mediaserver.Plays
	profile := ""                 // read at the first catalog lookup
	series := map[string]string{} // episode item id -> its show's id, "" when unknown
	var newestFirst []mediaserver.Play
	cursor := ""
	for {
		q := url.Values{"limit": {strconv.Itoa(historyPage)}, "completed": {"true"}}
		if !since.IsZero() {
			q.Set("ended_after", since.UTC().Format(time.RFC3339))
		}
		if cursor != "" {
			q.Set("cursor", cursor)
		}
		raw, _, err := c.get(ctx, conn, "/api/v2/admin/playback-history", q, "")
		if err != nil {
			return mediaserver.Plays{}, err
		}
		var body struct {
			Items []historyEntry `json:"items"`
			Page  struct {
				HasMore    bool   `json:"has_more"`
				NextCursor string `json:"next_cursor"`
			} `json:"page"`
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			return mediaserver.Plays{}, plugin.Errorf(plugin.CodeUnavailable, "that is not a Silo server (is the URL right?)")
		}
		for _, e := range body.Items {
			at, err := time.Parse(time.RFC3339, e.EndedAt)
			if err != nil {
				continue
			}
			at = at.UTC()
			if at.After(out.Through) {
				out.Through = at
			}
			if e.MediaType != "episode" || e.SeasonNumber == nil || e.EpisodeNumber == nil || e.MediaItemID == "" {
				continue
			}
			show, ok := series[e.MediaItemID]
			if !ok {
				if profile == "" {
					if profile, err = c.profile(ctx, conn); err != nil {
						return mediaserver.Plays{}, err
					}
				}
				if show, err = c.seriesOf(ctx, conn, profile, e.MediaItemID); err != nil {
					return mediaserver.Plays{}, err
				}
				series[e.MediaItemID] = show
			}
			if show == "" {
				continue
			}
			newestFirst = append(newestFirst, mediaserver.Play{ViewedAt: at, ShowKey: show, Season: *e.SeasonNumber, Episode: *e.EpisodeNumber})
		}
		if !body.Page.HasMore || body.Page.NextCursor == "" {
			break
		}
		cursor = body.Page.NextCursor
	}
	for i := len(newestFirst) - 1; i >= 0; i-- {
		out.Items = append(out.Items, newestFirst[i])
	}
	return out, nil
}

// catalogItem is the part of a catalog item Kestrel reads.
type catalogItem struct {
	SeriesID string `json:"series_id"`
	TvdbID   string `json:"tvdb_id"`
	TmdbID   string `json:"tmdb_id"`
	ImdbID   string `json:"imdb_id"`
}

// profile is the id of the profile catalog lookups act as. Silo's catalog
// answers only for a profile of the key's account: its primary profile, or
// else one that sees every library, so no parental limit hides an item.
func (c *Client) profile(ctx context.Context, conn plugin.Connection) (string, error) {
	raw, _, err := c.get(ctx, conn, "/api/v2/profiles", nil, "")
	if err != nil {
		return "", err
	}
	var body struct {
		Items []struct {
			ID                string `json:"id"`
			IsPrimary         bool   `json:"is_primary"`
			IsChild           bool   `json:"is_child"`
			HasPin            bool   `json:"has_pin"`
			LibraryRestricted bool   `json:"library_restrictions_enabled"`
			MaxContentRating  string `json:"max_content_rating"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return "", plugin.Errorf(plugin.CodeUnavailable, "that is not a Silo server (is the URL right?)")
	}
	for _, p := range body.Items {
		if p.IsPrimary && p.ID != "" {
			return p.ID, nil
		}
	}
	for _, p := range body.Items {
		if p.ID != "" && !p.IsChild && !p.HasPin && !p.LibraryRestricted && p.MaxContentRating == "" {
			return p.ID, nil
		}
	}
	return "", plugin.Errorf(plugin.CodeUnavailable, "the Silo API key's account has no profile that sees every library")
}

func (c *Client) item(ctx context.Context, conn plugin.Connection, profile, id string) (catalogItem, bool, error) {
	raw, found, err := c.get(ctx, conn, "/api/v2/catalog/items/"+url.PathEscape(id), nil, profile)
	if err != nil || !found {
		return catalogItem{}, false, err
	}
	var it catalogItem
	if err := json.Unmarshal(raw, &it); err != nil {
		return catalogItem{}, false, plugin.Errorf(plugin.CodeUnavailable, "Silo's answer for item %s was not what an item looks like", id)
	}
	return it, true, nil
}

// seriesOf is the id of the show an episode belongs to; "" when Silo no longer
// has the episode or it has no show.
func (c *Client) seriesOf(ctx context.Context, conn plugin.Connection, profile, episodeID string) (string, error) {
	it, _, err := c.item(ctx, conn, profile, episodeID)
	return it.SeriesID, err
}

// ShowGuids reads a show's catalog item for its external ids, written the way
// Plex writes them.
func (c *Client) ShowGuids(ctx context.Context, conn plugin.Connection, showKey string) ([]string, error) {
	profile, err := c.profile(ctx, conn)
	if err != nil {
		return nil, err
	}
	it, found, err := c.item(ctx, conn, profile, showKey)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, plugin.Errorf(plugin.CodeNotFound, "Silo has no item %s", showKey)
	}
	var out []string
	for _, g := range []struct{ scheme, id string }{{"tvdb", it.TvdbID}, {"tmdb", it.TmdbID}, {"imdb", it.ImdbID}} {
		if g.id != "" {
			out = append(out, g.scheme+"://"+g.id)
		}
	}
	return out, nil
}
