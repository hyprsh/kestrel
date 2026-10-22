package library

import (
	"database/sql"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
)

func TestAnEpisodeIsReleasedByItsAirDateOrOnceALaterEpisodeIsOut(t *testing.T) {
	// ep is an episode with id season*100+number, aired on air ("" for none).
	ep := func(season, number int64, air string) db.Episode {
		return db.Episode{ID: season*100 + number, Season: season, Number: number, AirDate: sql.NullString{String: air, Valid: air != ""}}
	}
	at := func(s string) time.Time { return *day(s) }
	cases := []struct {
		name  string
		eps   []db.Episode
		filed map[int64]time.Time // episode id -> import time of its earliest file
		id    int64
		want  *time.Time
	}{
		{"an aired episode is released at its air date",
			[]db.Episode{ep(1, 1, "2020-01-01")}, nil, 101, day("2020-01-01")},
		{"an air date wins over an earlier file of its own",
			[]db.Episode{ep(1, 1, "2020-01-01")}, map[int64]time.Time{101: at("2019-01-01")}, 101, day("2020-01-01")},
		{"an undated episode with nothing after it is not released",
			[]db.Episode{ep(1, 1, "2020-01-01"), ep(1, 2, "")}, nil, 102, nil},
		{"an earlier episode out does not release it",
			[]db.Episode{ep(1, 1, "2020-01-01"), ep(1, 2, "")}, map[int64]time.Time{101: at("2020-01-02")}, 102, nil},
		{"an undated episode is released when the next one airs",
			[]db.Episode{ep(1, 1, ""), ep(1, 2, "2020-01-08")}, nil, 101, day("2020-01-08")},
		{"across seasons, at the earliest later episode out",
			[]db.Episode{ep(1, 9, ""), ep(2, 1, "2021-03-01"), ep(2, 2, "2021-02-01")}, nil, 109, day("2021-02-01")},
		{"a later episode with a file but no air date is out at the file's import",
			[]db.Episode{ep(1, 1, ""), ep(1, 2, "")}, map[int64]time.Time{102: at("2022-05-05")}, 101, day("2022-05-05")},
		{"a later file imported before its air date counts from the import",
			[]db.Episode{ep(1, 1, ""), ep(1, 2, "2022-06-01")}, map[int64]time.Time{102: at("2022-05-05")}, 101, day("2022-05-05")},
		{"a later episode still to air releases it then",
			[]db.Episode{ep(1, 1, ""), ep(2, 1, "2099-01-01")}, nil, 101, day("2099-01-01")},
		{"a Special never releases an earlier episode",
			[]db.Episode{ep(0, 1, "2020-01-01"), ep(0, 2, ""), ep(1, 1, "")}, map[int64]time.Time{1: at("2020-01-01")}, 101, nil},
		{"an undated Special is not released by a later regular episode",
			[]db.Episode{ep(0, 1, ""), ep(1, 1, "2020-01-01")}, nil, 1, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := releasedOf(c.eps, c.filed, airClock{})[c.id]; !sameTime(got, c.want) {
				t.Fatalf("released %v, want %v", got, c.want)
			}
		})
	}
}
