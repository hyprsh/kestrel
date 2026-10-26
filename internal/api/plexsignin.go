package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/api/db"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/plextv"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
)

const (
	plexSignInKey   = "plex_sign_in"
	plexClientIDKey = "plex_client_id"
	// plexPluginID is the Plex media-server plugin, whose instance holds the
	// server's URL and its owner's token.
	plexPluginID = "plex"

	plexPinCookie = "kestrel_plex_pin"
	plexPinLife   = 15 * time.Minute
	// accessRecheck is how long a Requester's access to the Plex server stands
	// before the owner's list is read again.
	accessRecheck = time.Hour
	// upstreamPause is how long after a failed re-check the next one waits, so
	// a plex.tv outage does not slow every call.
	upstreamPause = time.Minute
)

// PlexTV is plex.tv, as far as Plex sign-in needs it.
type PlexTV interface {
	CreatePin(ctx context.Context, clientID string) (plextv.Pin, error)
	AuthURL(clientID string, pin plextv.Pin, forwardURL string) string
	PinToken(ctx context.Context, clientID string, pin plextv.Pin) (string, error)
	Account(ctx context.Context, clientID, token string) (plextv.Account, error)
	HasAccess(ctx context.Context, clientID, plexURL, ownerToken string, acct plextv.Account) (bool, error)
}

// requester is who a Requester session belongs to.
type requester struct {
	id    string // the Plex account id
	name  string // the Plex username, else the account's title
	title string // the account's title
}

func (r requester) matches(names []string) bool { return plextv.NameMatches(r.name, r.title, names) }

// plexSignIn is Plex sign-in: its settings, the Plex instance behind it and
// the rules that keep a Requester's session honest (ADR 0018).
type plexSignIn struct {
	settings *settings.Settings
	plugins  PluginInstances
	tv       PlexTV
	write    *db.Queries
	clock    func() time.Time
	log      *slog.Logger

	mu       sync.Mutex
	failedAt time.Time // the last re-check plex.tv could not answer
}

// defaultPlexSignIn is Plex sign-in before anything is saved.
func defaultPlexSignIn() oapi.PlexSignInSettings {
	return oapi.PlexSignInSettings{Users: []string{}, UserRootFolders: []oapi.PlexUserRootFolders{}}
}

func loadPlexSignIn(ctx context.Context, s *settings.Settings) (oapi.PlexSignInSettings, error) {
	cfg := defaultPlexSignIn()
	raw, ok, err := s.Get(ctx, plexSignInKey)
	if err != nil || !ok {
		return cfg, err
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, err
	}
	return normalizePlexSignIn(cfg), nil
}

// normalizePlexSignIn trims what people type and makes the lists lists.
func normalizePlexSignIn(in oapi.PlexSignInSettings) oapi.PlexSignInSettings {
	out := oapi.PlexSignInSettings{Enabled: in.Enabled, Users: []string{}, UserRootFolders: []oapi.PlexUserRootFolders{}}
	if in.Instance != nil {
		if name := strings.TrimSpace(*in.Instance); name != "" {
			out.Instance = &name
		}
	}
	for _, u := range in.Users {
		out.Users = append(out.Users, strings.TrimSpace(u))
	}
	for _, f := range in.UserRootFolders {
		f.User = strings.TrimSpace(f.User)
		out.UserRootFolders = append(out.UserRootFolders, f)
	}
	return out
}

// validatePlexSignIn applies the rules both PUT /settings/plex-sign-in and the
// Config File's plex_sign_in follow. kinds maps each plugin instance's name to
// its plugin id; roots are the Root folders the Requesters' folders come from.
func validatePlexSignIn(in oapi.PlexSignInSettings, kinds map[string]string, roots rootfolders.Folders) *problemError {
	if in.Enabled {
		switch {
		case in.Instance == nil:
			return invalid("instance", "required", "Name the Plex instance whose server and token decide who may sign in")
		case kinds[*in.Instance] == "":
			return invalid("instance", "not_found", "There is no plugin instance of that name")
		case kinds[*in.Instance] != plexPluginID:
			return invalid("instance", "wrong_plugin", "That plugin instance is not a Plex server")
		}
	}
	seen := map[string]bool{}
	for i, u := range in.Users {
		field := fmt.Sprintf("users[%d]", i)
		switch key := strings.ToLower(u); {
		case u == "":
			return invalid(field, "required", "Name a Plex user")
		case seen[key]:
			return invalid(field, "duplicate", "That Plex user is on the list already")
		default:
			seen[key] = true
		}
	}
	seen = map[string]bool{}
	for i, f := range in.UserRootFolders {
		field := fmt.Sprintf("user_root_folders[%d].", i)
		switch key := strings.ToLower(f.User); {
		case f.User == "":
			return invalid(field+"user", "required", "Name a Plex user")
		case seen[key]:
			return invalid(field+"user", "duplicate", "That Plex user has Root folders already")
		default:
			seen[key] = true
		}
		if f.Movies != nil && !slices.Contains(roots.Movies, *f.Movies) {
			return invalid(field+"movies", "not_found", rootfolders.Movie.NotConfiguredMessage())
		}
		if f.Series != nil && !slices.Contains(roots.Series, *f.Series) {
			return invalid(field+"series", "not_found", rootfolders.Series.NotConfiguredMessage())
		}
	}
	return nil
}

// instanceKinds maps each plugin instance's name to its plugin id.
func instanceKinds(list []instances.Instance) map[string]string {
	out := make(map[string]string, len(list))
	for _, i := range list {
		out[i.Name] = i.PluginID
	}
	return out
}

// plexFromFile is the Config File's plex_sign_in as the settings hold it.
func plexFromFile(p configfile.PlexSignIn) oapi.PlexSignInSettings {
	in := oapi.PlexSignInSettings{Enabled: p.Enabled != nil && *p.Enabled, Users: p.Users}
	if p.Instance != "" {
		in.Instance = &p.Instance
	}
	for _, user := range slices.Sorted(mapKeys(p.UserRootFolders)) {
		f := p.UserRootFolders[user]
		in.UserRootFolders = append(in.UserRootFolders, oapi.PlexUserRootFolders{User: user, Movies: f.Movies, Series: f.Series})
	}
	return normalizePlexSignIn(in)
}

func mapKeys[V any](m map[string]V) func(yield func(string) bool) {
	return func(yield func(string) bool) {
		for k := range m {
			if !yield(k) {
				return
			}
		}
	}
}

// active is the saved settings and the Plex instance they name, with ok false
// while Plex sign-in is off, names no instance or names one that is not a Plex.
func (p *plexSignIn) active(ctx context.Context) (cfg oapi.PlexSignInSettings, inst instances.Instance, ok bool, err error) {
	cfg, err = loadPlexSignIn(ctx, p.settings)
	if err != nil || !cfg.Enabled || cfg.Instance == nil {
		return cfg, inst, false, err
	}
	list, err := p.plugins.List(ctx)
	if err != nil {
		return cfg, inst, false, err
	}
	for _, i := range list {
		if i.Name == *cfg.Instance && i.PluginID == plexPluginID {
			return cfg, i, true, nil
		}
	}
	return cfg, inst, false, nil
}

// clientID is this instance's Plex client identifier, generated once.
func (p *plexSignIn) clientID(ctx context.Context) (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	if _, err := p.settings.Insert(ctx, plexClientIDKey, []byte(strconv.Quote(hex.EncodeToString(raw)))); err != nil {
		return "", err
	}
	stored, _, err := p.settings.Get(ctx, plexClientIDKey)
	if err != nil {
		return "", err
	}
	var id string
	return id, json.Unmarshal(stored, &id)
}

// server is the Plex server's URL and its owner's token, from the instance.
func ownerOf(inst instances.Instance) (plexURL, token string) {
	plexURL, _ = inst.Config["url"].(string)
	token, _ = inst.Config["token"].(string)
	return plexURL, token
}

var errNoOwnerToken = errors.New("the Plex instance has no URL or token")

// hasAccess asks plex.tv, with the owner's token, whether acct may use the server.
func (p *plexSignIn) hasAccess(ctx context.Context, inst instances.Instance, acct plextv.Account) (bool, error) {
	plexURL, token := ownerOf(inst)
	if plexURL == "" || token == "" {
		return false, errNoOwnerToken
	}
	cid, err := p.clientID(ctx)
	if err != nil {
		return false, err
	}
	return p.tv.HasAccess(ctx, cid, plexURL, token, acct)
}

// stillAllowed decides whether a Requester's session lives on: no while Plex
// sign-in is off, while the account has left a non-empty list of users, and,
// at most once an hour, when the owner's list no longer gives the account
// access. A plex.tv or Plex outage keeps the session (it is logged), so an
// error is only a database one.
func (p *plexSignIn) stillAllowed(ctx context.Context, sessionID string, who requester, checkedAt time.Time) (bool, error) {
	cfg, inst, ok, err := p.active(ctx)
	if err != nil || !ok {
		return false, err
	}
	if len(cfg.Users) > 0 && !who.matches(cfg.Users) {
		return false, nil
	}
	now := p.clock()
	if d := now.Sub(checkedAt); d >= 0 && d < accessRecheck {
		return true, nil
	}
	p.mu.Lock()
	paused := now.Sub(p.failedAt) >= 0 && now.Sub(p.failedAt) < upstreamPause
	p.mu.Unlock()
	if paused {
		return true, nil
	}
	id, err := strconv.ParseInt(who.id, 10, 64)
	if err != nil {
		return false, nil
	}
	access, err := p.hasAccess(ctx, inst, plextv.Account{ID: id, Username: who.name, Title: who.title})
	if err != nil {
		if ctx.Err() != nil {
			return false, ctx.Err()
		}
		p.log.Warn("plex sign-in: cannot check a Requester's access, keeping the session", "err", err)
		p.mu.Lock()
		p.failedAt = now
		p.mu.Unlock()
		return true, nil
	}
	if !access {
		return false, nil
	}
	return true, p.write.MarkAccessChecked(ctx, db.MarkAccessCheckedParams{AccessCheckedAt: nullInt(now.Unix()), ID: sessionID})
}

// ---- cookies ----

// pinCookieValue is the PIN as the cookie carries it: id.code.
func pinCookieValue(pin plextv.Pin) string { return strconv.FormatInt(pin.ID, 10) + "." + pin.Code }

func parsePinCookie(v string) (plextv.Pin, bool) {
	id, code, ok := strings.Cut(v, ".")
	n, err := strconv.ParseInt(id, 10, 64)
	if !ok || err != nil || n <= 0 || code == "" {
		return plextv.Pin{}, false
	}
	return plextv.Pin{ID: n, Code: code}, true
}

func (a *auth) pinCookie(value string, secure bool) string {
	c := &http.Cookie{Name: plexPinCookie, Value: value, Path: a.basePath, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure}
	if value == "" {
		c.MaxAge = -1
	} else {
		c.MaxAge = int(plexPinLife / time.Second)
	}
	return c.String()
}

// ---- handlers ----

func plexOff() *problemError {
	return problem(http.StatusForbidden, "plex_sign_in_off", "Plex sign-in is switched off")
}

func plexUnavailable() *problemError {
	return problem(http.StatusBadGateway, "upstream_unavailable", "plex.tv or the Plex server could not be reached")
}

func (s *server) GetPlexSignIn(ctx context.Context, _ oapi.GetPlexSignInRequestObject) (oapi.GetPlexSignInResponseObject, error) {
	_, _, ok, err := s.plex.active(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.GetPlexSignIn200JSONResponse{Enabled: ok}, nil
}

func (s *server) StartPlexSignIn(ctx context.Context, _ oapi.StartPlexSignInRequestObject) (oapi.StartPlexSignInResponseObject, error) {
	_, _, ok, err := s.plex.active(ctx)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, plexOff()
	}
	cid, err := s.plex.clientID(ctx)
	if err != nil {
		return nil, err
	}
	pin, err := s.plex.tv.CreatePin(ctx, cid)
	if err != nil {
		s.opts.Logger.Warn("plex sign-in: cannot create a PIN", "err", err)
		return nil, plexUnavailable()
	}
	info := requestFrom(ctx)
	scheme := "http"
	if info.secure {
		scheme = "https"
	}
	forward := scheme + "://" + info.host + s.opts.BaseURL + "/?plex=1"
	cookie := s.auth.pinCookie(pinCookieValue(pin), info.secure)
	return oapi.StartPlexSignIn200JSONResponse{
		Body:    oapi.PlexPin{AuthUrl: s.plex.tv.AuthURL(cid, pin, forward)},
		Headers: oapi.StartPlexSignIn200ResponseHeaders{SetCookie: &cookie},
	}, nil
}

func (s *server) FinishPlexSignIn(ctx context.Context, _ oapi.FinishPlexSignInRequestObject) (oapi.FinishPlexSignInResponseObject, error) {
	info := requestFrom(ctx)
	now := s.auth.clock()
	if wait := s.auth.throttle.wait(info.ip, now); wait > 0 {
		p := problem(http.StatusTooManyRequests, "rate_limited", "too many failed attempts")
		p.retryAfter = wait
		return nil, p
	}
	cfg, inst, ok, err := s.plex.active(ctx)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, plexOff()
	}
	// done ends the sign-in: the PIN is used up, so the browser forgets it.
	done := func() { info.cookies = append(info.cookies, s.auth.pinCookie("", info.secure)) }
	pin, ok := parsePinCookie(info.plexPin)
	if !ok {
		done()
		return nil, problem(http.StatusUnauthorized, "unauthenticated", "start the Plex sign-in again")
	}
	cid, err := s.plex.clientID(ctx)
	if err != nil {
		return nil, err
	}
	token, err := s.plex.tv.PinToken(ctx, cid, pin)
	switch {
	case errors.Is(err, plextv.ErrPinGone):
		done()
		return nil, problem(http.StatusUnauthorized, "unauthenticated", "the Plex sign-in expired: start again")
	case err != nil:
		s.opts.Logger.Warn("plex sign-in: cannot read the PIN", "err", err)
		return nil, plexUnavailable()
	case token == "":
		return nil, problem(http.StatusConflict, "pending", "Plex has not been authorised yet")
	}
	acct, err := s.plex.tv.Account(ctx, cid, token)
	switch {
	case errors.Is(err, plextv.ErrTokenRejected):
		done()
		return nil, problem(http.StatusUnauthorized, "unauthenticated", "Plex did not accept the sign-in: start again")
	case err != nil:
		s.opts.Logger.Warn("plex sign-in: cannot read the account", "err", err)
		return nil, plexUnavailable()
	}
	// The Requester's own token is not needed any more, and is not kept.
	token = ""

	allowed := len(cfg.Users) == 0 || acct.Matches(cfg.Users)
	if allowed {
		if allowed, err = s.plex.hasAccess(ctx, inst, acct); err != nil {
			s.opts.Logger.Warn("plex sign-in: cannot check access to the server", "err", err)
			return nil, plexUnavailable()
		}
	}
	if !allowed {
		s.auth.throttle.fail(info.ip, now)
		done()
		return nil, problem(http.StatusForbidden, "plex_no_access", "This Plex account has no access to the server")
	}
	s.auth.throttle.reset(info.ip)
	cookie, err := s.auth.startRequesterSession(ctx, info.secure, requester{id: strconv.FormatInt(acct.ID, 10), name: acct.Name(), title: acct.Title})
	if err != nil {
		return nil, err
	}
	done()
	return oapi.FinishPlexSignIn204Response{Headers: oapi.FinishPlexSignIn204ResponseHeaders{SetCookie: &cookie}}, nil
}

func (s *server) plexSignInBody(ctx context.Context) (oapi.PlexSignIn, error) {
	cfg, err := loadPlexSignIn(ctx, s.plex.settings)
	if err != nil {
		return oapi.PlexSignIn{}, err
	}
	return oapi.PlexSignIn{
		Enabled: cfg.Enabled, Instance: cfg.Instance, Users: cfg.Users, UserRootFolders: cfg.UserRootFolders,
		FromConfigFile: s.declares(configfile.SectionPlexSignIn),
	}, nil
}

func (s *server) GetPlexSignInSettings(ctx context.Context, _ oapi.GetPlexSignInSettingsRequestObject) (oapi.GetPlexSignInSettingsResponseObject, error) {
	body, err := s.plexSignInBody(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.GetPlexSignInSettings200JSONResponse(body), nil
}

func (s *server) PutPlexSignInSettings(ctx context.Context, req oapi.PutPlexSignInSettingsRequestObject) (oapi.PutPlexSignInSettingsResponseObject, error) {
	if req.Body == nil {
		return nil, invalid("body", "required", "settings are required")
	}
	if err := s.refuseDeclared(configfile.SectionPlexSignIn); err != nil {
		return nil, err
	}
	in := normalizePlexSignIn(oapi.PlexSignInSettings(*req.Body))
	list, err := s.plugins.List(ctx)
	if err != nil {
		return nil, err
	}
	roots, _, err := s.rootFolders.Get(ctx)
	if err != nil {
		return nil, err
	}
	if perr := validatePlexSignIn(in, instanceKinds(list), roots); perr != nil {
		return nil, perr
	}
	raw, _ := json.Marshal(in)
	if err := s.plex.settings.Put(ctx, plexSignInKey, raw); err != nil {
		return nil, err
	}
	body, err := s.plexSignInBody(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.PutPlexSignInSettings200JSONResponse(body), nil
}

// ---- the Config File's side ----

// CheckPlexSignIn applies PUT /settings/plex-sign-in's rules to the declared
// section. kinds maps the plugin instance names that will exist once the file
// is applied to their plugin ids, and roots are the Root folders then.
func (d *Declared) CheckPlexSignIn(p configfile.PlexSignIn, kinds map[string]string, roots rootfolders.Folders) error {
	if perr := validatePlexSignIn(plexFromFile(p), kinds, roots); perr != nil {
		return declaredField("plex_sign_in", perr)
	}
	return nil
}

// DeclarePlexSignIn saves the declared Plex sign-in when it differs from the stored one.
func (d *Declared) DeclarePlexSignIn(ctx context.Context, p configfile.PlexSignIn) error {
	want, _ := json.Marshal(plexFromFile(p))
	if _, ok, err := d.settings.Get(ctx, plexSignInKey); err != nil {
		return err
	} else if ok {
		stored, err := loadPlexSignIn(ctx, d.settings)
		if err != nil {
			return err
		}
		if have, _ := json.Marshal(stored); bytes.Equal(have, want) {
			return nil
		}
	}
	return d.settings.Put(ctx, plexSignInKey, want)
}
