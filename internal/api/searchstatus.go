package api

import (
	"context"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/jobs"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
)

// indexerBudget is an indexer instance with its budget and pauses.
type indexerBudget struct {
	inst   instances.Instance
	status indexers.Status
}

// indexerBudgets lists every indexer instance, enabled or not, with its budget
// and pauses, for the health strip and the search status.
func (s *server) indexerBudgets(ctx context.Context) ([]indexerBudget, error) {
	all, err := s.plugins.List(ctx)
	if err != nil {
		return nil, err
	}
	var out []indexerBudget
	for _, inst := range all {
		if inst.Contract != indexer.Contract.ID {
			continue
		}
		out = append(out, indexerBudget{inst, s.indexers.Status(inst.ID, inst.Connection().Int("api_requests_per_day"))})
	}
	return out, nil
}

// GetSearchStatus is the search pipeline: what the Search loop keeps, plus
// each enabled indexer's budget and what holds the sweeps back from it.
func (s *server) GetSearchStatus(ctx context.Context, _ oapi.GetSearchStatusRequestObject) (oapi.GetSearchStatusResponseObject, error) {
	st, err := s.searchStatus(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.GetSearchStatus200JSONResponse(st), nil
}

func (s *server) searchStatus(ctx context.Context) (oapi.SearchStatus, error) {
	js := s.jobs.Search()
	out := oapi.SearchStatus{UpgradesPerPass: jobs.UpgradesPerPass, Indexers: []oapi.SearchIndexer{}}
	out.Due.Versions, out.Due.Episodes, out.Due.Upgrades = js.Due.Versions, js.Due.Episodes, js.Due.Upgrades
	if p := js.Pass; p != nil {
		out.Pass = &oapi.SearchPass{StartedAt: p.StartedAt, Done: p.Done, Total: p.Total}
	}
	if l := js.Last; l != nil {
		out.LastPass = &oapi.SearchPassResult{FinishedAt: l.FinishedAt, Searched: l.Searched, Grabbed: l.Grabbed}
	}
	if !js.Next.IsZero() {
		out.NextPassAt = &js.Next
	}

	budgets, err := s.indexerBudgets(ctx)
	if err != nil {
		return oapi.SearchStatus{}, err
	}
	for _, ib := range budgets {
		if !ib.inst.Enabled {
			continue
		}
		b := ib.status
		row := oapi.SearchIndexer{InstanceId: ib.inst.ID, Name: ib.inst.Name, SearchUsed: b.SearchUsed}
		if b.SearchMax > 0 {
			row.SearchMax = &b.SearchMax
		}
		// The worst first: a pause outlasts a backoff, and both outlast the 80 % stop's day.
		held := func(h string) { v := oapi.SearchIndexerHeld(h); row.Held = &v }
		switch {
		case !b.SearchPausedUntil.IsZero():
			held("request_limit")
			row.HeldUntil = &b.SearchPausedUntil
		case !b.BackoffUntil.IsZero():
			held("backing_off")
			row.HeldUntil = &b.BackoffUntil
		case b.SweepsStopped:
			held("budget")
		}
		out.Indexers = append(out.Indexers, row)
	}
	return out, nil
}
