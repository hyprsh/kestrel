// Package watchlist is Watchlist sync (ADR 0019): it reads the Plex Watchlists
// of the owner and of the friends who may request, with the owner's token, and
// makes a Request for each title added since Kestrel first read that account's
// Watchlist. It owns the watchlist_accounts and watchlist_entries tables.
//
// The pass is idempotent (ADR 0007): an entry is recorded only with the Request
// it became, and the Request carries a source id derived from the account and
// the Plex guid, so a pass that dies between the two makes the same Request
// again, which the Request module answers with the stored one.
package watchlist

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/plextv"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/watchlist/db"
)

// Source is the source of a Watchlist Request.
const Source = "plex_watchlist"

// Person is the Plex account a Watchlist belongs to.
type Person struct {
	// ID is the Plex account id, the Requester's id everywhere else.
	ID string
	// Name is the Plex username, else the account's title.
	Name  string
	Title string
	UUID  string
}

// Entry is a title newly on a Watchlist, resolved as far as Plex's metadata goes.
type Entry struct {
	Guid  string
	Kind  plextv.EntryKind // Movie or Series
	Title string
	Ids   plextv.Ids
}

// SourceRequestID is the id the Watchlist Request of p for e carries.
func SourceRequestID(p Person, e Entry) string { return p.ID + "-" + e.Guid }

// Config is what a pass needs of the settings and the Plex instance.
type Config struct {
	ClientID   string
	PlexURL    string
	OwnerToken string
	// Users, when not empty, are the only Plex users who may request.
	Users []string
}

// Host is the rest of Kestrel, as the pass needs it.
type Host interface {
	// Config is the pass's configuration; ok is false while Watchlist sync is
	// off or there is no Plex instance to read with.
	Config(ctx context.Context) (cfg Config, ok bool, err error)
	// Request makes the Watchlist Request of p for e, the same way a Requester's
	// Request from the UI is made, and returns its id.
	Request(ctx context.Context, p Person, e Entry) (requestID int64, err error)
}

// TV is plex.tv, as far as Watchlist sync needs it.
type TV interface {
	Account(ctx context.Context, clientID, token string) (plextv.Account, error)
	SharedUsers(ctx context.Context, clientID, ownerToken string) ([]plextv.SharedUser, error)
	MachineIdentifier(ctx context.Context, clientID, plexURL, ownerToken string) (string, error)
	Friends(ctx context.Context, clientID, ownerToken string) ([]plextv.Friend, error)
	OwnerWatchlist(ctx context.Context, clientID, ownerToken string) ([]plextv.WatchlistEntry, error)
	FriendWatchlist(ctx context.Context, clientID, ownerToken, uuid string) ([]plextv.WatchlistEntry, error)
	Resolve(ctx context.Context, clientID, ownerToken, key string) (plextv.Ids, error)
}

// Deps are what a Sync needs.
type Deps struct {
	Store  *store.Store
	TV     TV
	Host   Host
	Clock  func() time.Time
	Logger *slog.Logger
}

// Sync is Watchlist sync.
type Sync struct{ d Deps }

// New returns a Sync.
func New(d Deps) *Sync {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	return &Sync{d: d}
}

func ts(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// who is a person to read and how to read their Watchlist.
type who struct {
	Person
	read func(ctx context.Context) ([]plextv.WatchlistEntry, error)
}

// Run is one pass. It does nothing while Watchlist sync is off. It reads nobody
// when plex.tv cannot say who may request; a Watchlist plex.tv cannot give is
// skipped (and reported in the error) without stopping the others.
func (s *Sync) Run(ctx context.Context) error {
	cfg, ok, err := s.d.Host.Config(ctx)
	if err != nil || !ok {
		return err
	}
	people, err := s.people(ctx, cfg)
	if err != nil {
		return err
	}
	var errs []error
	for _, p := range people {
		if err := s.person(ctx, cfg, p); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			errs = append(errs, fmt.Errorf("%s: %w", p.Name, err))
		}
	}
	return errors.Join(errs...)
}

// people is the owner and the friends who may request: access by the owner's
// shared users (a Plex Home member, or a friend whose share includes this
// server), then the users list. A friend is matched to a shared user by Plex
// account uuid, then id, then username.
func (s *Sync) people(ctx context.Context, cfg Config) ([]who, error) {
	tv := s.d.TV
	owner, err := tv.Account(ctx, cfg.ClientID, cfg.OwnerToken)
	if err != nil {
		return nil, err
	}
	allowed := func(p Person) bool {
		return len(cfg.Users) == 0 || plextv.NameMatches(p.Name, p.Title, cfg.Users)
	}
	var out []who
	op := Person{ID: strconv.FormatInt(owner.ID, 10), Name: owner.Name(), Title: owner.Title, UUID: owner.UUID}
	if allowed(op) {
		out = append(out, who{op, func(ctx context.Context) ([]plextv.WatchlistEntry, error) {
			return tv.OwnerWatchlist(ctx, cfg.ClientID, cfg.OwnerToken)
		}})
	}
	friends, err := tv.Friends(ctx, cfg.ClientID, cfg.OwnerToken)
	if err != nil {
		return nil, err
	}
	shared, err := tv.SharedUsers(ctx, cfg.ClientID, cfg.OwnerToken)
	if err != nil {
		return nil, err
	}
	machine := ""
	for _, f := range friends {
		su := sharedUserOf(shared, f)
		if su == nil {
			continue
		}
		p := Person{ID: strconv.FormatInt(su.ID, 10), Name: su.Username, Title: su.Title, UUID: f.UUID}
		if p.Name == "" {
			p.Name = su.Title
		}
		if !allowed(p) {
			continue
		}
		if !su.Home {
			if machine == "" {
				if machine, err = tv.MachineIdentifier(ctx, cfg.ClientID, cfg.PlexURL, cfg.OwnerToken); err != nil {
					return nil, err
				}
			}
			if !hasServer(su.Servers, machine) {
				continue
			}
		}
		uuid := f.UUID
		out = append(out, who{p, func(ctx context.Context) ([]plextv.WatchlistEntry, error) {
			return tv.FriendWatchlist(ctx, cfg.ClientID, cfg.OwnerToken, uuid)
		}})
	}
	return out, nil
}

func hasServer(servers []string, machine string) bool {
	for _, m := range servers {
		if m == machine {
			return true
		}
	}
	return false
}

func sharedUserOf(shared []plextv.SharedUser, f plextv.Friend) *plextv.SharedUser {
	for i := range shared {
		if shared[i].UUID != "" && shared[i].UUID == f.UUID {
			return &shared[i]
		}
	}
	for i := range shared {
		if strconv.FormatInt(shared[i].ID, 10) == f.UUID {
			return &shared[i]
		}
	}
	for i := range shared {
		if f.Username != "" && strings.EqualFold(shared[i].Username, f.Username) {
			return &shared[i]
		}
	}
	return nil
}

// person reads one Watchlist and acts on what is new on it.
func (s *Sync) person(ctx context.Context, cfg Config, p who) error {
	entries, err := p.read(ctx)
	if errors.Is(err, plextv.ErrWatchlistHidden) {
		s.d.Logger.Debug("skipping a Watchlist the friend keeps private", "person", p.Name)
		return nil
	}
	if err != nil {
		return err
	}
	q := db.New(s.d.Store.Write())
	now := s.d.Clock()
	if _, err := q.GetAccount(ctx, p.ID); errors.Is(err, sql.ErrNoRows) {
		if len(entries) == 0 {
			// plex.tv answers some private Watchlists with an empty list, so an empty
			// first read is no baseline: the first read with a title on it is.
			return nil
		}
		return s.baseline(ctx, p, entries, now)
	} else if err != nil {
		return err
	}
	guids, err := q.ListEntryGuids(ctx, p.ID)
	if err != nil {
		return err
	}
	seen := make(map[string]bool, len(guids))
	for _, g := range guids {
		seen[g] = true
	}
	var errs []error
	for _, e := range entries {
		if seen[e.Guid] {
			continue
		}
		seen[e.Guid] = true
		if err := s.newEntry(ctx, cfg, p.Person, e, now); err != nil {
			if ctx.Err() != nil || errors.Is(err, plextv.ErrUnavailable) {
				return errors.Join(append(errs, err)...) // plex.tv is down: the rest wait for the next pass
			}
			errs = append(errs, fmt.Errorf("%q: %w", e.Title, err))
		}
	}
	return errors.Join(errs...)
}

// baseline records everything on the Watchlist and requests nothing.
func (s *Sync) baseline(ctx context.Context, p who, entries []plextv.WatchlistEntry, now time.Time) error {
	tx, err := s.d.Store.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck // after Commit it is a no-op
	q := db.New(tx)
	if err := q.InsertAccount(ctx, db.InsertAccountParams{AccountID: p.ID, Uuid: p.UUID, BaselineAt: ts(now)}); err != nil {
		return err
	}
	for _, e := range entries {
		if err := q.InsertEntry(ctx, db.InsertEntryParams{
			AccountID: p.ID, PlexGuid: e.Guid, Kind: string(e.Kind), Title: e.Title, FirstSeenAt: ts(now),
		}); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// newEntry resolves an entry that was not on the Watchlist before, requests it
// when it resolved to an id, and records it. An entry that resolves to none is
// recorded all the same, so it is not looked up again. Plex's answer failing
// records nothing, so the entry is tried again on the next pass.
func (s *Sync) newEntry(ctx context.Context, cfg Config, p Person, e plextv.WatchlistEntry, now time.Time) error {
	var ids plextv.Ids
	if e.Kind != plextv.Other {
		var err error
		if ids, err = s.d.TV.Resolve(ctx, cfg.ClientID, cfg.OwnerToken, e.Key); err != nil {
			return err
		}
	}
	if e.Kind == plextv.Movie {
		ids.TVDB = 0 // a Movie is Requested by its TMDB id only (ADR 0002)
	}
	row := db.InsertEntryParams{AccountID: p.ID, PlexGuid: e.Guid, Kind: string(e.Kind), Title: e.Title, FirstSeenAt: ts(now)}
	if ids.TMDB > 0 {
		row.TmdbID = sql.NullInt64{Int64: int64(ids.TMDB), Valid: true}
	}
	if ids.TVDB > 0 {
		row.TvdbID = sql.NullInt64{Int64: int64(ids.TVDB), Valid: true}
	}
	if e.Kind != plextv.Other && (ids.TMDB > 0 || ids.TVDB > 0) {
		id, err := s.d.Host.Request(ctx, p, Entry{Guid: e.Guid, Kind: e.Kind, Title: e.Title, Ids: ids})
		if err != nil {
			return err
		}
		row.RequestID = sql.NullInt64{Int64: id, Valid: true}
	}
	return db.New(s.d.Store.Write()).InsertEntry(ctx, row)
}
