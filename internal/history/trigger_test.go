package history_test

import (
	"context"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/history"
)

// testCtx is a context for a caller that sits below a loop or an API call, which supply the trigger in Kestrel.
func testCtx() context.Context {
	return history.WithTrigger(context.Background(), history.Job(history.TriggerJob, "test"))
}

func TestAnEventKeepsItsTriggerAndReason(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	h := newService(t, &now)
	ctx := context.Background()

	h.Record(ctx, history.Event{
		Kind: history.GrabCanceled, Message: "own", Reason: "canceled by hand",
		Trigger: history.Person("navi", "CancelGrab"),
	})
	h.Record(history.WithTrigger(ctx, history.APIKey("BulkTitles")), history.Event{Kind: history.BulkAction, Message: "from ctx", Reason: "bulk"})

	evs, err := h.After(ctx, 0, 10)
	if err != nil || len(evs) != 2 {
		t.Fatalf("After = %+v, %v", evs, err)
	}
	if got, want := evs[0].Trigger, (history.Trigger{Kind: history.TriggerPerson, Actor: "navi", Via: "CancelGrab"}); got != want {
		t.Errorf("own trigger = %+v, want %+v", got, want)
	}
	if evs[0].Reason != "canceled by hand" {
		t.Errorf("reason = %q", evs[0].Reason)
	}
	if got := evs[1].Trigger; got.Kind != history.TriggerAPIKey || got.Via != "BulkTitles" {
		t.Errorf("trigger taken from the context = %+v", got)
	}
}

func TestAnEventWithoutATriggerOrReasonFailsItsTest(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	h := newService(t, &now)
	for name, tc := range map[string]struct {
		ctx context.Context
		ev  history.Event
	}{
		"no reason":  {testCtx(), history.Event{Kind: history.GrabSent}},
		"no trigger": {context.Background(), history.Event{Kind: history.GrabSent, Reason: "r"}},
		"neither":    {context.Background(), history.Event{Kind: history.GrabSent}},
	} {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Error("Record accepted an event with no trigger or no reason")
				}
			}()
			h.Record(tc.ctx, tc.ev)
		})
	}
	if last, _ := h.Last(context.Background()); last == 0 {
		t.Error("an event that lacks them must still be written, so the action it describes never fails for it")
	}
}

func TestTriggerKeyRoundTrips(t *testing.T) {
	for _, tr := range []history.Trigger{history.Person("navi", ""), history.APIKey(""), history.Job(history.TriggerSweep, "")} {
		if got := history.TriggerFromKey(tr.Key(), ""); got != tr {
			t.Errorf("TriggerFromKey(%q) = %+v, want %+v", tr.Key(), got, tr)
		}
	}
	if !history.TriggerFromKey("", "").IsZero() {
		t.Error("an empty key is no trigger")
	}
}

// TestEveryEventSaysWhy reads the source: each history.Event written outside a test names a Reason, in its literal or,
// when it is built up in steps, by an assignment to a Reason field in the same function. A caller that forgets
// fails here even when no test reaches it.
func TestEveryEventSaysWhy(t *testing.T) {
	fset := token.NewFileSet()
	checked := 0
	err := filepath.WalkDir(filepath.Join("..", "..", "internal"), func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") || strings.Contains(path, "/oapi/") {
			return err
		}
		// The history package builds Events to read them back.
		if rel, _ := filepath.Rel(filepath.Join("..", "..", "internal", "history"), path); !strings.HasPrefix(rel, "..") {
			return nil
		}
		f, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		for _, decl := range f.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			assignsReason := false
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				if as, ok := n.(*ast.AssignStmt); ok {
					for _, l := range as.Lhs {
						if sel, ok := l.(*ast.SelectorExpr); ok && sel.Sel.Name == "Reason" {
							assignsReason = true
						}
					}
				}
				return true
			})
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				lit, ok := n.(*ast.CompositeLit)
				if !ok {
					return true
				}
				sel, ok := lit.Type.(*ast.SelectorExpr)
				if !ok || sel.Sel.Name != "Event" {
					return true
				}
				if pkg, ok := sel.X.(*ast.Ident); !ok || pkg.Name != "history" {
					return true
				}
				checked++
				named := false
				for _, el := range lit.Elts {
					if kv, ok := el.(*ast.KeyValueExpr); ok {
						if k, ok := kv.Key.(*ast.Ident); ok && k.Name == "Reason" {
							named = true
						}
					}
				}
				if !named && !assignsReason {
					t.Errorf("%s: a history.Event with no Reason", fset.Position(lit.Pos()))
				}
				return true
			})
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if checked < 20 {
		t.Errorf("found only %d history.Event literals: the walk missed the source", checked)
	}
}
