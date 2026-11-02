package api_test

import (
	"context"
	"testing"
	"time"
)

// A Version committed while a preset waits for the write connection must still stop it: the check is made inside the
// transaction, not before it.
func TestAVersionCommittedWhileAPresetWaitsToWriteStopsIt(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.setUp()
	before := slotList(t, b)
	tx, err := in.st.Write().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO titles (id, kind, title, original_title, primary_title, tmdb_id, root_folder, added_at, refreshed_at) VALUES (1, 'movie', 'T', 'T', 'T', 1, '/m', 'x', 'x')`,
		`INSERT INTO versions (title_id, slot, profile_key, added_at) VALUES (1, 'standard', 'hd-primary', 'x')`,
	} {
		if _, err := tx.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	done := make(chan reply)
	go func() { done <- b.do("POST", "/slots/presets/one-copy", "") }()
	time.Sleep(300 * time.Millisecond) // the preset has read the library and waits for the write connection
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if r := <-done; r.Status != 409 {
		t.Errorf("apply = %d %s, want 409", r.Status, r.Body)
	}
	if after := slotList(t, b); len(after) != len(before) {
		t.Errorf("slots changed: %+v", after)
	}
}
