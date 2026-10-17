package acquire

import (
	"slices"
	"testing"
)

func TestSearchTitlesAddsTheTransliteratedSpellings(t *testing.T) {
	got := searchTitles("Ein Bär namens Paddington", "Paddington", "Paddington", "Amélie")
	want := []string{"Ein Bär namens Paddington", "Paddington", "Amélie", "Ein Baer namens Paddington", "Amelie"}
	if !slices.Equal(got, want) {
		t.Errorf("searchTitles = %q, want %q", got, want)
	}
}

func TestNormalizeComparesTitlesAsWords(t *testing.T) {
	if a, b := normalize("Ein Bär namens Paddington!"), normalize("Ein.Baer.namens.Paddington"); a != b {
		t.Errorf("%q != %q", a, b)
	}
	if normalize("Paddington") == normalize("Paddington Brown") {
		t.Error("different titles compared equal")
	}
}
