package api_test

import (
	"context"
	"database/sql"
	"fmt"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

// Benchmarks of the hot read paths on a big Library: `go test ./internal/api -run '^$' -bench Scale -benchtime 20x`.
// scaleTitles Titles are written straight into SQLite: three Movies to one Series, most with files, some Wanted, some
// not monitored, the Series with 2 to 6 Seasons of 6 to 12 episodes (the shape scripts/demo/seed_big.py makes).
const scaleTitles = 4000

const probeJSON = `{"Size":8589934592,"Duration":3000000000000,"HasVideo":true,"Width":1920,"Height":1080,"VideoCodec":"h264","HDR":"","Audio":[{"Index":1,"Codec":"dts","Channels":6,"Profile":"DTS","Language":"eng","Default":true}]}`
const parsedJSON = `{"kind":"movie","titles":["Demo"],"year":2014,"quality":{"quality":{"id":7,"name":"Bluray-1080p","source":"bluray","resolution":1080,"modifier":"none"},"revision":{"version":1,"real":0,"isRepack":false},"sourceDetection":"name","resolutionDetection":"name","modifierDetection":"unknown","revisionDetection":"unknown"},"languages":[{"id":0,"name":"Unknown"}],"videoCodec":"H.264","audioCodec":"DTS","audioChannels":"5.1","releaseGroup":"DEMO","originalTitle":"Demo.2014.1080p.BluRay.DTS.5.1.x264-DEMO","releaseTitle":"Demo.2014.1080p.BluRay.DTS.5.1.x264-DEMO","simpleReleaseTitle":"A Movie.2014.1080p.BluRay.DTS.5.1.x264-DEMO"}`

func seedScale(b *testing.B, db *sql.DB, titles int) {
	b.Helper()
	rnd := rand.New(rand.NewSource(4000))
	now := time.Now().UTC()
	day := func(n int) string { return now.AddDate(0, 0, n).Format("2006-01-02") }
	stamp := now.AddDate(0, 0, -100).Format("2006-01-02T15:04:05Z")
	tx, err := db.Begin()
	if err != nil {
		b.Fatal(err)
	}
	must := func(q string, args ...any) int64 {
		res, err := tx.Exec(q, args...)
		if err != nil {
			b.Fatalf("%s: %v", q, err)
		}
		id, _ := res.LastInsertId()
		return id
	}
	file := func(version int64, path string, size int64, score int) int64 {
		return must(`insert into files (version_id, path, size, release_name, parsed_release, probe, score, imported_at) values (?,?,?,?,?,?,?,?)`,
			version, path, size, "Demo.2014.1080p.BluRay.DTS.5.1.x264-DEMO", parsedJSON, probeJSON, score, stamp)
	}
	for i := 0; i < titles; i++ {
		series := i%4 == 3
		kind, tmdb, tvdb := "movie", any(800000+i), any(nil)
		if series {
			kind, tmdb, tvdb = "series", nil, 800000+i
		}
		var mode any
		if series {
			mode = "all"
		}
		name := fmt.Sprintf("Title number %d", i)
		monitored := 1
		if rnd.Intn(10) == 0 {
			monitored = 0
		}
		tid := must(`insert into titles (kind, tmdb_id, tvdb_id, title, original_title, primary_title, year, original_language, overview, runtime, monitored, series_monitor, root_folder, folder, added_at, refreshed_at)
			values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, kind, tmdb, tvdb, name, name, name, 1990+rnd.Intn(35), "en", "overview", 100, monitored, mode, "/media", name, stamp, stamp)
		v := must(`insert into versions (title_id, slot, profile_key, added_at) values (?, 'standard', 'hd-primary', ?)`, tid, stamp)
		if !series {
			if rnd.Intn(100) < 67 {
				file(v, fmt.Sprintf("/media/%d.mkv", i), 8<<30, 1500+rnd.Intn(400))
			}
			continue
		}
		complete := rnd.Intn(100) < 75
		for s := 1; s <= 2+rnd.Intn(5); s++ {
			must(`insert into seasons (title_id, number, monitored) values (?,?,1)`, tid, s)
			eps := 6 + rnd.Intn(7)
			for e := 1; e <= eps; e++ {
				air := day(-30 * (7 - s) * 2)
				eid := must(`insert into episodes (title_id, season, number, name, air_date, monitored, primary_name) values (?,?,?,?,?,1,?)`, tid, s, e, "Episode", air, "Episode")
				if complete {
					f := file(v, fmt.Sprintf("/media/%d/s%de%d.mkv", i, s, e), 2<<30, 1700)
					must(`insert into file_episodes (file_id, version_id, episode_id) values (?,?,?)`, f, v, eid)
				}
			}
		}
	}
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}
}

// scaleServer is the real handler over a Library of scaleTitles, called without the network.
func scaleServer(b *testing.B) (http.Handler, *store.Store) {
	b.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(b)})
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { st.Close() })
	roomy := func(string) (health.Space, error) { return health.Space{Free: 500 << 30, Total: 1 << 40}, nil }
	a := app.New(app.Options{Options: api.Options{Version: "bench", Store: st, Web: webFS, CheapPasswordHash: true}, DiskSpace: roomy})
	b.Cleanup(func() { a.Close(context.Background()) })
	time.Sleep(time.Second) // the start-up jobs finish on the empty Library; seeding after them keeps their rescoring out of the numbers
	seedScale(b, st.Write(), scaleTitles)
	return a.Handler, st
}

func benchGET(b *testing.B, path string) { benchGETBetween(b, path, nil) }

// benchGETBetween times the GET like benchGET and runs between before every request. The writes' cost is part of the
// number, so compare runs of the same between.
func benchGETBetween(b *testing.B, path string, between func(st *store.Store, i int)) {
	h, st := scaleServer(b)
	setup := httptest.NewRequest(http.MethodPost, "/api/v1/setup/account", strings.NewReader(`{"username":"bench","password":"bench-password-123"}`))
	setup.Header.Set("Content-Type", "application/json")
	setup.Header.Set("Origin", "http://"+setup.Host)
	account := httptest.NewRecorder()
	h.ServeHTTP(account, setup)
	if account.Code >= 300 {
		b.Fatalf("setup account = %d %s", account.Code, account.Body.String())
	}
	cookies := account.Result().Cookies()
	get := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		for _, c := range cookies {
			req.AddCookie(c)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := get(); rec.Code != 200 {
		b.Fatalf("GET %s = %d %s", path, rec.Code, rec.Body.String())
	}
	b.ResetTimer()
	var size int
	for i := 0; i < b.N; i++ {
		if between != nil {
			between(st, i)
		}
		size = get().Body.Len()
	}
	b.ReportMetric(float64(size), "bytes/response")
}

func BenchmarkScaleListTitles(b *testing.B) { benchGET(b, "/api/v1/titles?limit=10000") }

// BenchmarkScaleListTitlesBusy reads the list between writes to tables it does not show: Log entries, Health issues and
// job runs, as a busy install does. Before the list cache was kept per table, each write made the next read a miss.
func BenchmarkScaleListTitlesBusy(b *testing.B) {
	at := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	benchGETBetween(b, "/api/v1/titles?limit=10000", func(st *store.Store, i int) {
		var err error
		switch i % 3 {
		case 0:
			_, err = st.Write().Exec(`INSERT INTO events (at, kind, routine, message) VALUES (?, 'bench', 1, 'tick')`, at)
		case 1:
			_, err = st.Write().Exec(`INSERT INTO health_issues (key, kind, severity, message, first_at, last_at) VALUES ('bench', 'bench', 'warning', 'm', ?, ?)
				ON CONFLICT (key) DO UPDATE SET count = count + 1, last_at = excluded.last_at`, at, at)
		default:
			_, err = st.Write().Exec(`INSERT INTO job_runs (name, started_at, finished_at, took_ms) VALUES ('bench', ?, ?, 1)`, at, at)
		}
		if err != nil {
			b.Fatal(err)
		}
	})
}

func BenchmarkScaleStats(b *testing.B) { benchGET(b, "/api/v1/stats") }
func BenchmarkScaleUpcoming(b *testing.B) {
	benchGET(b, "/api/v1/upcoming?from="+time.Now().AddDate(0, 0, -14).Format("2006-01-02")+"&to="+time.Now().AddDate(0, 0, 60).Format("2006-01-02"))
}

// BenchmarkScaleUpcomingOpen is the requests the Upcoming screen makes on open: one per month from the month of today-14 to
// the month of today+60 (widened to the month grid), all with unmonitored=true and all at once. "cold" starts each open
// with a write that drops the cache, so it times the first open after any change; "warm" is the same requests answered from it.
func BenchmarkScaleUpcomingOpen(b *testing.B) {
	h, st := scaleServer(b)
	setup := httptest.NewRequest(http.MethodPost, "/api/v1/setup/account", strings.NewReader(`{"username":"bench","password":"bench-password-123"}`))
	setup.Header.Set("Content-Type", "application/json")
	setup.Header.Set("Origin", "http://"+setup.Host)
	account := httptest.NewRecorder()
	h.ServeHTTP(account, setup)
	if account.Code >= 300 {
		b.Fatalf("setup account = %d %s", account.Code, account.Body.String())
	}
	cookies := account.Result().Cookies()
	firstOf := func(t time.Time) time.Time { return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC) }
	var paths []string
	now := time.Now().UTC()
	for m := firstOf(now.AddDate(0, 0, -14)); !m.After(now.AddDate(0, 0, 60)); m = m.AddDate(0, 1, 0) {
		paths = append(paths, "/api/v1/upcoming?unmonitored=true&from="+m.Format("2006-01-02")+"&to="+m.AddDate(0, 1, -1).Format("2006-01-02"))
	}
	open := func() int {
		var wg sync.WaitGroup
		sizes := make([]int, len(paths))
		for i, p := range paths {
			wg.Add(1)
			go func() {
				defer wg.Done()
				req := httptest.NewRequest(http.MethodGet, p, nil)
				for _, c := range cookies {
					req.AddCookie(c)
				}
				rec := httptest.NewRecorder()
				h.ServeHTTP(rec, req)
				if rec.Code != 200 {
					b.Errorf("GET %s = %d %s", p, rec.Code, rec.Body.String())
				}
				sizes[i] = rec.Body.Len()
			}()
		}
		wg.Wait()
		total := 0
		for _, s := range sizes {
			total += s
		}
		return total
	}
	open()
	var size int
	b.Run("cold", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			b.StopTimer()
			if _, err := st.Write().Exec(`update titles set overview = ? where id = 1`, fmt.Sprint("touched ", i)); err != nil {
				b.Fatal(err)
			}
			b.StartTimer()
			size = open()
		}
		b.ReportMetric(float64(size), "bytes/open")
	})
	b.Run("warm", func(b *testing.B) {
		open()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			size = open()
		}
		b.ReportMetric(float64(size), "bytes/open")
	})
}

func BenchmarkScaleAttention(b *testing.B) { benchGET(b, "/api/v1/attention") }
func BenchmarkScaleSearchTitles(b *testing.B) {
	benchGET(b, "/api/v1/titles?q=number%2012&limit=10000")
}
