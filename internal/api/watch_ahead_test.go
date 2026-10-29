package api_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
)

const breakingBad = `{"kind":"series","tmdb_id":1396}`

const switchesWith = `{"enabled":true,"watchlist":false,"watch_ahead":%t,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":"Plex","users":[],"user_root_folders":[]}`

// playedOn is a Plex server whose play history the test writes: it answers the
// history and show calls itself and hands every other call to plex.tv's stand-in.
type playedOn struct {
	mu    sync.Mutex
	plays []string // JSON history entries, oldest first
}

func (p *playedOn) play(at time.Time, season, episode int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.plays = append(p.plays, fmt.Sprintf(`{"type":"episode","grandparentKey":"/library/metadata/456","parentIndex":%d,"index":%d,"viewedAt":%d}`, season, episode, at.Unix()))
}

func (p *playedOn) handler(rest http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status/sessions/history/all":
			from, _ := strconv.ParseInt(r.URL.Query().Get("viewedAt>"), 10, 64)
			var out []string
			p.mu.Lock()
			for _, e := range p.plays {
				var at int64
				_, _ = fmt.Sscanf(e[strings.Index(e, `"viewedAt":`):], `"viewedAt":%d`, &at)
				if at >= from {
					out = append(out, e)
				}
			}
			p.mu.Unlock()
			_, _ = w.Write([]byte(`{"MediaContainer":{"Metadata":[` + strings.Join(out, ",") + `]}}`))
		case "/library/metadata/456":
			_, _ = w.Write([]byte(`{"MediaContainer":{"Metadata":[{"guid":"plex://show/1","Guid":[{"id":"tvdb://81189"}]}]}}`))
		default:
			rest.ServeHTTP(w, r)
		}
	})
}

// watchAheadHousehold is a household whose Plex has the play history, with Watch-ahead switched as asked.
func watchAheadHousehold(t *testing.T, on bool) (*plexHousehold, library, *playedOn) {
	t.Helper()
	h, l := requesterLibrary(t)
	plays := &playedOn{}
	target, _ := url.Parse(h.tv.URL)
	srv := httptest.NewServer(plays.handler(httputil.NewSingleHostReverseProxy(target)))
	t.Cleanup(srv.Close)
	list := decode[struct {
		Items []struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
		} `json:"items"`
	}](t, h.admin.valid("GET", "/plugin-instances", ""))
	for _, i := range list.Items {
		if i.Name == "Plex" {
			if r := h.admin.valid("PATCH", fmt.Sprintf("/plugin-instances/%d", i.ID), `{"config":{"url":"`+srv.URL+`"}}`); r.Status != 200 {
				t.Fatalf("PATCH instance = %d %s", r.Status, r.Body)
			}
		}
	}
	h.putSignIn(fmt.Sprintf(switchesWith, on))
	return h, l, plays
}

func seasonsOf(t *testing.T, l library, id int64) (monitored []int) {
	t.Helper()
	title := decode[seriesTitleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", id), ""))
	for _, se := range title.Seasons {
		if se.Monitored {
			monitored = append(monitored, se.Number)
		}
	}
	return monitored
}

func TestAWatchAheadRequestAsksForSeasonOneAndTheNextOnceTwoEpisodesWerePlayed(t *testing.T) {
	t.Parallel()
	h, l, plex := watchAheadHousehold(t, true)
	b := h.requester("anna-token")

	req := decode[requestJSON](t, b.valid("POST", "/my/requests", breakingBad))
	if !reflect.DeepEqual(req.Seasons, []int{1}) || req.TitleID == nil {
		t.Fatalf("request = %+v, want season 1 alone", req)
	}
	if got := seasonsOf(t, l, *req.TitleID); !reflect.DeepEqual(got, []int{1}) {
		t.Fatalf("monitored seasons = %v, want 1", got)
	}

	pass := func() {
		t.Helper()
		if err := h.app.Jobs.Pass(context.Background(), jobs.WatchAhead); err != nil {
			t.Fatal(err)
		}
	}
	// Ben, another account, plays an episode; so does the household's owner.
	plex.play(h.clock.Now().Add(time.Minute), 1, 1)
	pass()
	if got := decode[requestJSON](t, l.valid("GET", fmt.Sprintf("/requests/%d", req.ID), "")); !reflect.DeepEqual(got.Seasons, []int{1}) {
		t.Fatalf("seasons after one episode = %v", got.Seasons)
	}
	h.clock.Advance(time.Hour)
	plex.play(h.clock.Now(), 1, 2)
	pass()
	pass() // a second pass changes nothing

	got := decode[requestJSON](t, l.valid("GET", fmt.Sprintf("/requests/%d", req.ID), ""))
	if !reflect.DeepEqual(got.Seasons, []int{1, 2}) {
		t.Fatalf("seasons after two episodes = %v, want 1 and 2", got.Seasons)
	}
	if m := seasonsOf(t, l, *req.TitleID); !reflect.DeepEqual(m, []int{1, 2}) {
		t.Errorf("monitored seasons = %v, want 1 and 2", m)
	}
	events := l.valid("GET", "/events", "").Body
	if strings.Count(events, "Watch-ahead added season 2") != 1 {
		t.Errorf("the Log does not say once that Watch-ahead added season 2: %s", events)
	}
}

func TestAWatchAheadRequestIsTheWholeSeriesWhileTheSwitchIsOff(t *testing.T) {
	t.Parallel()
	h, l, plex := watchAheadHousehold(t, false)
	b := h.requester("anna-token")

	req := decode[requestJSON](t, b.valid("POST", "/my/requests", breakingBad))
	if len(req.Seasons) != 0 {
		t.Fatalf("seasons = %v, want the whole Series", req.Seasons)
	}
	whole := seasonsOf(t, l, *req.TitleID)
	plex.play(h.clock.Now().Add(time.Minute), 1, 1)
	plex.play(h.clock.Now().Add(2*time.Minute), 1, 2)
	if err := h.app.Jobs.Pass(context.Background(), jobs.WatchAhead); err != nil {
		t.Fatal(err)
	}
	if got := seasonsOf(t, l, *req.TitleID); !reflect.DeepEqual(got, whole) {
		t.Errorf("monitored seasons = %v, want %v untouched", got, whole)
	}
}

func TestASeriesRequestFromASourceTakesItsWatchAheadDefaultAndTheRequestMayOverrideIt(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name, source, watchAhead string
		siloOn                   bool
		wantSeasons              []int
	}{
		{"Silo, switch on", "silo", "", true, []int{1}},
		{"Silo, switch off", "silo", "", false, nil},
		{"Silo, switch on, asked for the whole Series", "silo", `,"watch_ahead":false`, true, nil},
		{"Silo, switch on, null", "silo", `,"watch_ahead":null`, true, []int{1}},
		{"Silo, switch off, asked for Watch-ahead", "silo", `,"watch_ahead":true`, false, []int{1}},
		{"another source, Silo switch on", "seerr", "", true, nil},
		{"another source, asked for Watch-ahead", "seerr", `,"watch_ahead":true`, false, []int{1}},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			h, l, _ := watchAheadHousehold(t, true)
			h.addSilo("Silo")
			h.putSilo(fmt.Sprintf(`{"watch_ahead":%t,"instance":"Silo"}`, c.siloOn))
			body := `{"source":"` + c.source + `","source_request_id":"s-1","requester":{"id":"1","name":"kim"},"title":{"kind":"series","tmdb_id":1396},"slots":[{"slot":"standard"}]` + c.watchAhead + `}`
			req := decode[requestJSON](t, l.valid("POST", "/requests", body))
			if !reflect.DeepEqual(req.Seasons, c.wantSeasons) && (len(req.Seasons) != 0 || len(c.wantSeasons) != 0) {
				t.Errorf("seasons = %v, want %v", req.Seasons, c.wantSeasons)
			}
		})
	}
}

func TestASilosWatchAheadRequestNamingSeasonsAsksForThem(t *testing.T) {
	t.Parallel()
	h, l, _ := watchAheadHousehold(t, false)
	h.addSilo("Silo")
	h.putSilo(`{"watch_ahead":true,"instance":"Silo"}`)
	body := `{"source":"silo","source_request_id":"s-1","requester":{"id":"1","name":"kim"},"title":{"kind":"series","tmdb_id":1396},"slots":[{"slot":"standard"}],"seasons":[2],"watch_ahead":true}`
	if req := decode[requestJSON](t, l.valid("POST", "/requests", body)); !reflect.DeepEqual(req.Seasons, []int{2}) {
		t.Errorf("seasons = %v, want the season asked for", req.Seasons)
	}
}
