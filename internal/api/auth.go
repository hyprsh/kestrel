package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hyprsh/kestrel/internal/api/db"
	"github.com/hyprsh/kestrel/internal/api/oapi"
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
	dummy    string // a hash to verify against when the username is wrong, so timing does not reveal it
}

func newAuth(st *store.Store, clock func() time.Time, baseURL string) *auth {
	path := baseURL
	if path == "" {
		path = "/"
	}
	dummy, _ := hashPassword("kestrel")
	return &auth{
		settings: settings.New(st),
		read:     db.New(st.Read()),
		write:    db.New(st.Write()),
		clock:    clock,
		basePath: path,
		throttle: newThrottle(),
		dummy:    dummy,
	}
}

func (a *auth) account(ctx context.Context) (acc account, ok bool, err error) {
	raw, ok, err := a.settings.Get(ctx, accountKey)
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
	sessionID string // set when the request carries a live session
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
		ip, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			ip = r.RemoteAddr
		}
		info := &request{ip: ip, secure: r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")}
		r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, info))

		if p := csrfCheck(r); p != nil {
			p.write(w)
			return
		}

		_, exists, err := a.account(r.Context())
		if err != nil {
			problem(http.StatusInternalServerError, "internal", "internal error").write(w)
			return
		}
		route := r.Method + " " + strings.TrimPrefix(r.URL.Path, apiRoot)
		if !exists {
			switch route {
			case "GET /setup", "GET /system", "POST /setup/account":
				next.ServeHTTP(w, r)
			default:
				problem(http.StatusUnauthorized, "setup_required", "create the admin account first").write(w)
			}
			return
		}

		if c, err := r.Cookie(cookieName); err == nil && c.Value != "" {
			id := hashToken(c.Value)
			if a.slide(r.Context(), id) {
				info.sessionID = id
				w.Header().Set("Set-Cookie", a.cookie(c.Value, info.secure, a.clock().Add(sessionLife)))
			}
		}
		if info.sessionID == "" && route != "POST /auth/login" {
			problem(http.StatusUnauthorized, "unauthenticated", "log in first").write(w)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// slide extends a live session by another 30 days and reports whether it was live.
func (a *auth) slide(ctx context.Context, id string) bool {
	now := a.clock()
	if _, err := a.read.LiveSession(ctx, db.LiveSessionParams{ID: id, ExpiresAt: now.Unix()}); err != nil {
		return false
	}
	return a.write.SlideSession(ctx, db.SlideSessionParams{ID: id, ExpiresAt: now.Add(sessionLife).Unix()}) == nil
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

func (s *server) GetSetup(ctx context.Context, _ oapi.GetSetupRequestObject) (oapi.GetSetupResponseObject, error) {
	_, exists, err := s.auth.account(ctx)
	if err != nil {
		return nil, err
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
	out.Sections.Language = oapi.Todo
	out.Sections.DownloadClient = oapi.Todo
	out.Sections.Indexer = oapi.Todo
	out.Sections.RootFolders = oapi.Todo
	out.Sections.Profiles = oapi.Todo
	return oapi.GetSetup200JSONResponse(out), nil
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
	username, password, perr := validateCredentials(req.Body)
	if perr != nil {
		return nil, perr
	}
	hash, err := hashPassword(password)
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
		Body:    oapi.Me{Username: username, Method: oapi.Session},
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
	acc, _, err := s.auth.account(ctx)
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
	acc, _, err := s.auth.account(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.GetMe200JSONResponse{Username: acc.Username, Method: oapi.Session}, nil
}

func (s *server) ChangePassword(ctx context.Context, req oapi.ChangePasswordRequestObject) (oapi.ChangePasswordResponseObject, error) {
	if req.Body == nil {
		return nil, invalid("body", "required", "current_password and new_password are required")
	}
	acc, _, err := s.auth.account(ctx)
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
	if acc.PasswordHash, err = hashPassword(next); err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(acc)
	if err := s.auth.settings.Put(ctx, accountKey, raw); err != nil {
		return nil, err
	}
	if err := s.auth.write.DeleteOtherSessions(ctx, requestFrom(ctx).sessionID); err != nil {
		return nil, err
	}
	return oapi.ChangePassword204Response{}, nil
}

// ---- pruning ----

// PruneSessions deletes sessions that expired at or before now and reports how many.
func PruneSessions(ctx context.Context, st *store.Store, now time.Time) (int64, error) {
	return db.New(st.Write()).PruneSessions(ctx, now.Unix())
}

// RunSessionPruner prunes expired sessions at start and then every interval,
// until ctx ends. It stands in for the jobs reconciler that will own this later.
func RunSessionPruner(ctx context.Context, st *store.Store, every time.Duration, logger *slog.Logger) {
	run := func() {
		n, err := PruneSessions(ctx, st, time.Now())
		switch {
		case err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, sql.ErrConnDone):
			logger.Error("prune sessions", "err", err)
		case n > 0:
			logger.Info("pruned expired sessions", "count", n)
		}
	}
	run()
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}
