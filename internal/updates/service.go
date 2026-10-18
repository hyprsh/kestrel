package updates

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/settings"
)

// Settings keys. The switch is "Check GitHub for updates" (default on); it also
// covers the TRaSH update check.
const (
	enabledKey = "check_github_updates"
	stateKey   = "update_check"

	// DefaultAPIBase is GitHub's REST API.
	DefaultAPIBase = "https://api.github.com"
	repo           = "hyprsh/kestrel"
	securityPrefix = "security_fix:"
)

// Deps are what New needs.
type Deps struct {
	Settings *settings.Settings
	Health   *health.Service
	// Version is the running version ("dev" and "edge" skip the comparison).
	Version string
	// APIBase is GitHub's API root; tests point it at a fake.
	APIBase string
	HTTP    *http.Client
	Clock   func() time.Time
}

// Service runs the check and remembers what it found.
type Service struct {
	d Deps
}

// New returns a Service.
func New(d Deps) *Service {
	if d.APIBase == "" {
		d.APIBase = DefaultAPIBase
	}
	if d.HTTP == nil {
		d.HTTP = &http.Client{Timeout: 20 * time.Second}
	}
	if d.Clock == nil {
		d.Clock = time.Now
	}
	return &Service{d}
}

// Info is what the last check found.
type Info struct {
	Running         string    `json:"-"`
	Latest          string    `json:"latest"` // without the leading v
	URL             string    `json:"url"`
	UpdateAvailable bool      `json:"update_available"`
	CheckedAt       time.Time `json:"checked_at"`
}

// Enabled reports the "Check GitHub for updates" switch.
func (s *Service) Enabled(ctx context.Context) bool {
	v, ok, err := s.d.Settings.Get(ctx, enabledKey)
	if err != nil || !ok {
		return true
	}
	var on bool
	return json.Unmarshal(v, &on) != nil || on
}

// SetEnabled flips the switch.
func (s *Service) SetEnabled(ctx context.Context, on bool) error {
	b, _ := json.Marshal(on)
	return s.d.Settings.Put(ctx, enabledKey, b)
}

// Info returns the last result; with the switch off it reports nothing.
func (s *Service) Info(ctx context.Context) Info {
	info := Info{Running: s.d.Version}
	if !s.Enabled(ctx) {
		return info
	}
	if v, ok, err := s.d.Settings.Get(ctx, stateKey); err == nil && ok {
		_ = json.Unmarshal(v, &info)
	}
	// Recompute against the running version: a stored result may predate an upgrade.
	info.UpdateAvailable = info.Latest != "" && Newer(info.Latest, s.d.Version)
	return info
}

type release struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
}

type advisory struct {
	GHSAID          string `json:"ghsa_id"`
	Summary         string `json:"summary"`
	State           string `json:"state"`
	Vulnerabilities []struct {
		Range   string `json:"vulnerable_version_range"`
		Patched string `json:"first_patched_version"`
	} `json:"vulnerabilities"`
}

// Check looks at GitHub once: the latest release and the published advisories.
// With the switch off it asks nothing and clears what an earlier check showed.
func (s *Service) Check(ctx context.Context) error {
	if !s.Enabled(ctx) {
		if err := s.d.Health.ClearExcept(ctx, health.KindSecurityFix); err != nil {
			return err
		}
		return s.d.Settings.Put(ctx, stateKey, []byte(`{}`))
	}
	var rel release
	found, err := s.get(ctx, "/repos/"+repo+"/releases/latest", &rel)
	if err != nil {
		return err
	}
	var advs []advisory
	if _, err := s.get(ctx, "/repos/"+repo+"/security-advisories", &advs); err != nil {
		return err
	}

	info := Info{CheckedAt: s.d.Clock().UTC()}
	if found {
		info.Latest, info.URL = strings.TrimPrefix(rel.TagName, "v"), rel.HTMLURL
	}
	b, _ := json.Marshal(info)
	if err := s.d.Settings.Put(ctx, stateKey, b); err != nil {
		return err
	}

	var keep []string
	for _, a := range advs {
		if a.State != "" && a.State != "published" {
			continue
		}
		for _, v := range a.Vulnerabilities {
			if !Covers(v.Range, s.d.Version) {
				continue
			}
			key := securityPrefix + a.GHSAID
			keep = append(keep, key)
			msg := fmt.Sprintf("Kestrel %s has a security fix: %s", s.d.Version, a.GHSAID)
			if v.Patched != "" {
				msg += ", update to >= " + strings.TrimPrefix(v.Patched, "v")
			}
			if err := s.d.Health.Raise(ctx, health.Issue{
				Key: key, Kind: health.KindSecurityFix, Severity: health.Warning, Message: msg,
			}); err != nil {
				return err
			}
			break
		}
	}
	return s.d.Health.ClearExcept(ctx, health.KindSecurityFix, keep...)
}

// get decodes a GET into out. A 404 reports found=false (no release yet).
func (s *Service) get(ctx context.Context, path string, out any) (found bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.d.APIBase+path, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "kestrel/"+s.d.Version)
	resp, err := s.d.HTTP.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return false, nil
	case resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests:
		return false, errors.New("GitHub rate limit reached; trying again at the next check")
	case resp.StatusCode != http.StatusOK:
		return false, fmt.Errorf("GitHub answered %s", resp.Status)
	}
	return true, json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(out)
}
