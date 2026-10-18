package metadata_test

import (
	"context"
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata"
)

func TestWhatACallSaysAboutTheProvider(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want metadata.Standing
	}{
		{"a good call", nil, metadata.Standing{Counts: true}},
		{"not found says nothing wrong", &metadata.Error{Code: metadata.CodeNotFound}, metadata.Standing{Counts: true}},
		{"a rate limit is ignored", &metadata.Error{Code: metadata.CodeRateLimited}, metadata.Standing{}},
		{"a canceled request is not the provider's", context.Canceled, metadata.Standing{}},
		{"a refused key", &metadata.Error{Code: metadata.CodeAuth, Message: "bad key"}, metadata.Standing{Counts: true, Failing: true, Auth: true, Message: "bad key"}},
		{"an outage", &metadata.Error{Code: metadata.CodeUnavailable, Message: "502"}, metadata.Standing{Counts: true, Failing: true, Message: "502"}},
		{"a wrapped outage", errors.Join(errors.New("x"), &metadata.Error{Code: metadata.CodeUnavailable, Message: "502"}), metadata.Standing{Counts: true, Failing: true, Message: "502"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := metadata.StandingOf(tc.err); got != tc.want {
				t.Errorf("StandingOf = %+v, want %+v", got, tc.want)
			}
		})
	}
}
