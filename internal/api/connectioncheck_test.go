package api_test

import (
	"context"
	"testing"
	"time"
)

func TestARevokedMediaServerTokenRaisesTheRowAtTheNextCheckAndClearsWhenItAnswersAgain(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, _ := newMediaSearch(t)
	inst := decode[struct {
		Items []instanceJSON `json:"items"`
	}](t, s.valid("GET", "/plugin-instances", ""))
	var plex instanceJSON
	for _, i := range inst.Items {
		if i.PluginID == "fake_media_server" {
			plex = i
		}
	}
	path := "/plugin-instances/" + itoa(plex.ID)

	if err := s.in.app.Health.RunChecks(ctx); err != nil {
		t.Fatal(err)
	}
	if n := s.attention(t).Count; n != 0 {
		t.Fatalf("a working server raises nothing: %v", s.attention(t).kinds())
	}
	if got := decode[lastCheckJSON](t, s.valid("GET", path, "")); got.LastCheck == nil || !got.LastCheck.OK {
		t.Fatalf("the check should be the instance's last: %+v", got.LastCheck)
	}

	s.valid("PATCH", path, `{"config":{"token":"revoked"}}`)
	s.in.clock.Advance(15 * time.Minute)
	if err := s.in.app.Health.RunChecks(ctx); err != nil {
		t.Fatal(err)
	}
	row := s.attention(t).row(t, "media_server_unreachable")
	if row.Severity != "warning" {
		t.Errorf("row = %+v", row)
	}
	got := decode[lastCheckJSON](t, s.valid("GET", path, ""))
	if got.LastCheck == nil || got.LastCheck.OK || got.LastCheck.Code == nil || *got.LastCheck.Code != "auth" {
		t.Errorf("last check = %+v", got.LastCheck)
	}

	s.valid("PATCH", path, `{"config":{"token":"mk"}}`)
	s.in.clock.Advance(15 * time.Minute)
	_ = s.in.app.Health.RunChecks(ctx)
	if n := s.attention(t).Count; n != 0 {
		t.Errorf("a good check should clear it: %v", s.attention(t).kinds())
	}
}
