package api

import (
	"context"
	"net/http"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/history"
)

// actorOf is who a call is for the Log: the signed-in person (the admin account, the header's user behind a
// reverse proxy, or a Requester) or the API key, with the operation as the API call.
func (s *server) actorOf(ctx context.Context, operationID string) history.Trigger {
	info := requestFrom(ctx)
	switch {
	case info.requester != nil:
		return history.Person(info.requester.name, operationID)
	case info.method == oapi.ApiKey:
		return history.APIKey(operationID)
	case info.method == oapi.Proxy && info.proxyUser != "":
		return history.Person(info.proxyUser, operationID)
	}
	acc, _, err := loadAccount(ctx, s.auth.settings)
	if err != nil || acc.Username == "" {
		return history.Person("admin", operationID)
	}
	return history.Person(acc.Username, operationID)
}

// recordActor is a strict-server middleware that makes the caller the trigger of every event a changing call
// records (history.WithTrigger), so the modules below name the person without being handed one. A read can record
// too (a metadata lookup that finds the key rejected raises a Needs attention row), so every call has one.
func (s *server) recordActor(next oapi.StrictHandlerFunc, operationID string) oapi.StrictHandlerFunc {
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
		return next(history.WithTrigger(ctx, s.actorOf(ctx, operationID)), w, r, request)
	}
}
