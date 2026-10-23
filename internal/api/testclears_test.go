package api_test

import (
	"context"
	"time"

	"fmt"
	"github.com/hyprsh/kestrel/internal/health"
	"testing"
)

func (s search) testOK(t *testing.T, id int64, body string) bool {
	t.Helper()
	r := s.valid("POST", fmt.Sprintf("/plugin-instances/%d/test", id), body)
	if r.Status != 200 {
		t.Fatalf("test = %d %s", r.Status, r.Body)
	}
	return decode[testJSON](t, r).OK
}

func TestAPassingTestClearsAFailingIndexerAtOnceAndAFailingOneLeavesItAlone(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.finishSetup(t)
	idx := s.instanceID(t, "fake_indexer")
	s.setKey(t, idx, "rejected")
	s.releases(t, s.hd)
	s.attention(t).row(t, "indexer_failing")

	if s.testOK(t, idx, "") {
		t.Fatal("the rejected key must fail its Test")
	}
	if !s.attention(t).has("indexer_failing") || !s.in.app.Health.IndexerStates()[idx].Failing {
		t.Error("a failing Test must leave the row and the strip as they were")
	}

	s.setKey(t, idx, "ik")
	// Unsaved edits say nothing about the saved connection.
	if !s.testOK(t, idx, `{"config":{"api_key":"ik"}}`) {
		t.Fatal("the edited form should pass")
	}
	if !s.attention(t).has("indexer_failing") {
		t.Error("a Test with unsaved edits cleared the row")
	}

	if !s.testOK(t, idx, "") {
		t.Fatal("the saved key should pass")
	}
	if s.attention(t).has("indexer_failing") {
		t.Errorf("a passing Test should clear the row: %v", s.attention(t).kinds())
	}
	if s.in.app.Health.IndexerStates()[idx].Failing {
		t.Error("the health strip should show the indexer ok")
	}
}

func TestAPassingTestClearsAnUnreachableDownloadClientAtOnceAndAFailingOneLeavesItAlone(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.finishSetup(t)
	sab := s.instanceID(t, "fake")
	s.setKey(t, sab, "rejected")
	s.checks(t)
	s.in.clock.Advance(3 * time.Minute)
	s.checks(t)
	s.attention(t).row(t, "download_client_unreachable")

	if s.testOK(t, sab, "") {
		t.Fatal("the rejected key must fail its Test")
	}
	if !s.attention(t).has("download_client_unreachable") || !s.in.app.Health.ClientState().Failing {
		t.Error("a failing Test must leave the row and the strip as they were")
	}

	s.setKey(t, sab, "sk")
	if !s.testOK(t, sab, `{"config":{"api_key":"sk"}}`) {
		t.Fatal("the edited form should pass")
	}
	if !s.attention(t).has("download_client_unreachable") {
		t.Error("a Test with unsaved edits cleared the row")
	}

	if !s.testOK(t, sab, "") {
		t.Fatal("the saved key should pass")
	}
	if s.attention(t).has("download_client_unreachable") {
		t.Errorf("a passing Test should clear the row: %v", s.attention(t).kinds())
	}
	if s.in.app.Health.ClientState().Failing {
		t.Error("the health strip should show the download client ok")
	}
}

func TestAPassingTestClearsOnlyThatMediaServersRefreshRow(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, _ := newMediaSearch(t)
	one := s.instanceID(t, "fake_media_server")
	if r := s.valid("POST", "/plugin-instances", `{"plugin_id":"fake_media_server","name":"Other","config":{"token":"mk"}}`); r.Status != 201 {
		t.Fatalf("second media server = %d %s", r.Status, r.Body)
	}
	other := one + 1
	for _, id := range []int64{one, other} {
		if err := s.in.app.Health.Raise(ctx, health.Issue{
			Key: health.RefreshFailedKey(id), Kind: health.KindRefreshFailed, Severity: health.Warning,
			Subject: health.Subject{PluginInstanceID: id}, Message: "could not be told about a change",
		}); err != nil {
			t.Fatal(err)
		}
	}

	if !s.testOK(t, one, `{"config":{"token":"mk"}}`) {
		t.Fatal("the edited form should pass")
	}
	if n := s.attention(t).Count; n != 2 {
		t.Fatalf("a Test with unsaved edits cleared a row: %v", s.attention(t).kinds())
	}
	if !s.testOK(t, one, "") {
		t.Fatal("the saved token should pass")
	}
	a := s.attention(t)
	if a.Count != 1 || a.row(t, "refresh_failed").Subject.PluginInstanceID == nil || *a.row(t, "refresh_failed").Subject.PluginInstanceID != other {
		t.Errorf("only that server's row should go: %v", a.kinds())
	}
}
