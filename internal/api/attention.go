package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/jobs"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
)

// healthRowPrefix starts the id of every row that comes from the health module.
// Rows joined in from other modules (Stalled Imports, Title gone upstream) take
// their own prefix, and DismissAttention routes by it.
const healthRowPrefix = "health-"

// attentionActions builds a kind of row's actions. To give a new health kind
// actions, add it here; a kind without an entry shows its message only (plus
// Dismiss when the row is dismissible, which needs no entry). Actions are drawn
// generically by the SPA: a GET opens an SPA path, anything else calls the API.
var attentionActions = map[health.Kind]func(health.Row) []oapi.AttentionAction{
	health.KindDownloadClient: func(r health.Row) []oapi.AttentionAction {
		return []oapi.AttentionAction{testInstance(r), openSettings("download-client", "Open in Settings"), healthLog}
	},
	health.KindNoIndexer: func(health.Row) []oapi.AttentionAction {
		return []oapi.AttentionAction{openSettings("indexers", "Open Indexers")}
	},
	health.KindRootFolder: func(health.Row) []oapi.AttentionAction {
		return []oapi.AttentionAction{openSettings("root-folders", "Open Root folders"), healthLog}
	},
	health.KindMetadata: func(health.Row) []oapi.AttentionAction {
		return []oapi.AttentionAction{openSettings("metadata", "Open provider keys"), healthLog}
	},
	health.KindIndexer: func(r health.Row) []oapi.AttentionAction {
		return []oapi.AttentionAction{
			testInstance(r),
			openSettings("indexers", "Open in Settings"),
			{
				Key: "disable", Label: "Disable", Method: oapi.PATCH,
				Path: fmt.Sprintf("/plugin-instances/%d", r.Subject.PluginInstanceID), Body: &map[string]any{"enabled": false},
			},
			healthLog,
		}
	},
	health.KindGoneUpstream: func(r health.Row) []oapi.AttentionAction {
		path := fmt.Sprintf("/titles/%d", r.Subject.TitleID)
		return []oapi.AttentionAction{
			{Key: "remove", Label: "Remove", Method: oapi.DELETE, Path: path, Confirm: &removeConfirm},
			{Key: "keep", Label: "Keep as is", Method: oapi.PATCH, Path: path, Body: &map[string]any{"metadata_frozen": true}},
		}
	},
	health.KindSecurityFix: func(health.Row) []oapi.AttentionAction {
		return []oapi.AttentionAction{{Key: "open", Label: "Open About", Method: oapi.GET, Path: "/about"}}
	},
	health.KindRefreshFailed: func(r health.Row) []oapi.AttentionAction {
		return []oapi.AttentionAction{testInstance(r), openSettings("media-servers", "Open Media servers"), healthLog}
	},
	health.KindMediaServer: func(r health.Row) []oapi.AttentionAction {
		return []oapi.AttentionAction{testInstance(r), openSettings("media-servers", "Open Media servers"), healthLog}
	},
	health.KindPlexNoSection: func(health.Row) []oapi.AttentionAction {
		return []oapi.AttentionAction{openSettings("media-servers", "Open Media servers")}
	},
	health.KindTrashRejected: func(health.Row) []oapi.AttentionAction {
		return []oapi.AttentionAction{{Key: "update_trash", Label: "Update from TRaSH", Method: oapi.POST, Path: "/trash/update"}}
	},
	health.KindProxyHeader: func(health.Row) []oapi.AttentionAction {
		return []oapi.AttentionAction{openSettings("security", "Open Security")}
	},
}

var removeConfirm = "Remove this Title from the Library? Files stay on disk."

// showInLog opens the Log filtered by q, for a row whose history is there.
func showInLog(q string) oapi.AttentionAction {
	return oapi.AttentionAction{Key: "log", Label: "Show in the Log", Method: oapi.GET, Path: "/log?q=" + q}
}

// healthLog is the history of the health rows that come and go: each time one was raised and cleared.
var healthLog = showInLog("kind:health_raised,health_cleared")

func openSettings(section, label string) oapi.AttentionAction {
	return oapi.AttentionAction{Key: "open", Label: label, Method: oapi.GET, Path: "/settings/" + section}
}

func testInstance(r health.Row) oapi.AttentionAction {
	return oapi.AttentionAction{
		Key: "test", Label: "Test", Method: oapi.POST,
		Path: fmt.Sprintf("/plugin-instances/%d/test", r.Subject.PluginInstanceID),
	}
}

// instanceLock is how much of a plugin instance the Config File holds.
type instanceLock struct {
	// declared: the file declares the instance, so the API refuses changes to it.
	declared bool
	// enabled: the file sets its enabled too. Without it, a change to enabled
	// alone still goes through.
	enabled bool
}

// refuses reports whether the API refuses action a on the locked instance id.
func (l instanceLock) refuses(a oapi.AttentionAction, id int64) bool {
	return l.declared && changesInstance(a, id) && (l.enabled || !onlyEnabled(a))
}

// attentionRowOf builds a health row. lock is what the Config File holds of
// the row's plugin instance: an action the API would refuse is left out.
func attentionRowOf(r health.Row, lock instanceLock) oapi.AttentionRow {
	id := healthRowPrefix + strconv.FormatInt(r.ID, 10)
	actions := []oapi.AttentionAction{}
	if build := attentionActions[r.Kind]; build != nil {
		for _, a := range build(r) {
			if !lock.refuses(a, r.Subject.PluginInstanceID) {
				actions = append(actions, a)
			}
		}
	}
	if r.Dismissible {
		actions = append(actions, oapi.AttentionAction{
			Key: "dismiss", Label: "Dismiss", Method: oapi.POST, Path: "/attention/" + id + "/dismiss",
		})
	}
	return oapi.AttentionRow{
		Id: id, Severity: oapi.AttentionRowSeverity(r.Severity), Kind: string(r.Kind), Message: r.Message,
		Since: r.FirstAt, Count: r.Count, Actions: actions,
		Subject: oapi.AttentionSubject{
			TitleId: idPtr(r.Subject.TitleID), VersionId: idPtr(r.Subject.VersionID),
			GrabId: idPtr(r.Subject.GrabID), PluginInstanceId: idPtr(r.Subject.PluginInstanceID),
		},
	}
}

// changesInstance reports whether a writes to the plugin instance id.
func changesInstance(a oapi.AttentionAction, id int64) bool {
	return (a.Method == oapi.PATCH || a.Method == oapi.DELETE) && a.Path == fmt.Sprintf("/plugin-instances/%d", id)
}

// onlyEnabled reports whether a is a PATCH of enabled and nothing else.
func onlyEnabled(a oapi.AttentionAction) bool {
	if a.Method != oapi.PATCH || a.Body == nil || len(*a.Body) != 1 {
		return false
	}
	_, ok := (*a.Body)["enabled"]
	return ok
}

func idPtr(n int64) *int64 {
	if n == 0 {
		return nil
	}
	return &n
}

// attentionRows is the Needs attention list: Blocking first, then Warnings, each
// newest first.
func (s *server) attentionRows(ctx context.Context) ([]oapi.AttentionRow, error) {
	rows, err := s.health.List(ctx)
	if err != nil {
		return nil, err
	}
	slices.SortStableFunc(rows, func(a, b health.Row) int {
		if (a.Severity == health.Blocking) != (b.Severity == health.Blocking) {
			if a.Severity == health.Blocking {
				return -1
			}
			return 1
		}
		if c := b.FirstAt.Compare(a.FirstAt); c != 0 {
			return c
		}
		return int(b.ID - a.ID)
	})
	locks, err := s.instanceLocks(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]oapi.AttentionRow, len(rows))
	for i, r := range rows {
		out[i] = attentionRowOf(r, locks[r.Subject.PluginInstanceID])
	}
	stalled, err := s.stalledRows(ctx)
	if err != nil {
		return nil, err
	}
	out = append(out, stalled...)
	// Blocking before Warning, newest first; rows of one kind keep their order.
	slices.SortStableFunc(out, func(a, b oapi.AttentionRow) int {
		if (a.Severity == oapi.AttentionRowSeverity(health.Blocking)) != (b.Severity == oapi.AttentionRowSeverity(health.Blocking)) {
			if a.Severity == oapi.AttentionRowSeverity(health.Blocking) {
				return -1
			}
			return 1
		}
		return b.Since.Compare(a.Since)
	})
	return out, nil
}

// instanceLocks holds what the Config File holds of each plugin instance, by id.
func (s *server) instanceLocks(ctx context.Context) (map[int64]instanceLock, error) {
	out := map[int64]instanceLock{}
	if !s.declares(configfile.SectionPluginInstances) {
		return out, nil
	}
	all, err := s.plugins.List(ctx)
	if err != nil {
		return nil, err
	}
	for _, i := range all {
		out[i.ID] = instanceLock{declared: s.instanceDeclared(i), enabled: s.enabledDeclared(i)}
	}
	return out, nil
}

// attention is the count and worst severity the rail badge and the stream show.
func (s *server) attention(ctx context.Context) (count int, severity *string, err error) {
	rows, err := s.attentionRows(ctx)
	if err != nil {
		return 0, nil, err
	}
	if len(rows) > 0 {
		sev := string(rows[0].Severity) // Blocking sorts first
		severity = &sev
	}
	return len(rows), severity, nil
}

func (s *server) GetAttention(ctx context.Context, _ oapi.GetAttentionRequestObject) (oapi.GetAttentionResponseObject, error) {
	rows, err := s.attentionRows(ctx)
	if err != nil {
		return nil, err
	}
	out := oapi.Attention{Count: len(rows), Rows: rows}
	if len(rows) > 0 {
		sev := oapi.AttentionSeverity(rows[0].Severity)
		out.Severity = &sev
	}
	lm, err := s.longMissing(ctx)
	if err != nil {
		return nil, err
	}
	out.LongMissing = lm
	if out.Originals, err = s.originals(ctx); err != nil {
		return nil, err
	}
	return oapi.GetAttention200JSONResponse(out), nil
}

func (s *server) DismissAttention(ctx context.Context, r oapi.DismissAttentionRequestObject) (oapi.DismissAttentionResponseObject, error) {
	raw, ok := strings.CutPrefix(r.Id, healthRowPrefix)
	id, err := strconv.ParseInt(raw, 10, 64)
	if !ok || err != nil {
		return nil, problem(http.StatusNotFound, "not_found", "no such Needs attention row")
	}
	switch err := s.health.Dismiss(ctx, id); {
	case errors.Is(err, health.ErrNotFound):
		return nil, problem(http.StatusNotFound, "not_found", "no such Needs attention row")
	case errors.Is(err, health.ErrNotDismissible):
		return nil, problem(http.StatusConflict, "conflict", "this row clears itself once the problem is fixed")
	case err != nil:
		return nil, err
	}
	return oapi.DismissAttention204Response{}, nil
}

// GetSystemStatus is the `status` read model behind the health strip.
func (s *server) GetSystemStatus(ctx context.Context, _ oapi.GetSystemStatusRequestObject) (oapi.GetSystemStatusResponseObject, error) {
	out := oapi.SystemStatus{Indexers: []oapi.IndexerStatus{}, Disks: []oapi.DiskStatus{}, DownloadClient: oapi.ClientStatus{State: oapi.ClientStatusState("none")}}

	paused, err := s.pause.Paused(ctx)
	if err != nil {
		return nil, err
	}
	out.GrabsPaused = paused
	if u := s.updates.Info(ctx); u.UpdateAvailable {
		out.Update = &oapi.UpdateAvailable{Version: u.Latest, Url: u.URL}
	}

	clients, err := s.plugins.Enabled(ctx, downloadclient.Contract.ID)
	if err != nil {
		return nil, err
	}
	if len(clients) > 0 {
		c := clients[0]
		out.DownloadClient = oapi.ClientStatus{State: oapi.ClientStatusState("ok"), Name: &c.Name, InstanceId: &c.ID}
		if st := s.health.ClientState(); st.Failing {
			out.DownloadClient.State = oapi.ClientStatusState("failing")
			out.DownloadClient.Message = &st.Message
		}
	}

	budgets, err := s.indexerBudgets(ctx)
	if err != nil {
		return nil, err
	}
	states := s.health.IndexerStates()
	for _, ib := range budgets {
		inst, b := ib.inst, ib.status
		row := oapi.IndexerStatus{InstanceId: inst.ID, Name: inst.Name, State: oapi.IndexerStatusState("ok")}
		row.SearchUsed, row.GrabsPaused = b.SearchUsed, b.GrabsPaused
		if b.SearchMax > 0 {
			row.SearchMax = &b.SearchMax
		}
		if b.GrabMax > 0 {
			row.GrabUsed, row.GrabMax = &b.GrabUsed, &b.GrabMax
		}
		if !b.SearchPausedUntil.IsZero() {
			row.SearchPausedUntil = &b.SearchPausedUntil
		}
		if !b.GrabsPausedUntil.IsZero() {
			row.GrabsPausedUntil = &b.GrabsPausedUntil
		}
		switch st := states[inst.ID]; {
		case !inst.Enabled:
			row.State = oapi.IndexerStatusState("disabled")
		case st.Failing:
			row.State = oapi.IndexerStatusState("failing")
			msg := st.Message
			row.Message = &msg
		}
		out.Indexers = append(out.Indexers, row)
	}

	disks, err := s.health.Disks(ctx)
	if err != nil {
		return nil, err
	}
	for _, d := range disks {
		out.Disks = append(out.Disks, oapi.DiskStatus{Path: d.Path, FreeBytes: int64(d.Free), TotalBytes: int64(d.Total), LowFreeBytes: int64(d.Low)})
	}
	ts := s.trash.Status(ctx)
	out.Trash.Commit, out.Trash.AutoUpdate = ts.Commit, ts.AutoUpdate
	if !ts.CommittedAt.IsZero() {
		out.Trash.CommittedAt = &ts.CommittedAt
	}
	if !ts.CheckedAt.IsZero() {
		out.Trash.CheckedAt = &ts.CheckedAt
	}
	return oapi.GetSystemStatus200JSONResponse(out), nil
}

// longMissingShown is how many Long Missing Versions the grouped row lists.
const longMissingShown = 5

// longMissing is the grouped Long Missing row: how many Versions are Long
// Missing and the five most recently Wanted. It is joined in from the library
// (not copied into health) and sits outside the rail badge.
func (s *server) longMissing(ctx context.Context) (oapi.LongMissing, error) {
	out := oapi.LongMissing{Items: []struct {
		LastFailure *string   `json:"last_failure"`
		Profile     string    `json:"profile"`
		Slot        oapi.Slot `json:"slot"`
		Title       string    `json:"title"`
		TitleId     int64     `json:"title_id"`
		VersionId   int64     `json:"version_id"`
		WantedSince time.Time `json:"wanted_since"`
	}{}}
	view, err := s.view(ctx)
	if err != nil {
		return out, err
	}
	all, err := s.library.LongMissing(ctx, view)
	if err != nil {
		return out, err
	}
	failures, err := s.acquire.LastFailures(ctx)
	if err != nil {
		return out, err
	}
	out.Count = len(all)
	for _, it := range all[:min(longMissingShown, len(all))] {
		item := struct {
			LastFailure *string   `json:"last_failure"`
			Profile     string    `json:"profile"`
			Slot        oapi.Slot `json:"slot"`
			Title       string    `json:"title"`
			TitleId     int64     `json:"title_id"`
			VersionId   int64     `json:"version_id"`
			WantedSince time.Time `json:"wanted_since"`
		}{Profile: it.Profile, Slot: slotToAPI(it.Slot), Title: it.Title, TitleId: it.TitleID, VersionId: it.VersionID, WantedSince: it.WantedSince}
		if f, ok := failures[it.VersionID]; ok {
			item.LastFailure = &f
		}
		out.Items = append(out.Items, item)
	}
	return out, nil
}

// SearchAllWanted is "Search all Wanted": every Wanted Version becomes due now
// and the sweep is woken.
func (s *server) SearchAllWanted(ctx context.Context, _ oapi.SearchAllWantedRequestObject) (oapi.SearchAllWantedResponseObject, error) {
	n, err := s.library.SearchAllWanted(ctx)
	if err != nil {
		return nil, err
	}
	s.jobs.Kick(jobs.Search)
	return oapi.SearchAllWanted202JSONResponse(oapi.WantedSearch{Versions: n}), nil
}

// UpdateTrash is "Update from TRaSH": it asks the trash loop for a pass and
// answers at once. How the pass goes is its job's outcome (GET /jobs).
func (s *server) UpdateTrash(_ context.Context, _ oapi.UpdateTrashRequestObject) (oapi.UpdateTrashResponseObject, error) {
	s.trash.RequestUpdate()
	return oapi.UpdateTrash202Response{}, nil
}
