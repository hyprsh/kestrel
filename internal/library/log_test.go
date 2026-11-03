package library

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/history"
)

func TestReasonOfSaysWhoOrWhatAskedForTheChange(t *testing.T) {
	cases := []struct {
		name string
		t    history.Trigger
		want string
	}{
		{"a person", history.Person("navi", "CreateTitle"), "chosen by hand: added to the Library"},
		{"the API key", history.APIKey("CreateTitle"), "chosen by hand: added to the Library"},
		{"a Request", history.Job(history.TriggerRequest, "Plex"), "request: asked for via Plex, added to the Library"},
		{"a rule", history.Job(history.TriggerRule, "watch ahead"), "rule: watch ahead, added to the Library"},
		{"a job without a name", history.Job(history.TriggerJob, ""), "job: job, added to the Library"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := reasonOf(c.t, "added to the Library"); got != c.want {
				t.Fatalf("reasonOf = %q, want %q", got, c.want)
			}
		})
	}
}
