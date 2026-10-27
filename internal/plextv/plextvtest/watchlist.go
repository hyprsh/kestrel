package plextvtest

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// WatchItem is a title on a Watchlist, as plex.tv's discover service knows it.
type WatchItem struct {
	// Key is the Plex rating key.
	Key string
	// Type is "movie" or "show".
	Type  string
	Title string
	// Guids are the external ids the metadata endpoint lists, such as "tmdb://603".
	Guids []string
}

// Friend is a friend of the owner in plex.tv's community API.
type Friend struct{ UUID, Username, DisplayName string }

// watchlists is the fake's Watchlist state; mu of Server guards it.
type watchlists struct {
	friends []Friend
	lists   map[string][]WatchItem // by account uuid
	meta    map[string]WatchItem   // by rating key
	broken  bool
	// hidden are the friends whose Watchlist they keep private: plex.tv answers userV2 with a null watchlist.
	hidden map[string]bool
	// metaCalls counts the metadata reads by rating key.
	metaCalls map[string]int
}

// AddFriend lists f among the owner's friends in the community API.
func (s *Server) AddFriend(f Friend) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.wl.friends = append(s.wl.friends, f)
}

// SetWatchlist replaces the Watchlist of the account with uuid (Owner.UUID for the owner's), and
// makes the metadata endpoint know each item.
func (s *Server) SetWatchlist(uuid string, items ...WatchItem) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.wl.lists == nil {
		s.wl.lists, s.wl.meta = map[string][]WatchItem{}, map[string]WatchItem{}
	}
	s.wl.lists[uuid] = items
	for _, it := range items {
		s.wl.meta[it.Key] = it
	}
}

// HideWatchlist makes the friend with uuid keep their Watchlist private (hidden true) or show it again.
func (s *Server) HideWatchlist(uuid string, hidden bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.wl.hidden == nil {
		s.wl.hidden = map[string]bool{}
	}
	s.wl.hidden[uuid] = hidden
}

// BreakWatchlists makes the Watchlist and metadata calls answer 200 with something that is not
// what plex.tv sends, as an API change would.
func (s *Server) BreakWatchlists(broken bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.wl.broken = broken
}

// MetadataReads is how many times the metadata of the rating key was read.
func (s *Server) MetadataReads(key string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.wl.metaCalls[key]
}

// guidOf is the item's Plex guid.
func guidOf(it WatchItem) string { return "plex://" + it.Type + "/" + it.Key }

func (s *Server) watchlistRoutes(mux *http.ServeMux) {
	// The owner's Watchlist, paged by X-Plex-Container-Start and -Size.
	mux.HandleFunc("GET /discover/library/sections/watchlist/all", s.handle(func(w http.ResponseWriter, r *http.Request) {
		acct, ok := s.accounts[r.Header.Get("X-Plex-Token")]
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if s.wl.broken {
			writeJSON(w, map[string]any{"oops": true})
			return
		}
		list := s.wl.lists[acct.UUID]
		start, _ := strconv.Atoi(r.URL.Query().Get("X-Plex-Container-Start"))
		size, _ := strconv.Atoi(r.URL.Query().Get("X-Plex-Container-Size"))
		if size <= 0 {
			size = 50
		}
		page := list[min(start, len(list)):min(start+size, len(list))]
		md := []map[string]any{}
		for _, it := range page {
			md = append(md, map[string]any{"ratingKey": it.Key, "guid": guidOf(it), "type": it.Type, "title": it.Title})
		}
		mc := map[string]any{"size": len(page), "totalSize": len(list), "offset": start}
		if len(md) > 0 {
			mc["Metadata"] = md
		}
		writeJSON(w, map[string]any{"MediaContainer": mc})
	}))
	mux.HandleFunc("GET /discover/library/metadata/{key}", s.handle(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := s.accounts[r.Header.Get("X-Plex-Token")]; !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if s.wl.broken {
			writeJSON(w, map[string]any{"oops": true})
			return
		}
		key := r.PathValue("key")
		if s.wl.metaCalls == nil {
			s.wl.metaCalls = map[string]int{}
		}
		s.wl.metaCalls[key]++
		it, ok := s.wl.meta[key]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		guids := []map[string]string{}
		for _, g := range it.Guids {
			guids = append(guids, map[string]string{"id": g})
		}
		writeJSON(w, map[string]any{"MediaContainer": map[string]any{"size": 1, "Metadata": []map[string]any{
			{"ratingKey": it.Key, "guid": guidOf(it), "type": it.Type, "title": it.Title, "Guid": guids},
		}}})
	}))
	// The community GraphQL API: the friends list and a friend's Watchlist.
	mux.HandleFunc("POST /community/api", s.handle(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := s.accounts[r.Header.Get("X-Plex-Token")]; !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var q struct {
			Query     string `json:"query"`
			Variables struct {
				User  struct{ ID string } `json:"user"`
				First int                 `json:"first"`
				After *string             `json:"after"`
			} `json:"variables"`
		}
		if json.NewDecoder(r.Body).Decode(&q) != nil || s.wl.broken {
			writeJSON(w, map[string]any{"data": nil})
			return
		}
		switch {
		case strings.Contains(q.Query, "allFriendsV2"):
			out := []map[string]any{}
			for _, f := range s.wl.friends {
				out = append(out, map[string]any{"user": map[string]any{"id": f.UUID, "username": f.Username, "displayName": f.DisplayName, "avatar": ""}, "createdAt": "2024-01-01T00:00:00Z"})
			}
			writeJSON(w, map[string]any{"data": map[string]any{"allFriendsV2": out}})
		case strings.Contains(q.Query, "watchlist("):
			list, known := s.wl.lists[q.Variables.User.ID], false
			for _, f := range s.wl.friends {
				known = known || f.UUID == q.Variables.User.ID
			}
			if !known {
				writeJSON(w, map[string]any{"data": map[string]any{"userV2": nil}})
				return
			}
			if s.wl.hidden[q.Variables.User.ID] {
				writeJSON(w, map[string]any{"data": map[string]any{"userV2": map[string]any{"watchlist": nil}}})
				return
			}
			start := 0
			if q.Variables.After != nil {
				start, _ = strconv.Atoi(*q.Variables.After)
			}
			size := q.Variables.First
			if size <= 0 {
				size = 100
			}
			end := min(start+size, len(list))
			nodes := []map[string]any{}
			for _, it := range list[min(start, len(list)):end] {
				nodes = append(nodes, map[string]any{"id": it.Key, "title": it.Title, "type": strings.ToUpper(it.Type)})
			}
			var cursor any
			if end < len(list) {
				cursor = strconv.Itoa(end)
			}
			writeJSON(w, map[string]any{"data": map[string]any{"userV2": map[string]any{"watchlist": map[string]any{
				"nodes": nodes, "pageInfo": map[string]any{"hasNextPage": end < len(list), "endCursor": cursor},
			}}}})
		default:
			writeJSON(w, map[string]any{"errors": []map[string]string{{"message": "unknown query"}}})
		}
	}))
}
