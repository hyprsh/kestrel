package api_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/hyprsh/kestrel/internal/health"
)

func TestAnUnreachableMediaServerIsAWarningWithTestAndOpenMediaServers(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	if err := s.in.app.Health.Raise(context.Background(), health.Issue{
		Key: "media_server:5", Kind: health.KindMediaServer, Severity: health.Warning,
		Subject: health.Subject{PluginInstanceID: 5}, Message: "Plex is unreachable: connection refused",
	}); err != nil {
		t.Fatal(err)
	}

	row := s.attention(t).row(t, "media_server_unreachable")
	if row.Severity != "warning" || row.Subject.PluginInstanceID == nil || *row.Subject.PluginInstanceID != 5 {
		t.Errorf("row = %+v", row)
	}
	if test := row.action(t, "test"); test.Method != "POST" || test.Path != fmt.Sprintf("/plugin-instances/%d/test", 5) {
		t.Errorf("test action = %+v", test)
	}
	if open := row.action(t, "open"); open.Method != "GET" || open.Path != "/settings/media-servers" {
		t.Errorf("open action = %+v", open)
	}
	for _, a := range row.Actions {
		if a.Key == "dismiss" {
			t.Errorf("the row clears itself; got %+v", a)
		}
	}
}
