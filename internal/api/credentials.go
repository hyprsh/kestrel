package api

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base32"
	"encoding/json"
	"errors"
	"net/http"
	"net/netip"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hyprsh/kestrel/internal/api/db"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
)

const (
	apiKeyKey       = "api_key"
	reverseProxyKey = "reverse_proxy"
	apiKeyPrefix    = "kst_"
	// apiKeyShown is how many leading characters of the key stay visible.
	apiKeyShown        = 8
	defaultProxyHeader = "Remote-User"
)

// storedKey is the API key as kept in settings: only its SHA-256 and prefix.
type storedKey struct {
	Hash      string `json:"hash"`
	Prefix    string `json:"prefix"`
	CreatedAt int64  `json:"created_at"`
}

// newStoredKey keeps key as it is stored: its hash and visible prefix.
func newStoredKey(key string, created time.Time) storedKey {
	return storedKey{Hash: hashToken(key), Prefix: key[:apiKeyShown], CreatedAt: created.Unix()}
}

// fromEnvironment reports whether KESTREL_API_KEY sets the key.
func (a *auth) fromEnvironment() bool { return a.fixedKey.Hash != "" }

func (a *auth) apiKey(ctx context.Context) (k storedKey, ok bool, err error) {
	if a.fromEnvironment() {
		return a.fixedKey, true, nil
	}
	raw, ok, err := a.settings.Get(ctx, apiKeyKey)
	if err != nil || !ok {
		return storedKey{}, false, err
	}
	return k, true, json.Unmarshal(raw, &k)
}

// dropGeneratedKey deletes the generated key while KESTREL_API_KEY is set, so
// it stays dead once the variable is removed again.
func (a *auth) dropGeneratedKey(ctx context.Context) error {
	if !a.fromEnvironment() {
		return nil
	}
	return a.settings.Delete(ctx, apiKeyKey)
}

// keyMatches reports whether presented is the current API key.
func (a *auth) keyMatches(ctx context.Context, presented string) (bool, error) {
	k, ok, err := a.apiKey(ctx)
	if err != nil || !ok {
		return false, err
	}
	return subtle.ConstantTimeCompare([]byte(hashToken(presented)), []byte(k.Hash)) == 1, nil
}

func (s *server) GetApiKey(ctx context.Context, _ oapi.GetApiKeyRequestObject) (oapi.GetApiKeyResponseObject, error) {
	k, ok, err := s.auth.apiKey(ctx)
	if err != nil {
		return nil, err
	}
	if !ok {
		return oapi.GetApiKey200JSONResponse{}, nil
	}
	created := time.Unix(k.CreatedAt, 0).UTC()
	return oapi.GetApiKey200JSONResponse{Prefix: &k.Prefix, CreatedAt: &created, FromEnvironment: s.auth.fromEnvironment()}, nil
}

func (s *server) CreateApiKey(ctx context.Context, _ oapi.CreateApiKeyRequestObject) (oapi.CreateApiKeyResponseObject, error) {
	if s.auth.fromEnvironment() {
		return nil, problem(http.StatusConflict, "conflict", "the API key is set by KESTREL_API_KEY; remove the variable to generate one here")
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	key := apiKeyPrefix + base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw)
	stored, _ := json.Marshal(newStoredKey(key, s.auth.clock()))
	if err := s.auth.settings.Put(ctx, apiKeyKey, stored); err != nil {
		return nil, err
	}
	return oapi.CreateApiKey201JSONResponse{Key: key}, nil
}

// ---- reverse proxy ----

type proxyConfig struct {
	Enabled        bool     `json:"enabled"`
	TrustedProxies []string `json:"trusted_proxies"`
	Header         string   `json:"header"`
}

func (a *auth) proxyConfig(ctx context.Context) (proxyConfig, error) {
	return loadProxyConfig(ctx, a.settings)
}

func loadProxyConfig(ctx context.Context, s *settings.Settings) (proxyConfig, error) {
	cfg := proxyConfig{TrustedProxies: []string{}, Header: defaultProxyHeader}
	raw, ok, err := s.Get(ctx, reverseProxyKey)
	if err != nil || !ok {
		return cfg, err
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, err
	}
	if cfg.TrustedProxies == nil {
		cfg.TrustedProxies = []string{}
	}
	return cfg, nil
}

// trusts reports whether ip is one of the configured proxy addresses.
func (c proxyConfig) trusts(ip string) bool {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return false
	}
	addr = addr.Unmap()
	for _, entry := range c.TrustedProxies {
		if p, err := netip.ParsePrefix(entry); err == nil {
			if p.Contains(addr) {
				return true
			}
		} else if a, err := netip.ParseAddr(entry); err == nil && a.Unmap() == addr {
			return true
		}
	}
	return false
}

// clientIP is the socket address, except behind a trusted proxy, where it is the
// right-most X-Forwarded-For address that is not itself a trusted proxy.
func (c proxyConfig) clientIP(socket string, forwardedFor []string) string {
	if !c.Enabled || !c.trusts(socket) {
		return socket
	}
	var hops []string
	for _, line := range forwardedFor {
		for _, h := range strings.Split(line, ",") {
			if h = strings.TrimSpace(h); h != "" {
				hops = append(hops, h)
			}
		}
	}
	for i := len(hops) - 1; i >= 0; i-- {
		if _, err := netip.ParseAddr(hops[i]); err == nil && !c.trusts(hops[i]) {
			return hops[i]
		}
	}
	return socket
}

var headerName = regexp.MustCompile(`^[A-Za-z0-9-]+$`)

func (c proxyConfig) validate() *problemError {
	if !headerName.MatchString(c.Header) {
		return invalid("header", "invalid", "header must be a plain header name such as Remote-User")
	}
	if c.Enabled && len(c.TrustedProxies) == 0 {
		return invalid("trusted_proxies", "required", "name at least one trusted proxy address before enabling")
	}
	for _, entry := range c.TrustedProxies {
		_, perr := netip.ParsePrefix(entry)
		_, aerr := netip.ParseAddr(entry)
		if perr != nil && aerr != nil {
			return invalid("trusted_proxies", "invalid", entry+" is not an IP address or CIDR range")
		}
	}
	return nil
}

func (a *auth) recordUntrusted(ctx context.Context, ip, value string) {
	// A failed bookkeeping write must not turn into a login problem.
	_ = a.write.RecordUntrustedProxyHeader(ctx, db.RecordUntrustedProxyHeaderParams{
		Ip: ip, Value: truncate(value, 200), FirstSeen: a.clock().Unix(),
	})
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

func (s *server) reverseProxyBody(ctx context.Context) (oapi.ReverseProxy, error) {
	cfg, err := s.auth.proxyConfig(ctx)
	if err != nil {
		return oapi.ReverseProxy{}, err
	}
	rows, err := s.auth.read.ListUntrustedProxyHeaders(ctx)
	if err != nil {
		return oapi.ReverseProxy{}, err
	}
	untrusted := make([]oapi.UntrustedProxyHeader, 0, len(rows))
	out := oapi.ReverseProxy{
		Enabled: cfg.Enabled, TrustedProxies: cfg.TrustedProxies, Header: cfg.Header, Untrusted: &untrusted,
		FromConfigFile: s.declares(configfile.SectionReverseProxy),
	}
	for _, r := range rows {
		untrusted = append(untrusted, oapi.UntrustedProxyHeader{
			Ip: r.Ip, Value: r.Value, Count: int(r.Count), LastSeen: time.Unix(r.LastSeen, 0).UTC(),
		})
	}
	return out, nil
}

func (s *server) GetReverseProxy(ctx context.Context, _ oapi.GetReverseProxyRequestObject) (oapi.GetReverseProxyResponseObject, error) {
	body, err := s.reverseProxyBody(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.GetReverseProxy200JSONResponse(body), nil
}

func (s *server) PutReverseProxy(ctx context.Context, req oapi.PutReverseProxyRequestObject) (oapi.PutReverseProxyResponseObject, error) {
	if req.Body == nil {
		return nil, invalid("body", "required", "settings are required")
	}
	if err := s.refuseDeclared(configfile.SectionReverseProxy); err != nil {
		return nil, err
	}
	cfg := proxyConfig{Enabled: req.Body.Enabled, TrustedProxies: req.Body.TrustedProxies, Header: strings.TrimSpace(req.Body.Header)}
	if cfg.TrustedProxies == nil {
		cfg.TrustedProxies = []string{}
	}
	if perr := cfg.validate(); perr != nil {
		return nil, perr
	}
	raw, _ := json.Marshal(cfg)
	if err := s.auth.settings.Put(ctx, reverseProxyKey, raw); err != nil {
		return nil, err
	}
	body, err := s.reverseProxyBody(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.PutReverseProxy200JSONResponse(body), nil
}

// ---- password reset ----

// ResetPassword sets a new admin password and ends every session. It backs
// `kestrel reset-password`, which runs against the config dir while the server
// may be running; the sessions table is shared, so it takes effect at once.
func ResetPassword(ctx context.Context, st *store.Store, password string) error {
	if utf8.RuneCountInString(password) < minPasswordLn {
		return errors.New("password must be at least 8 characters")
	}
	cfg := settings.New(st)
	raw, ok, err := cfg.Get(ctx, accountKey)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("no account exists yet: create it in the web UI first")
	}
	var acc account
	if err := json.Unmarshal(raw, &acc); err != nil {
		return err
	}
	if acc.PasswordHash, err = hashPassword(password); err != nil {
		return err
	}
	raw, _ = json.Marshal(acc)
	if err := cfg.Put(ctx, accountKey, raw); err != nil {
		return err
	}
	return db.New(st.Write()).DeleteAllSessions(ctx)
}
