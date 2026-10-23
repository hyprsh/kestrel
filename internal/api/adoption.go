package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/library"
)

func (s *server) adoptionLocation() *string {
	loc := s.opts.BaseURL + apiRoot + "/adoption"
	return &loc
}

func adoptionToAPI(p imports.Plan) oapi.Adoption {
	out := oapi.Adoption{State: oapi.AdoptionState(p.State), Revision: p.Revision, ScannedAt: p.ScannedAt, Error: strPtr(p.Error)}
	out.Progress.Done, out.Progress.Total = p.Done, p.Total
	out.Summary = summaryToAPI(p.Summary)
	if p.Result != nil {
		out.Result = &struct {
			Adopted  int     `json:"adopted"`
			Failed   int     `json:"failed"`
			TitleIds []int64 `json:"title_ids"`
		}{p.Result.Adopted, p.Result.Failed, p.Result.TitleIDs}
	}
	return out
}

// adoptionActivity is the Adoption scan or commit running now, for the
// stream's `activity` frame; nil when neither runs or the plan cannot be read.
func (s *server) adoptionActivity(ctx context.Context) *oapi.AdoptionActivity {
	p, err := s.adoption.Progress(ctx)
	if err != nil || (p.State != imports.PlanScanning && p.State != imports.PlanCommitting) {
		return nil
	}
	return &oapi.AdoptionActivity{State: oapi.AdoptionActivityState(p.State), Done: p.Done, Total: p.Total}
}

func adoptionRowToAPI(r imports.Row) oapi.AdoptionRow {
	out := oapi.AdoptionRow{
		Id: r.ID, Kind: oapi.Movie, Status: oapi.AdoptionRowStatus(r.Status), Entry: r.Entry, Ticked: r.Ticked,
		Candidates: []oapi.AdoptionCandidate{}, Files: []oapi.AdoptionFile{},
	}
	if r.Kind == library.Series {
		out.Kind = oapi.Series
	}
	if r.SkipReason != "" {
		reason := oapi.AdoptionRowSkipReason(r.SkipReason)
		out.SkipReason = &reason
	}
	if m := r.Match; m != nil {
		out.Match = &oapi.AdoptionMatch{
			TmdbId: m.TMDBID, Title: m.Title, Year: intPtr(m.Year), Source: oapi.AdoptionMatchSource(m.Source), Folder: m.Folder,
		}
		if m.TVDBID != 0 {
			out.Match.TvdbId = intPtr(m.TVDBID)
		}
		if m.TitleID != 0 {
			id := m.TitleID
			out.Match.TitleId = &id
		}
	}
	for _, c := range r.Candidates {
		out.Candidates = append(out.Candidates, oapi.AdoptionCandidate{TmdbId: c.TMDBID, Title: c.Title, Year: intPtr(c.Year), Suggested: c.Suggested, Confident: c.Confident})
	}
	for _, f := range r.Files {
		af := oapi.AdoptionFile{
			Path: f.Path, To: f.To, Size: f.Size, Slot: slotToAPI(f.Slot), Profile: f.Profile, Score: f.Score,
			Action: oapi.AdoptionFileAction(f.Action), HeldScore: f.HeldScore, Ticked: f.Ticked, Subtitles: []oapi.AdoptionSubtitle{},
		}
		af.Episodes = make([]struct {
			Number int `json:"number"`
			Season int `json:"season"`
		}, len(f.Episodes))
		for i, ep := range f.Episodes {
			af.Episodes[i].Season, af.Episodes[i].Number = ep.Season, ep.Number
		}
		if f.Left != "" {
			left := oapi.AdoptionFileLeft(f.Left)
			af.Left = &left
		}
		for _, sub := range f.Subtitles {
			af.Subtitles = append(af.Subtitles, oapi.AdoptionSubtitle{From: sub.From, To: sub.To})
		}
		out.Files = append(out.Files, af)
	}
	return out
}

func adoptionProblem(err error) error {
	switch {
	case errors.Is(err, imports.ErrBusy):
		return problem(http.StatusConflict, "conflict", "An Adoption scan or commit is already running")
	case errors.Is(err, imports.ErrStale):
		return problem(http.StatusConflict, "conflict", "The Adoption plan changed since you reviewed it; review it again")
	case errors.Is(err, imports.ErrNoRow):
		return problem(http.StatusNotFound, "not_found", "no such Adoption row")
	case errors.Is(err, imports.ErrNoRoot):
		return invalid("root_folders", "invalid", err.Error())
	case errors.Is(err, imports.ErrNotSettleable):
		return invalid("tmdb_id", "invalid", "The row's files cannot be matched to that Title")
	}
	return metaProblem(err)
}

func (s *server) GetAdoption(ctx context.Context, _ oapi.GetAdoptionRequestObject) (oapi.GetAdoptionResponseObject, error) {
	p, err := s.adoption.Get(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.GetAdoption200JSONResponse(adoptionToAPI(p)), nil
}

func (s *server) DiscardAdoption(ctx context.Context, _ oapi.DiscardAdoptionRequestObject) (oapi.DiscardAdoptionResponseObject, error) {
	if err := s.adoption.Discard(ctx); err != nil {
		return nil, adoptionProblem(err)
	}
	return oapi.DiscardAdoption204Response{}, nil
}

func (s *server) ScanAdoption(ctx context.Context, r oapi.ScanAdoptionRequestObject) (oapi.ScanAdoptionResponseObject, error) {
	var roots []string
	if r.Body != nil && r.Body.RootFolders != nil {
		roots = *r.Body.RootFolders
	}
	if err := s.adoption.Scan(ctx, roots); err != nil {
		return nil, adoptionProblem(err)
	}
	p, err := s.adoption.Get(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.ScanAdoption202JSONResponse{Body: adoptionToAPI(p), Headers: oapi.ScanAdoption202ResponseHeaders{Location: s.adoptionLocation()}}, nil
}

// summaryToAPI is the counts of a plan's rows, as the list and the plan carry them.
func summaryToAPI(m imports.Summary) oapi.AdoptionSummary {
	return oapi.AdoptionSummary{
		Matched: m.Matched, NeedsChoice: m.NeedsChoice, Skipped: m.Skipped, Duplicate: m.Duplicate, Replacement: m.Replacement,
		Adopting: m.Adopting,
	}
}

func (s *server) ListAdoptionRows(ctx context.Context, r oapi.ListAdoptionRowsRequestObject) (oapi.ListAdoptionRowsResponseObject, error) {
	var f imports.Filter
	if r.Params.Filter != nil {
		f = imports.Filter(*r.Params.Filter)
	}
	limit := 100
	if r.Params.Limit != nil {
		limit = *r.Params.Limit
	}
	if limit < 1 || limit > 10000 {
		return nil, invalid("limit", "invalid", "limit is between 1 and 10000")
	}
	at, err := readCursor(r.Params.Cursor, 0)
	if err != nil {
		return nil, err
	}
	page, err := s.adoption.Rows(ctx, f, int(at), limit)
	if err != nil {
		return nil, err
	}
	out := oapi.AdoptionRowList{Items: make([]oapi.AdoptionRow, len(page.Rows)), Total: page.Total, Counts: summaryToAPI(page.Summary)}
	for i, row := range page.Rows {
		out.Items[i] = adoptionRowToAPI(row)
	}
	if end := int(at) + len(page.Rows); end < page.Total {
		out.NextCursor = cursorOf(int64(end))
	}
	return oapi.ListAdoptionRows200JSONResponse(out), nil
}

// BulkAdoptionRows is POST /adoption/rows/bulk: one action over many rows,
// answered per row.
func (s *server) BulkAdoptionRows(ctx context.Context, r oapi.BulkAdoptionRowsRequestObject) (oapi.BulkAdoptionRowsResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	req := imports.BulkRequest{Action: imports.BulkAction(r.Body.Action)}
	switch r.Body.Action {
	case oapi.Tick, oapi.Untick, oapi.AcceptSuggested:
	default:
		return nil, invalid("action", "invalid", "action is tick, untick or accept_suggested")
	}
	hasIDs := r.Body.RowIds != nil && len(*r.Body.RowIds) > 0
	switch {
	case hasIDs && r.Body.Filter != nil:
		return nil, invalid("filter", "invalid", "Name row_ids or a filter, not both")
	case hasIDs:
		req.RowIDs = *r.Body.RowIds
	case r.Body.Filter != nil:
		switch *r.Body.Filter {
		case oapi.AdoptionRowFilterAll, oapi.AdoptionRowFilterNeedsChoice, oapi.AdoptionRowFilterMatched, oapi.AdoptionRowFilterDuplicate, oapi.AdoptionRowFilterReplacement, oapi.AdoptionRowFilterSkipped:
		default:
			return nil, invalid("filter", "invalid", "Unknown filter")
		}
		if *r.Body.Filter != oapi.AdoptionRowFilterAll {
			req.Filter = imports.Filter(*r.Body.Filter)
		}
	case r.Body.RowIds != nil:
		return nil, invalid("row_ids", "required", "Pick at least one row")
	default:
		return nil, invalid("row_ids", "required", "Name the rows with row_ids or a filter")
	}
	res, err := s.adoption.Bulk(ctx, req)
	if err != nil {
		return nil, adoptionProblem(err)
	}
	out := oapi.AdoptionRowsBulkResult{Revision: res.Revision, Items: make([]oapi.AdoptionRowOutcome, len(res.Items))}
	for i, it := range res.Items {
		o := oapi.AdoptionRowOutcome{RowId: it.RowID, Outcome: oapi.AdoptionRowOutcomeOutcome(it.Outcome)}
		if it.Reason != "" {
			reason := oapi.AdoptionRowOutcomeReason(it.Reason)
			o.Reason = &reason
		}
		if it.Message != "" {
			o.Message = &it.Message
		}
		if it.Outcome == imports.OutcomeChanged {
			status := oapi.AdoptionRowOutcomeStatus(it.Status)
			o.Status = &status
			if it.SkipReason != "" {
				reason := oapi.AdoptionRowOutcomeSkipReason(it.SkipReason)
				o.SkipReason = &reason
			}
		}
		out.Items[i] = o
	}
	return oapi.BulkAdoptionRows200JSONResponse(out), nil
}

func (s *server) PatchAdoptionRow(ctx context.Context, r oapi.PatchAdoptionRowRequestObject) (oapi.PatchAdoptionRowResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	p := imports.RowPatch{Ticked: r.Body.Ticked, TMDBID: r.Body.TmdbId}
	if r.Body.Files != nil {
		for _, f := range *r.Body.Files {
			p.Files = append(p.Files, imports.FileTick{Path: f.Path, Ticked: f.Ticked})
		}
	}
	row, err := s.adoption.PatchRow(ctx, r.Id, p)
	if err != nil {
		return nil, adoptionProblem(err)
	}
	return oapi.PatchAdoptionRow200JSONResponse(adoptionRowToAPI(row)), nil
}

func (s *server) CommitAdoption(ctx context.Context, r oapi.CommitAdoptionRequestObject) (oapi.CommitAdoptionResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("revision", "required", "Name the revision of the plan you reviewed")
	}
	if err := s.adoption.Commit(ctx, r.Body.Revision); err != nil {
		return nil, adoptionProblem(err)
	}
	p, err := s.adoption.Get(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.CommitAdoption202JSONResponse{Body: adoptionToAPI(p), Headers: oapi.CommitAdoption202ResponseHeaders{Location: s.adoptionLocation()}}, nil
}
