package api

import (
	"context"
	"fmt"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
)

// untrustedWindow is how long a stray proxy header keeps the Warning up after its last sighting.
const untrustedWindow = 24 * time.Hour

// checkUntrustedProxy raises one Warning per address that keeps sending the
// reverse-proxy header without being a trusted proxy, and clears the ones that
// stopped, were trusted since, or whose feature is off.
func (s *server) checkUntrustedProxy(ctx context.Context, h *health.Service) error {
	cfg, err := s.auth.proxyConfig(ctx)
	if err != nil {
		return err
	}
	var keep []string
	if cfg.Enabled {
		rows, err := s.auth.read.ListUntrustedProxyHeaders(ctx)
		if err != nil {
			return err
		}
		for _, r := range rows {
			recent := s.opts.Clock().Sub(time.Unix(r.LastSeen, 0)) < untrustedWindow
			if r.Count < 2 || !recent || cfg.trusts(r.Ip) {
				continue
			}
			key := "untrusted_proxy:" + r.Ip
			keep = append(keep, key)
			err := h.Raise(ctx, health.Issue{
				Key: key, Kind: health.KindProxyHeader, Severity: health.Warning,
				Message: fmt.Sprintf("Proxy header received from an untrusted address (%s)", r.Ip),
			})
			if err != nil {
				return err
			}
		}
	}
	return h.ClearExcept(ctx, health.KindProxyHeader, keep...)
}
