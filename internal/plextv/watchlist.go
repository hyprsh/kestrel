package plextv

// Reading Watchlists (ADR 0019). None of these calls is documented by Plex, so
// each is kept to one function here and any answer that is not the shape
// below is ErrUnavailable, never an empty Watchlist.
//
// Sources, read on 2026-10-27:
//   - The owner's Watchlist: python-plexapi, plexapi/myplex.py, MyPlexAccount.watchlist
//     (GET {DISCOVER}/library/sections/watchlist/all, DISCOVER = https://discover.provider.plex.tv),
//     and Pulsarr, src/services/plex-watchlist/api/graphql.ts getWatchlist, which pages it with
//     X-Plex-Container-Start / X-Plex-Container-Size (100) and sends Accept: application/json and X-Plex-Token.
//   - Friends: Pulsarr, src/services/plex-watchlist/fetching/friends-api.ts getFriends: POST
//     https://community.plex.tv/api with the GraphQL query `allFriendsV2 { user { id username avatar displayName } createdAt }`.
//   - A friend's Watchlist: Pulsarr graphql.ts getWatchlistForUser: the same endpoint with
//     `userV2(user: $user) { ... on User { watchlist(first, after) { nodes { id title type } pageInfo { hasNextPage endCursor } } } }`,
//     variables {user: {id: <friend uuid>}, first: 100, after: <cursor>}. Pulsarr pauses 5 to 15 s between pages
//     "per Plex developer request"; Options.PageDelay is that pause.
//   - Ids: Pulsarr src/services/plex-watchlist/enrichment/single-item.ts toItemsSingle:
//     GET https://discover.provider.plex.tv/library/metadata/{id}, whose Metadata[0].Guid is a list of
//     {"id": "tmdb://603"}, "tvdb://..." and "imdb://tt...". A friend's node id is the same rating key an owner's
//     entry carries as ratingKey, so one lookup serves both.
//
// A token is only ever sent as the X-Plex-Token header; no error or log line holds one.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	watchlistPageSize = 100
	// maxPages stops a paging loop that never ends.
	maxPages = 500
)

// EntryKind is what a Watchlist entry is.
type EntryKind string

const (
	// Movie is a movie.
	Movie EntryKind = "movie"
	// Series is a show.
	Series EntryKind = "series"
	// Other is anything else Plex lists, which Kestrel does not request.
	Other EntryKind = "other"
)

// WatchlistEntry is a title on a Watchlist.
type WatchlistEntry struct {
	// Key is the Plex rating key, which names the title at plex.tv.
	Key string
	// Guid is the Plex guid, "plex://movie/<key>", the same for every account that lists the title.
	Guid  string
	Kind  EntryKind
	Title string
}

// Ids are the ids Plex's metadata lists for a title; zero or empty means none.
type Ids struct {
	TMDB, TVDB int
	IMDb       string
}

// Friend is a friend of the owner as plex.tv's community API lists them.
type Friend struct {
	// UUID names the friend's Watchlist.
	UUID        string
	Username    string
	DisplayName string
}

func entryOf(key, typ, title string) (WatchlistEntry, error) {
	typ = strings.ToLower(typ)
	if key == "" || typ == "" {
		return WatchlistEntry{}, fmt.Errorf("%w: a Watchlist entry has no key or type", ErrUnavailable)
	}
	kind := Other
	switch typ {
	case "movie":
		kind = Movie
	case "show":
		kind = Series
	}
	return WatchlistEntry{Key: key, Guid: "plex://" + typ + "/" + key, Kind: kind, Title: title}, nil
}

// wrap words a rejected owner token as unavailable, like HasAccess does.
func wrap(err error) error { return ownerError(err) }

// OwnerWatchlist reads the Watchlist of the account behind ownerToken.
func (c *Client) OwnerWatchlist(ctx context.Context, clientID, ownerToken string) ([]WatchlistEntry, error) {
	var out []WatchlistEntry
	for page, start := 0, 0; ; page++ {
		if page >= maxPages {
			return nil, fmt.Errorf("%w: the Watchlist does not end", ErrUnavailable)
		}
		u := c.discover + "/library/sections/watchlist/all?X-Plex-Container-Start=" + strconv.Itoa(start) +
			"&X-Plex-Container-Size=" + strconv.Itoa(watchlistPageSize)
		status, raw, err := c.request(ctx, http.MethodGet, u, clientID, ownerToken, "application/json")
		if err != nil {
			return nil, wrap(err)
		}
		var doc struct {
			MediaContainer *struct {
				TotalSize *int `json:"totalSize"`
				Metadata  []struct {
					RatingKey string `json:"ratingKey"`
					Type      string `json:"type"`
					Title     string `json:"title"`
				} `json:"Metadata"`
			} `json:"MediaContainer"`
		}
		if status == http.StatusNotFound || json.Unmarshal(raw, &doc) != nil || doc.MediaContainer == nil {
			return nil, fmt.Errorf("%w: plex.tv sent no Watchlist", ErrUnavailable)
		}
		mc := doc.MediaContainer
		for _, m := range mc.Metadata {
			e, err := entryOf(m.RatingKey, m.Type, m.Title)
			if err != nil {
				return nil, err
			}
			out = append(out, e)
		}
		start += len(mc.Metadata)
		if len(mc.Metadata) == 0 || (mc.TotalSize != nil && start >= *mc.TotalSize) || (mc.TotalSize == nil && len(mc.Metadata) < watchlistPageSize) {
			return out, nil
		}
	}
}

type graphqlReply struct {
	Errors []json.RawMessage `json:"errors"`
	Data   json.RawMessage   `json:"data"`
}

// graphql sends one query to the community API and returns its data. Errors in the
// answer are unavailable; they are not echoed, since they might quote the query.
func (c *Client) graphql(ctx context.Context, clientID, ownerToken, query string, vars map[string]any) (json.RawMessage, error) {
	body, _ := json.Marshal(map[string]any{"query": query, "variables": vars})
	status, raw, err := c.requestBody(ctx, http.MethodPost, c.community, clientID, ownerToken, "application/json", body)
	if err != nil {
		return nil, wrap(err)
	}
	var r graphqlReply
	if status == http.StatusNotFound || json.Unmarshal(raw, &r) != nil || len(r.Errors) > 0 || len(r.Data) == 0 || string(r.Data) == "null" {
		return nil, fmt.Errorf("%w: plex.tv sent no answer to the query", ErrUnavailable)
	}
	return r.Data, nil
}

// Friends lists the owner's friends.
func (c *Client) Friends(ctx context.Context, clientID, ownerToken string) ([]Friend, error) {
	data, err := c.graphql(ctx, clientID, ownerToken,
		`query GetAllFriends { allFriendsV2 { user { id username avatar displayName } createdAt } }`, nil)
	if err != nil {
		return nil, err
	}
	var d struct {
		All []struct {
			User struct {
				ID          string `json:"id"`
				Username    string `json:"username"`
				DisplayName string `json:"displayName"`
			} `json:"user"`
		} `json:"allFriendsV2"`
	}
	if json.Unmarshal(data, &d) != nil || d.All == nil {
		return nil, fmt.Errorf("%w: plex.tv sent no friends", ErrUnavailable)
	}
	out := make([]Friend, 0, len(d.All))
	for _, f := range d.All {
		if f.User.ID == "" {
			return nil, fmt.Errorf("%w: a friend has no id", ErrUnavailable)
		}
		out = append(out, Friend{UUID: f.User.ID, Username: f.User.Username, DisplayName: f.User.DisplayName})
	}
	return out, nil
}

// FriendWatchlist reads the Watchlist of the friend with the plex.tv uuid. When
// the answer has userV2 but a null watchlist, the friend keeps their Watchlist
// from the owner: that is ErrWatchlistHidden, unwrapped. Any other answer that
// is not the shape below, a missing userV2 included, is ErrUnavailable. An empty
// Watchlist is an empty list.
func (c *Client) FriendWatchlist(ctx context.Context, clientID, ownerToken, uuid string) ([]WatchlistEntry, error) {
	const query = `query GetWatchlistHub ($user: UserInput!, $first: PaginationInt!, $after: String) {
  userV2(user: $user) { ... on User { watchlist(first: $first, after: $after) { nodes { id title type } pageInfo { hasNextPage endCursor } } } }
}`
	var out []WatchlistEntry
	var after *string
	for page := 0; ; page++ {
		if page >= maxPages {
			return nil, fmt.Errorf("%w: the Watchlist does not end", ErrUnavailable)
		}
		if page > 0 {
			if err := c.pause(ctx); err != nil {
				return nil, err
			}
		}
		data, err := c.graphql(ctx, clientID, ownerToken, query, map[string]any{"user": map[string]any{"id": uuid}, "first": watchlistPageSize, "after": after})
		if err != nil {
			return nil, err
		}
		var d struct {
			UserV2 *struct {
				Watchlist json.RawMessage `json:"watchlist"`
			} `json:"userV2"`
		}
		if json.Unmarshal(data, &d) != nil || d.UserV2 == nil {
			return nil, fmt.Errorf("%w: plex.tv sent no Watchlist for the friend", ErrUnavailable)
		}
		if string(d.UserV2.Watchlist) == "null" {
			return nil, ErrWatchlistHidden
		}
		var w struct {
			Nodes []struct {
				ID    string `json:"id"`
				Title string `json:"title"`
				Type  string `json:"type"`
			} `json:"nodes"`
			PageInfo struct {
				HasNextPage bool    `json:"hasNextPage"`
				EndCursor   *string `json:"endCursor"`
			} `json:"pageInfo"`
		}
		if json.Unmarshal(d.UserV2.Watchlist, &w) != nil {
			return nil, fmt.Errorf("%w: plex.tv sent no Watchlist for the friend", ErrUnavailable)
		}
		for _, n := range w.Nodes {
			e, err := entryOf(n.ID, n.Type, n.Title)
			if err != nil {
				return nil, err
			}
			out = append(out, e)
		}
		if !w.PageInfo.HasNextPage {
			return out, nil
		}
		if w.PageInfo.EndCursor == nil || *w.PageInfo.EndCursor == "" {
			return nil, fmt.Errorf("%w: a Watchlist page has no cursor", ErrUnavailable)
		}
		after = w.PageInfo.EndCursor
	}
}

// pause waits Options.PageDelay between two pages.
func (c *Client) pause(ctx context.Context) error {
	if c.pageDelay <= 0 {
		return ctx.Err()
	}
	t := time.NewTimer(c.pageDelay)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Resolve reads the ids Plex's metadata lists for the title with the rating
// key. A title plex.tv does not know has no ids; it is not an outage.
func (c *Client) Resolve(ctx context.Context, clientID, ownerToken, key string) (Ids, error) {
	status, raw, err := c.request(ctx, http.MethodGet, c.discover+"/library/metadata/"+url.PathEscape(key), clientID, ownerToken, "application/json")
	if err != nil {
		return Ids{}, wrap(err)
	}
	if status == http.StatusNotFound {
		return Ids{}, nil
	}
	var doc struct {
		MediaContainer *struct {
			Metadata []struct {
				// guid is the Plex guid string. It is declared so that encoding/json does not
				// match it, ignoring case, to Guid below, the list of external ids.
				PlexGuid string `json:"guid"`
				Guid     []struct {
					ID string `json:"id"`
				} `json:"Guid"`
			} `json:"Metadata"`
		} `json:"MediaContainer"`
	}
	if json.Unmarshal(raw, &doc) != nil || doc.MediaContainer == nil {
		return Ids{}, fmt.Errorf("%w: plex.tv sent no metadata", ErrUnavailable)
	}
	var ids Ids
	for _, m := range doc.MediaContainer.Metadata {
		for _, g := range m.Guid {
			scheme, id, ok := strings.Cut(g.ID, "://")
			if !ok {
				continue
			}
			n, numErr := strconv.Atoi(id)
			switch {
			case scheme == "tmdb" && numErr == nil && n > 0:
				ids.TMDB = n
			case scheme == "tvdb" && numErr == nil && n > 0:
				ids.TVDB = n
			case scheme == "imdb" && strings.HasPrefix(id, "tt"):
				ids.IMDb = id
			}
		}
	}
	return ids, nil
}
