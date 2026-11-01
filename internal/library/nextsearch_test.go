package library_test

import (
	"context"
	"testing"
	"time"
)

func TestTheNextSearchOfAVersionIsWhenItsSearchStateIsDue(t *testing.T) {
	ctx := context.Background()
	lib, _, _ := clocked(t)
	id := addPaddington(t, lib)
	vid := mustVersion(t, lib, id)

	got, err := lib.NextSearches(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if n, ok := got[vid]; !ok || n.Missing == nil || !n.Missing.Equal(now) {
		t.Fatalf("on add the next search is %+v, want it due now", got[vid])
	}

	if err := lib.MarkMissingSearched(ctx, vid, now, false); err != nil {
		t.Fatal(err)
	}
	got, _ = lib.NextSearches(ctx, id)
	if n := got[vid]; n.Missing == nil || !n.Missing.Equal(now.Add(24*time.Hour)) {
		t.Errorf("after the first search the next is %v, want a day after it became Wanted", n.Missing)
	}
}

func TestANextSearchOfAnotherTitleIsNotMixedIn(t *testing.T) {
	ctx := context.Background()
	lib, _, _ := clocked(t)
	id := addPaddington(t, lib)

	got, err := lib.NextSearches(ctx, id+100)
	if err != nil || len(got) != 0 {
		t.Errorf("NextSearches of an unknown Title = %v, %v; want none", got, err)
	}
}

func TestNextSearchesOfVersionsAreTheSameAsOfTheirTitleAndLeaveOthersOut(t *testing.T) {
	ctx := context.Background()
	lib, _, _ := clocked(t)
	id := addPaddington(t, lib)
	vid := mustVersion(t, lib, id)

	one, err := lib.NextSearches(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	many, err := lib.NextSearchesOf(ctx, []int64{vid})
	if err != nil {
		t.Fatal(err)
	}
	if len(many) != 1 || many[vid].Missing == nil || !many[vid].Missing.Equal(*one[vid].Missing) {
		t.Errorf("NextSearchesOf = %+v, want the Title's %+v", many, one)
	}
	if none, _ := lib.NextSearchesOf(ctx, []int64{vid + 100}); len(none) != 0 {
		t.Errorf("an unknown Version has next searches %v", none)
	}
}
