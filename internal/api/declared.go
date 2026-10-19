package api

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/hyprsh/kestrel/internal/api/db"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/settings"
)

// Declared brings the state the API owns to a Config File's: the account, the
// reverse proxy and setup completion (ADR 0014). Its Check methods validate
// with the API's own rules and write nothing; its Declare methods write only
// what differs from the file, so a second start with the same file writes
// nothing.
type Declared struct {
	settings *settings.Settings
	write    *db.Queries
	cost     hashCost
	setup    setupSources
}

// NewDeclared returns the API's side of applying a Config File, over the same
// store and modules as New.
func NewDeclared(opts Options, d Deps) *Declared {
	cost := productionCost
	if opts.CheapPasswordHash {
		cost = cheapCost
	}
	cfg := settings.New(opts.Store)
	return &Declared{
		settings: cfg,
		write:    db.New(opts.Store.Write()),
		cost:     cost,
		setup:    setupSources{settings: cfg, plugins: d.Plugins, profiles: d.Profiles, rootFolders: d.RootFolders},
	}
}

// CheckAccount applies POST /setup/account's rules to the declared account.
// The error names the password's variable, never its value.
func (d *Declared) CheckAccount(a configfile.Account) error {
	if strings.TrimSpace(a.Username) == "" {
		return errors.New("account.username: username is required")
	}
	if utf8.RuneCountInString(string(a.Password)) < minPasswordLn {
		return errors.New("account.password_env: the password in " + a.PasswordEnv + " must be at least 8 characters")
	}
	return nil
}

// DeclareAccount creates the account, or renames it and sets its password
// where they differ from the file. A changed password ends every session, as
// `kestrel reset-password` does.
func (d *Declared) DeclareAccount(ctx context.Context, a configfile.Account) error {
	username, password := strings.TrimSpace(a.Username), string(a.Password)
	acc, exists, err := loadAccount(ctx, d.settings)
	if err != nil {
		return err
	}
	if exists && acc.Username == username && verifyPassword(password, acc.PasswordHash) {
		return nil
	}
	passwordChanged := !exists || !verifyPassword(password, acc.PasswordHash)
	acc.Username = username
	if passwordChanged {
		if acc.PasswordHash, err = hashWith(password, d.cost); err != nil {
			return err
		}
	}
	raw, _ := json.Marshal(acc)
	if err := d.settings.Put(ctx, accountKey, raw); err != nil {
		return err
	}
	if exists && passwordChanged {
		return d.write.DeleteAllSessions(ctx)
	}
	return nil
}

// CheckReverseProxy applies PUT /settings/reverse-proxy's rules to the declared section.
func (d *Declared) CheckReverseProxy(p configfile.ReverseProxy) error {
	if perr := declaredProxy(p).validate(); perr != nil {
		return declaredField("reverse_proxy", perr)
	}
	return nil
}

// DeclareReverseProxy saves the declared reverse proxy when it differs from the stored one.
func (d *Declared) DeclareReverseProxy(ctx context.Context, p configfile.ReverseProxy) error {
	want := declaredProxy(p)
	cur, err := loadProxyConfig(ctx, d.settings)
	if err != nil {
		return err
	}
	if cur.Enabled == want.Enabled && cur.Header == want.Header && slices.Equal(cur.TrustedProxies, want.TrustedProxies) {
		return nil
	}
	raw, _ := json.Marshal(want)
	return d.settings.Put(ctx, reverseProxyKey, raw)
}

func declaredProxy(p configfile.ReverseProxy) proxyConfig {
	cfg := proxyConfig{Enabled: p.Enabled != nil && *p.Enabled, TrustedProxies: p.TrustedProxies, Header: strings.TrimSpace(p.Header)}
	if cfg.TrustedProxies == nil {
		cfg.TrustedProxies = []string{}
	}
	return cfg
}

// CompleteSetup marks setup completed when no section is left to do. It never
// un-completes it.
func (d *Declared) CompleteSetup(ctx context.Context) error {
	st, err := d.setup.state(ctx)
	if err != nil || st.Completed || len(todo(st)) > 0 {
		return err
	}
	return d.settings.Put(ctx, setupCompletedKey, []byte("true"))
}

// declaredField words a rejected field under its Config File section.
func declaredField(section string, p *problemError) error {
	if len(p.fields) == 0 {
		return errors.New(section + ": " + p.detail)
	}
	return errors.New(section + "." + p.fields[0].Field + ": " + p.fields[0].Message)
}
