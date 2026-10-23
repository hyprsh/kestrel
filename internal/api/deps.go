package api

import (
	"context"
	"database/sql"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/requests"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/scoring/trashsync"
	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
	"github.com/hyprsh/kestrel/internal/updates"
)

// Deps are the modules the API calls, as the interfaces it needs from them.
// Something outside this package (internal/app, in the binary and in tests)
// builds the modules and hands them over, so the API holds no wiring.
type Deps struct {
	Plugins     PluginInstances
	Profiles    Profiles
	RootFolders RootFolders
	Settings    SettingsTx
	Pause       GrabPause
	Updates     Updates
	Library     Library
	Acquire     Acquire
	Requests    Requests
	Adoption    Adoption
	Cleanup     Cleanup
	Remover     Remover
	Imports     Rescorer
	Files       TitleFiles
	Jobs        Jobs
	Refresher   Refresher
	Indexers    IndexerStatus
	Health      Health
	History     History
	Scoring     Scoring
	Trash       Trash
	Keys        ProviderKeys
	Meta        metadata.Provider
	TVDB        metadata.TVDBProvider
	Bridge      Bridge
	Posters     Posters
}

// PluginInstances is the plugin instance store.
type PluginInstances interface {
	Enabled(ctx context.Context, contract string) ([]instances.Instance, error)
	Resolve(ctx context.Context, pluginID string, instanceID int64, patch map[string]any, validate bool) (plugin.Plugin, plugin.Connection, error)
	List(ctx context.Context) ([]instances.Instance, error)
	Get(ctx context.Context, id int64) (instances.Instance, error)
	Update(ctx context.Context, id int64, patch instances.Patch) (instances.Instance, error)
	Registry() *plugin.Registry
	Public(i instances.Instance) (config map[string]any, secretsSet []string)
	Delete(ctx context.Context, id int64) error
	Create(ctx context.Context, in instances.New) (instances.Instance, error)
	RecordCheck(ctx context.Context, id int64, at time.Time, err error) error
}

// Profiles is the household's language settings and the Profiles.
type Profiles interface {
	Region(ctx context.Context) (profiles.Region, bool, error)
	List(ctx context.Context) ([]profiles.Profile, error)
	Patch(ctx context.Context, key string, p profiles.Patch) (profiles.Profile, error)
}

// RootFolders reads the Root folders.
type RootFolders interface {
	Get(ctx context.Context) (rootfolders.Folders, bool, error)
}

// SettingsTx opens the settings that PATCH /settings writes in one transaction.
type SettingsTx interface {
	InTx(tx *sql.Tx) SettingsWriter
}

// SettingsWriter writes settings through one transaction; the caller commits.
type SettingsWriter interface {
	SetRootFolders(ctx context.Context, p rootfolders.Patch) (rootfolders.Folders, error)
	SetRegion(ctx context.Context, p profiles.RegionPatch) (profiles.Region, error)
	SetTrashAutoUpdate(ctx context.Context, on bool) error
	SetGrabsPaused(ctx context.Context, on bool) error
}

// GrabPause reads the Pause Grabs switch.
type GrabPause interface {
	Paused(ctx context.Context) (bool, error)
	PausedSince(ctx context.Context) (time.Time, error)
}

// Updates is the GitHub update check.
type Updates interface {
	Enabled(ctx context.Context) bool
	Info(ctx context.Context) updates.Info
	SetEnabled(ctx context.Context, on bool) error
	Check(ctx context.Context) error
}

// Library is Titles, Versions, files and monitoring.
type Library interface {
	Get(ctx context.Context, id int64, view library.View) (library.Detail, error)
	InLibrary(ctx context.Context, kind library.Kind, tmdbIDs []int) (map[int]int64, error)
	GetVersion(ctx context.Context, id int64) (library.VersionRef, error)
	Episodes(ctx context.Context, titleID int64, view library.View) ([]library.Episode, error)
	SetSeriesMonitor(ctx context.Context, id int64, mode library.Monitor) error
	SetMovieMonitored(ctx context.Context, id int64, monitored bool) error
	SetMonitored(ctx context.Context, ids []int64, monitored bool, mode library.Monitor) ([]library.MonitorResult, error)
	SetSeasonMonitored(ctx context.Context, id int64, season int, monitored bool) error
	SetEpisodesMonitored(ctx context.Context, id int64, episodeIDs []int64, monitored bool) error
	SearchAllWanted(ctx context.Context) (int, error)
	SearchAfterPause(ctx context.Context, since time.Time) error
	SearchWanted(ctx context.Context, titleIDs []int64) (map[int64]int, error)
	RequestSearch(ctx context.Context, versionID int64) error
	LongMissing(ctx context.Context, view library.View) ([]library.LongMissingItem, error)
	Upcoming(ctx context.Context, view library.View, from, to time.Time) (library.Agenda, error)
	RecentImports(ctx context.Context, n int) ([]library.RecentImport, error)
	CountRecentImports(ctx context.Context, now time.Time) (int, error)
	List(ctx context.Context, view library.View, f library.Filter) ([]library.Row, error)
	AddVersion(ctx context.Context, titleID int64, v library.VersionSpec) (int64, error)
	AddSeries(ctx context.Context, a library.AddSeries) (int64, error)
	AddMovie(ctx context.Context, a library.AddMovie) (int64, error)
}

// Acquire is search, Grabs and the Blocklist.
type Acquire interface {
	Cancel(ctx context.Context, id int64, blocklist bool) (acquire.Grab, error)
	Active(ctx context.Context) ([]acquire.Active, error)
	Unblock(ctx context.Context, id int64) error
	Stalled(ctx context.Context) ([]acquire.StalledImport, error)
	SearchScope(ctx context.Context, versionID int64, scope library.Scope) (acquire.SearchResult, error)
	RetryStalled(ctx context.Context, reason string) (int, error)
	RetryImport(ctx context.Context, grabID int64) error
	LastFailures(ctx context.Context) (map[int64]string, error)
	GrabEpisodes(ctx context.Context, grabID int64) ([]int64, error)
	Grab(ctx context.Context, versionID int64, releaseID string, override bool) (acquire.Grab, error)
	GetGrab(ctx context.Context, id int64) (acquire.Grab, error)
	// Grabs lists Grabs newest first, for GET /grabs.
	Grabs(ctx context.Context, f acquire.GrabFilter) ([]acquire.Record, error)
	DiscardStalled(ctx context.Context, reason string) (int, error)
	Discard(ctx context.Context, grabID int64) error
	Blocklist(ctx context.Context, titleID int64) ([]acquire.Blocked, error)
	// StartSearch is Search now: it checks the scope, then searches in the background.
	StartSearch(ctx context.Context, versionID int64, scope library.Scope) error
	// BlockGrab puts a Grab's Release on the Blocklist (a deleted file's).
	BlockGrab(ctx context.Context, grabID int64, reason string) error
	// Original Offers: every one, a Title's by Version, and the two actions on one.
	Offers(ctx context.Context) ([]acquire.Offer, error)
	OffersOfTitle(ctx context.Context, titleID int64) (map[int64]acquire.Offer, error)
	AcceptOffer(ctx context.Context, versionID int64) (acquire.Accepted, error)
	DismissOffer(ctx context.Context, versionID int64) error
}

// Requests is Request records and their semantics.
type Requests interface {
	Submit(ctx context.Context, in requests.Input) (requests.Result, error)
	OriginsOf(ctx context.Context, titleID int64) ([]requests.Origin, error)
	List(ctx context.Context, f requests.Filter) ([]requests.Request, error)
	Count(ctx context.Context, f requests.Filter) (int, error)
	Get(ctx context.Context, id int64) (requests.Request, error)
}

// Adoption takes over an existing on-disk library.
type Adoption interface {
	Get(ctx context.Context) (imports.Plan, error)
	// Progress is the plan's state without its rows, for the stream's every tick.
	Progress(ctx context.Context) (imports.Progress, error)
	Scan(ctx context.Context, roots []string) error
	Rows(ctx context.Context, f imports.Filter) ([]imports.Row, error)
	PatchRow(ctx context.Context, id int64, p imports.RowPatch) (imports.Row, error)
	Discard(ctx context.Context) error
	Commit(ctx context.Context, revision int64) error
}

// Cleanup deletes Unmanaged files.
type Cleanup interface {
	Run(ctx context.Context, previewID string, cats []imports.CleanupCategory, exclude []string) (imports.CleanupResult, error)
	Preview(ctx context.Context, titleIDs []int64) (imports.CleanupPreview, error)
}

// Remover deletes Versions and Titles.
type Remover interface {
	DeleteVersion(ctx context.Context, versionID int64, deleteFiles bool) error
	DeleteTitle(ctx context.Context, titleID int64, deleteFiles bool) error
}

// Rescorer moves a Version to another Profile and re-scores its stored file.
type Rescorer interface {
	SwitchProfile(ctx context.Context, titleID, versionID int64, profile string) error
}

// TitleFiles moves a Title's files to another Root folder and deletes a
// Version's files, recording both in the Log.
type TitleFiles interface {
	Move(ctx context.Context, titleID int64, root string) (imports.Moved, error)
	DeleteFiles(ctx context.Context, versionID int64, scope library.Scope, blocklist bool) (imports.Deleted, error)
}

// Jobs is the loop runner.
type Jobs interface {
	Kick(name string)
	Running() []jobs.Run
	// Search is the search pipeline, as the Search loop keeps it.
	Search() jobs.SearchStatus
	// Jobs lists the loops with their last pass and next due time.
	Jobs() []jobs.Job
}

// Refresher refreshes a Title from the metadata providers in the background.
type Refresher interface {
	Enqueue(id int64)
	SetFrozen(ctx context.Context, id int64, frozen bool) error
}

// IndexerStatus reports an indexer's budget.
type IndexerStatus interface {
	Status(indexerID int64, configured int) indexers.Status
}

// Health is Needs attention and the system status.
type Health interface {
	List(ctx context.Context) ([]health.Row, error)
	IndexerStates() map[int64]health.State
	Dismiss(ctx context.Context, id int64) error
	Disks(ctx context.Context) ([]health.Disk, error)
	ClientState() health.State
	AddCheck(name string, c health.Check)
}

// History is the events log.
type History interface {
	Record(ctx context.Context, ev history.Event)
	List(ctx context.Context, f history.Filter) ([]history.Event, error)
	Last(ctx context.Context) (int64, error)
	After(ctx context.Context, id int64, limit int) ([]history.Event, error)
}

// Scoring is the live TRaSH snapshot.
type Scoring interface {
	Current() *scoring.Snapshot
}

// Trash is the TRaSH update service.
type Trash interface {
	Update(ctx context.Context) (trashsync.Result, error)
	Status(ctx context.Context) trashsync.Status
	ChangeLanguage(ctx context.Context, change func() error) error
	AutoUpdate(ctx context.Context) (bool, error)
}

// ProviderKeys is the UI's metadata provider key overrides.
type ProviderKeys interface {
	OverridesSet(ctx context.Context) (metadata.OverridesSet, error)
	SetOverrides(ctx context.Context, tmdb, tvdb *string) error
}

// Bridge maps TMDB series to TheTVDB ones.
type Bridge interface {
	Lookup(ctx context.Context, tmdbIDs []int) (map[int]metadata.Bridged, error)
}

// Posters is the poster cache.
type Posters interface {
	Ensure(ctx context.Context, kind metadata.Kind, tmdbID int, posterPath string) (string, error)
}
