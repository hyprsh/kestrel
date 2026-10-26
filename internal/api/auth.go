package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hyprsh/kestrel/internal/api/db"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/configfile"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
)

const (
	cookieName    = "kestrel_session"
	sessionLife   = 30 * 24 * time.Hour
	accountKey    = "account"
	minPasswordLn = 8
)

// account is the admin login, kept in settings.
type account struct {
	Username     string `json:"username"`
	PasswordHash string `json:"password_hash"`
}

// auth owns the admin account's login, the sessions and the request guard.
type auth struct {
	settings *settings.Settings
	read     *db.Queries
	write    *db.Queries
	clock    func() time.Time
	basePath string
	throttle *throttle
	plex     *plexSignIn
	cost     hashCost
	dummy    string    // a hash to verify against when the username is wrong, so timing does not reveal it
	fixedKey storedKey // the hashed KESTREL_API_KEY key; its Hash is empty when the variable is unset
}

func newAuth(st *store.Store, clock func() time.Time, baseURL string, cost hashCost, fixedAPIKey string) *auth {
	path := baseURL
	if path == "" {
		path = "/"
	}
	dummy, _ := hashWith("kestrel", cost)
	var fixed storedKey
	if fixedAPIKey != "" {
		fixed = newStoredKey(fixedAPIKey, clock())
	}
	return &auth{
		settings: settings.New(st),
		read:     db.New(st.Read()),
		write:    db.New(st.Write()),
		clock:    clock,
		basePath: path,
		throttle: newThrottle(),
		cost:     cost,
		dummy:    dummy,
		fixedKey: fixed,
	}
}

func loadAccount(ctx context.Context, s *settings.Settings) (acc account, ok bool, err error) {
	raw, ok, err := s.Get(ctx, accountKey)
	if err != nil || !ok {
		return account{}, false, err
	}
	return acc, true, json.Unmarshal(raw, &acc)
}

type ctxKey struct{}

// request is what the guard learned about the current call.
type request struct {
	ip        string
	secure    bool
	host      string // the Host header, which Plex sends the browser back to
	sessionID string // set when the request carries a live session
	method    oapi.MeMethod
	proxyUser string     // the Remote-User value when method is proxy
	requester *requester // set when the session is a Requester's (method is plex)
	plexPin   string     // the kestrel_plex_pin cookie's value
	// cookies are Set-Cookie values to add to the answer of the Plex sign-in
	// routes, whose generated responses carry only one.
	cookies []string
}

func requestFrom(ctx context.Context) *request {
	r, _ := ctx.Value(ctxKey{}).(*request)
	if r == nil {
		r = &request{}
	}
	return r
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// startSession stores a new session and returns the cookie that carries it.
func (a *auth) startSession(ctx context.Context, secure bool) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	now := a.clock()
	err := a.write.CreateSession(ctx, db.CreateSessionParams{
		ID: hashToken(token), CreatedAt: now.Unix(), ExpiresAt: now.Add(sessionLife).Unix(),
	})
	if err != nil {
		return "", err
	}
	return a.cookie(token, secure, now.Add(sessionLife)), nil
}

// startRequesterSession stores a new session for a Requester who just signed
// in with Plex and returns the cookie that carries it.
func (a *auth) startRequesterSession(ctx context.Context, secure bool, who requester) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	now := a.clock()
	err := a.write.CreateRequesterSession(ctx, db.CreateRequesterSessionParams{
		ID: hashToken(token), CreatedAt: now.Unix(), ExpiresAt: now.Add(sessionLife).Unix(),
		RequesterID: nullString(who.id), RequesterName: nullString(who.name), RequesterTitle: nullString(who.title),
		AccessCheckedAt: nullInt(now.Unix()),
	})
	if err != nil {
		return "", err
	}
	return a.cookie(token, secure, now.Add(sessionLife)), nil
}

func nullString(s string) sql.NullString { return sql.NullString{String: s, Valid: true} }
func nullInt(n int64) sql.NullInt64      { return sql.NullInt64{Int64: n, Valid: true} }

func (a *auth) cookie(token string, secure bool, expires time.Time) string {
	c := &http.Cookie{
		Name: cookieName, Value: token, Path: a.basePath,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure,
	}
	if token == "" {
		c.MaxAge = -1
	} else {
		c.Expires = expires
		c.MaxAge = int(sessionLife / time.Second)
	}
	return c.String()
}

// guard enforces login and CSRF protection on everything under /api/v1 except
// the published spec.
func (a *auth) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, apiRoot+"/") || r.URL.Path == apiRoot+"/openapi.json" {
			next.ServeHTTP(w, r)
			return
		}
		socket, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			socket = r.RemoteAddr
		}
		fail := func(p *problemError) { p.write(w) }
		internal := func() { fail(problem(http.StatusInternalServerError, "internal", "internal error")) }

		_, exists, err := loadAccount(r.Context(), a.settings)
		if err != nil {
			internal()
			return
		}
		proxy, err := loadProxyConfig(r.Context(), a.settings)
		if err != nil {
			internal()
			return
		}
		info := &request{
			ip:     proxy.clientIP(socket, r.Header.Values("X-Forwarded-For")),
			secure: r.TLS != nil || (proxy.trusts(socket) && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")),
			host:   r.Host,
			method: oapi.Session,
		}
		if c, err := r.Cookie(plexPinCookie); err == nil {
			info.plexPin = c.Value
		}
		r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, info))

		// An API key decides on its own: it needs no session and is exempt from
		// the CSRF rules, and a bad one is throttled like a failed login.
		if key := r.Header.Get("X-Api-Key"); key != "" && exists {
			now := a.clock()
			if wait := a.throttle.wait(info.ip, now); wait > 0 {
				p := problem(http.StatusTooManyRequests, "rate_limited", "too many failed attempts")
				p.retryAfter = wait
				fail(p)
				return
			}
			ok, err := a.keyMatches(r.Context(), key)
			if err != nil {
				internal()
				return
			}
			if !ok {
				a.throttle.fail(info.ip, now)
				fail(problem(http.StatusUnauthorized, "unauthenticated", "invalid API key"))
				return
			}
			a.throttle.reset(info.ip)
			info.method = oapi.ApiKey
			next.ServeHTTP(w, r)
			return
		}

		if p := csrfCheck(r); p != nil {
			fail(p)
			return
		}

		route := r.Method + " " + strings.TrimPrefix(r.URL.Path, apiRoot)
		if !exists {
			switch route {
			case "GET /setup", "GET /system", "POST /setup/account":
				next.ServeHTTP(w, r)
			default:
				fail(problem(http.StatusUnauthorized, "setup_required", "create the admin account first"))
			}
			return
		}

		// Plex sign-in is for people who have no session yet. Its two POSTs add
		// cookies the generated responses cannot carry.
		if plexPublic[route] {
			if route != "GET /auth/plex" {
				w = &cookieWriter{ResponseWriter: w, info: info}
			}
			next.ServeHTTP(w, r)
			return
		}

		// Reverse-proxy login: believed per request from a trusted address only.
		// The same header from anywhere else is ignored and recorded.
		authed := false
		if proxy.Enabled {
			if user := strings.TrimSpace(r.Header.Get(proxy.Header)); user != "" {
				if proxy.trusts(socket) {
					info.method, info.proxyUser, authed = oapi.Proxy, user, true
				} else {
					a.recordUntrusted(r.Context(), socket, user)
				}
			}
		}
		if !authed {
			if c, err := r.Cookie(cookieName); err == nil && c.Value != "" {
				id := hashToken(c.Value)
				if sess, live := a.slide(r.Context(), id); live {
					info.sessionID = id
					w.Header().Set("Set-Cookie", a.cookie(c.Value, info.secure, a.clock().Add(sessionLife)))
					authed = true
					if sess.RequesterID.Valid {
						who := requester{id: sess.RequesterID.String, name: sess.RequesterName.String, title: sess.RequesterTitle.String}
						checked := time.Unix(sess.AccessCheckedAt.Int64, 0)
						if !sess.AccessCheckedAt.Valid {
							checked = time.Time{}
						}
						keep, err := a.plex.stillAllowed(r.Context(), id, who, checked)
						if err != nil {
							internal()
							return
						}
						if !keep {
							_ = a.write.DeleteSession(r.Context(), id)
							w.Header().Set("Set-Cookie", a.cookie("", info.secure, time.Time{}))
							fail(problem(http.StatusUnauthorized, "unauthenticated", "log in first"))
							return
						}
						info.requester, info.method = &who, oapi.Plex
						if !requesterMayCall(route) {
							fail(problem(http.StatusForbidden, "forbidden", "a Requester may only search, request and see their own Requests"))
							return
						}
					}
				}
			}
		}
		if !authed && route != "POST /auth/login" {
			fail(problem(http.StatusUnauthorized, "unauthenticated", "log in first"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// slide extends a live session by another 30 days and reports whether it was live.
func (a *auth) slide(ctx context.Context, id string) (db.LiveSessionRow, bool) {
	now := a.clock()
	row, err := a.read.LiveSession(ctx, db.LiveSessionParams{ID: id, ExpiresAt: now.Unix()})
	if err != nil {
		return row, false
	}
	return row, a.write.SlideSession(ctx, db.SlideSessionParams{ID: id, ExpiresAt: now.Add(sessionLife).Unix()}) == nil
}

// plexPublic are the routes of Plex sign-in, which need no session.
var plexPublic = map[string]bool{"GET /auth/plex": true, "POST /auth/plex/pin": true, "POST /auth/plex/login": true}

// requesterMayCall reports whether a Requester's session may call route: only
// what searching, requesting and following one's own Requests needs. Anything
// not listed here is refused, so a new route is closed to Requesters until it
// is added.
func requesterMayCall(route string) bool {
	switch route {
	case "GET /auth/me", "POST /auth/logout", "GET /system", "GET /lookup", "GET /my/requests", "POST /my/requests":
		return true
	}
	id, ok := strings.CutPrefix(route, "GET /titles/")
	id, poster := strings.CutSuffix(id, "/poster")
	return ok && poster && id != "" && !strings.Contains(id, "/")
}

// cookieWriter adds the request's extra Set-Cookie values when the answer's
// header is written.
type cookieWriter struct {
	http.ResponseWriter
	info  *request
	wrote bool
}

func (w *cookieWriter) WriteHeader(status int) {
	if w.wrote {
		return
	}
	w.wrote = true
	for _, c := range w.info.cookies {
		w.Header().Add("Set-Cookie", c)
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *cookieWriter) Write(b []byte) (int, error) {
	w.WriteHeader(http.StatusOK)
	return w.ResponseWriter.Write(b)
}

// csrfCheck refuses state-changing requests that are not JSON or that come
// from another origin. Origin's host[:port] must equal Host, with the scheme
// ignored so a TLS-terminating proxy works. SameSite=Lax on the cookie covers
// the rest.
func csrfCheck(r *http.Request) *problemError {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return nil
	}
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		return problem(http.StatusForbidden, "forbidden_origin", "state-changing requests must be application/json")
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || !strings.EqualFold(u.Host, r.Host) {
			return problem(http.StatusForbidden, "forbidden_origin", "Origin does not match Host")
		}
	}
	return nil
}

// ---- handlers ----

const setupCompletedKey = settings.SetupCompleted

// setupSources are what the wizard's sections are read from.
type setupSources struct {
	settings    *settings.Settings
	plugins     PluginInstances
	profiles    Profiles
	rootFolders RootFolders
}

func (s *server) setupState(ctx context.Context) (oapi.Setup, error) {
	return setupSources{settings: s.auth.settings, plugins: s.plugins, profiles: s.profiles, rootFolders: s.rootFolders}.state(ctx)
}

// state reads where every wizard section stands.
func (s setupSources) state(ctx context.Context) (oapi.Setup, error) {
	_, exists, err := loadAccount(ctx, s.settings)
	if err != nil {
		return oapi.Setup{}, err
	}
	state := func(done bool) oapi.SetupSectionState {
		if done {
			return oapi.Done
		}
		return oapi.Todo
	}
	var out oapi.Setup
	out.AccountExists = exists
	out.Sections.Account = state(exists)
	_, regionSaved, err := s.profiles.Region(ctx)
	if err != nil {
		return out, err
	}
	out.Sections.Language = state(regionSaved)
	clients, err := s.plugins.Enabled(ctx, downloadclient.Contract.ID)
	if err != nil {
		return out, err
	}
	out.Sections.DownloadClient = state(len(clients) > 0)
	indexers, err := s.plugins.Enabled(ctx, indexer.Contract.ID)
	if err != nil {
		return out, err
	}
	out.Sections.Indexer = state(len(indexers) > 0)
	_, rootsSaved, err := s.rootFolders.Get(ctx)
	if err != nil {
		return out, err
	}
	out.Sections.RootFolders = state(rootsSaved)
	// Profiles have nothing to save: the builtin rows ship configured and Standard
	// always keeps its defaults, so the section is always done.
	out.Sections.Profiles = oapi.Done
	_, out.Completed, err = s.settings.Get(ctx, setupCompletedKey)
	return out, err
}

// missingSections lists the sections still to set up, as field errors.
func missingSections(st oapi.Setup) []fieldError {
	var missing []fieldError
	for _, sec := range []struct {
		name  string
		state oapi.SetupSectionState
	}{
		{"account", st.Sections.Account}, {"language", st.Sections.Language},
		{"download_client", st.Sections.DownloadClient}, {"indexer", st.Sections.Indexer},
		{"root_folders", st.Sections.RootFolders}, {"profiles", st.Sections.Profiles},
	} {
		if sec.state != oapi.Done {
			missing = append(missing, fieldError{Field: "sections." + sec.name, Code: "todo", Message: sec.name + " is not set up yet"})
		}
	}
	return missing
}

func (s *server) GetSetup(ctx context.Context, _ oapi.GetSetupRequestObject) (oapi.GetSetupResponseObject, error) {
	out, err := s.setupState(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.GetSetup200JSONResponse(out), nil
}

func (s *server) CompleteSetup(ctx context.Context, _ oapi.CompleteSetupRequestObject) (oapi.CompleteSetupResponseObject, error) {
	st, err := s.setupState(ctx)
	if err != nil {
		return nil, err
	}
	if missing := missingSections(st); len(missing) > 0 {
		p := problem(http.StatusUnprocessableEntity, "validation", "setup is not finished: some sections are missing")
		p.fields = missing
		return nil, p
	}
	if err := s.auth.settings.Put(ctx, setupCompletedKey, []byte("true")); err != nil {
		return nil, err
	}
	return oapi.CompleteSetup204Response{}, nil
}

func validateCredentials(c *oapi.Credentials) (username, password string, err *problemError) {
	if c == nil {
		return "", "", invalid("body", "required", "username and password are required")
	}
	username = strings.TrimSpace(c.Username)
	if c.Password != nil {
		password = *c.Password
	}
	if username == "" {
		return "", "", invalid("username", "required", "username is required")
	}
	if utf8.RuneCountInString(password) < minPasswordLn {
		return "", "", invalid("password", "too_short", "password must be at least 8 characters")
	}
	return username, password, nil
}

func (s *server) CreateAccount(ctx context.Context, req oapi.CreateAccountRequestObject) (oapi.CreateAccountResponseObject, error) {
	if err := s.refuseDeclared(configfile.SectionAccount); err != nil {
		return nil, err
	}
	username, password, perr := validateCredentials(req.Body)
	if perr != nil {
		return nil, perr
	}
	hash, err := hashWith(password, s.auth.cost)
	if err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(account{Username: username, PasswordHash: hash})
	created, err := s.auth.settings.Insert(ctx, accountKey, raw)
	if err != nil {
		return nil, err
	}
	if !created {
		return nil, problem(http.StatusConflict, "conflict", "an account already exists")
	}
	cookie, err := s.auth.startSession(ctx, requestFrom(ctx).secure)
	if err != nil {
		return nil, err
	}
	return oapi.CreateAccount201JSONResponse{
		Body:    oapi.Me{Username: username, Role: oapi.MeRoleAdmin, Method: oapi.Session, FromConfigFile: s.declares(configfile.SectionAccount)},
		Headers: oapi.CreateAccount201ResponseHeaders{SetCookie: &cookie},
	}, nil
}

func (s *server) Login(ctx context.Context, req oapi.LoginRequestObject) (oapi.LoginResponseObject, error) {
	info := requestFrom(ctx)
	now := s.auth.clock()
	if wait := s.auth.throttle.wait(info.ip, now); wait > 0 {
		p := problem(http.StatusTooManyRequests, "rate_limited", "too many failed attempts")
		p.retryAfter = wait
		return nil, p
	}
	acc, _, err := loadAccount(ctx, s.auth.settings)
	if err != nil {
		return nil, err
	}
	var username, password string
	if req.Body != nil {
		username = strings.TrimSpace(req.Body.Username)
		if req.Body.Password != nil {
			password = *req.Body.Password
		}
	}
	userOK := username == acc.Username
	hash := acc.PasswordHash
	if !userOK {
		hash = s.auth.dummy
	}
	if !verifyPassword(password, hash) || !userOK {
		s.auth.throttle.fail(info.ip, now)
		return nil, problem(http.StatusUnauthorized, "unauthenticated", "wrong username or password")
	}
	s.auth.throttle.reset(info.ip)
	cookie, err := s.auth.startSession(ctx, info.secure)
	if err != nil {
		return nil, err
	}
	return oapi.Login204Response{Headers: oapi.Login204ResponseHeaders{SetCookie: &cookie}}, nil
}

func (s *server) Logout(ctx context.Context, _ oapi.LogoutRequestObject) (oapi.LogoutResponseObject, error) {
	info := requestFrom(ctx)
	if err := s.auth.write.DeleteSession(ctx, info.sessionID); err != nil {
		return nil, err
	}
	cleared := s.auth.cookie("", info.secure, time.Time{})
	return oapi.Logout204Response{Headers: oapi.Logout204ResponseHeaders{SetCookie: &cleared}}, nil
}

func (s *server) LogoutEverywhere(ctx context.Context, _ oapi.LogoutEverywhereRequestObject) (oapi.LogoutEverywhereResponseObject, error) {
	if err := s.auth.write.DeleteAllSessions(ctx); err != nil {
		return nil, err
	}
	cleared := s.auth.cookie("", requestFrom(ctx).secure, time.Time{})
	return oapi.LogoutEverywhere204Response{Headers: oapi.LogoutEverywhere204ResponseHeaders{SetCookie: &cleared}}, nil
}

func (s *server) GetMe(ctx context.Context, _ oapi.GetMeRequestObject) (oapi.GetMeResponseObject, error) {
	info := requestFrom(ctx)
	if who := info.requester; who != nil {
		return oapi.GetMe200JSONResponse(oapi.Me{Username: who.name, Role: oapi.MeRoleRequester, Method: oapi.Plex}), nil
	}
	acc, _, err := loadAccount(ctx, s.auth.settings)
	if err != nil {
		return nil, err
	}
	out := oapi.Me{Username: acc.Username, Role: oapi.MeRoleAdmin, Method: info.method, FromConfigFile: s.declares(configfile.SectionAccount)}
	if info.method == oapi.Proxy {
		out.ProxyUser = &info.proxyUser
	}
	return oapi.GetMe200JSONResponse(out), nil
}

func (s *server) ChangePassword(ctx context.Context, req oapi.ChangePasswordRequestObject) (oapi.ChangePasswordResponseObject, error) {
	if req.Body == nil {
		return nil, invalid("body", "required", "current_password and new_password are required")
	}
	if err := s.refuseDeclared(configfile.SectionAccount); err != nil {
		return nil, err
	}
	acc, _, err := loadAccount(ctx, s.auth.settings)
	if err != nil {
		return nil, err
	}
	var current, next string
	if req.Body.CurrentPassword != nil {
		current = *req.Body.CurrentPassword
	}
	if req.Body.NewPassword != nil {
		next = *req.Body.NewPassword
	}
	if !verifyPassword(current, acc.PasswordHash) {
		return nil, invalid("current_password", "incorrect", "current password is incorrect")
	}
	if utf8.RuneCountInString(next) < minPasswordLn {
		return nil, invalid("new_password", "too_short", "password must be at least 8 characters")
	}
	if acc.PasswordHash, err = hashWith(next, s.auth.cost); err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(acc)
	if err := s.auth.settings.Put(ctx, accountKey, raw); err != nil {
		return nil, err
	}
	if err := s.auth.write.DeleteOtherAdminSessions(ctx, requestFrom(ctx).sessionID); err != nil {
		return nil, err
	}
	return oapi.ChangePassword204Response{}, nil
}

// ---- pruning ----

// PruneSessions deletes sessions that expired at or before now and reports how many.
func PruneSessions(ctx context.Context, st *store.Store, now time.Time) (int64, error) {
	return db.New(st.Write()).PruneSessions(ctx, now.Unix())
}
