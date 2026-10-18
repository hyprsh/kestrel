package silo

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"
	"github.com/Silo-Server/silo-plugin-sdk/pkg/pluginsdk/manifest"
	"google.golang.org/protobuf/types/known/timestamppb"
)

//go:embed manifest.json
var manifestJSON []byte

// ManifestJSON is the embedded manifest.json, for runtime.ServeManifest.
func ManifestJSON() []byte { return manifestJSON }

// Manifest is the plugin's manifest stamped with the build's version. The
// checksum is the caller's to fill, as it depends on the binary.
func Manifest(version string) (*pluginv1.PluginManifest, error) {
	m, err := manifest.Load(manifestJSON)
	if err != nil {
		return nil, fmt.Errorf("load embedded manifest: %w", err)
	}
	if version != "" && version != "dev" {
		m.Version = strings.TrimPrefix(version, "v")
	}
	return m, nil
}

// Options configures a Router.
type Options struct {
	// HTTP is the client used for Kestrel; nil means one with a 30 s timeout.
	HTTP *http.Client
}

// Router is the request_router.v1 server. It keeps no state and no credentials:
// every call carries its connection.
type Router struct {
	pluginv1.UnimplementedRequestRouterServer
	opts Options
}

// NewRouter returns a Router.
func NewRouter(o Options) *Router { return &Router{opts: o} }

// settings is the connection's config blob. Silo request routes can override
// any key per tier; an empty value means Kestrel's default.
type settings struct {
	standardProfile, fourKProfile, rootFolder string
}

func settingsOf(c *pluginv1.RouterConnection) settings {
	m := c.GetConfig().AsMap()
	s, _ := m["standard_profile"].(string)
	u, _ := m["4k_profile"].(string)
	f, _ := m["root_folder"].(string)
	return settings{standardProfile: s, fourKProfile: u, rootFolder: f}
}

// slotOf maps a Silo tier to a Kestrel Slot.
func slotOf(q *pluginv1.RequestedQuality) (string, bool) {
	switch {
	case q.GetId() == "2160p" || q.GetIs4K():
		return "4k", true
	case q.GetId() == "1080p":
		return "standard", true
	}
	return "", false
}

func slotName(slot string) string {
	if slot == "4k" {
		return "4K"
	}
	return "Standard"
}

func qualityOf(slot string) string {
	if slot == "4k" {
		return "2160p"
	}
	return "1080p"
}

func (r *Router) client(c *pluginv1.RouterConnection) (*client, error) {
	if c == nil {
		return nil, errors.New("no Kestrel connection was given")
	}
	return newClient(r.opts.HTTP, c.GetBaseUrl(), c.GetApiKey())
}

func intID(s string) *int {
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return nil
	}
	return &n
}

// Fulfill turns the Silo Request into one Kestrel Request naming the Standard
// and/or 4K Slot and answers with one Target per Silo tier.
func (r *Router) Fulfill(ctx context.Context, in *pluginv1.FulfillRequest) (*pluginv1.FulfillResponse, error) {
	if len(in.GetConnections()) == 0 {
		return &pluginv1.FulfillResponse{Message: "no Kestrel connection is configured"}, nil
	}
	conn := in.GetConnections()[0]
	cl, err := r.client(conn)
	if err != nil {
		return nil, err
	}
	cfg := settingsOf(conn)
	d := in.GetRequest()

	var tiers []string // Kestrel Slots with a Silo target, in tier order
	var skipped []*pluginv1.FulfillmentTarget
	for _, q := range in.GetQualities() {
		slot, ok := slotOf(q)
		if !ok {
			skipped = append(skipped, &pluginv1.FulfillmentTarget{
				Quality: q.GetId(), ConnectionId: conn.GetId(), Status: "failed", Message: "Kestrel has no Slot for " + q.GetId(),
			})
			continue
		}
		if !slices.Contains(tiers, slot) {
			tiers = append(tiers, slot)
		}
	}
	if len(in.GetQualities()) == 0 {
		tiers = []string{"standard"}
	}
	if len(tiers) == 0 {
		return &pluginv1.FulfillResponse{Targets: skipped, Message: "no tier Kestrel can serve"}, nil
	}

	var slots []slotCreate
	for _, s := range tiers {
		sc := slotCreate{Slot: s}
		if p := map[string]string{"standard": cfg.standardProfile, "4k": cfg.fourKProfile}[s]; p != "" {
			sc.Profile = &p
		}
		slots = append(slots, sc)
	}

	body := requestCreate{
		Source:          "silo",
		SourceRequestID: idempotencyKey(d, slots, cfg.rootFolder),
		Requester:       requester{ID: strconv.FormatInt(d.GetRequesterUserId(), 10), Name: d.GetRequesterUsername()},
		Title:           requestTitle{Kind: "movie", TMDBID: intID(d.GetExternalIds()["tmdb"]), TVDBID: intID(d.GetExternalIds()["tvdb"])},
		Slots:           slots,
	}
	if cfg.rootFolder != "" {
		body.RootFolder = &cfg.rootFolder
	}
	if body.Requester.Name == "" {
		body.Requester.Name = "Silo user " + body.Requester.ID
	}
	if imdb := d.GetExternalIds()["imdb"]; imdb != "" {
		body.Title.IMDbID = &imdb
	}
	if d.GetMediaType() == "series" {
		body.Title.Kind = "series"
		if len(d.GetSeasons()) > 0 {
			seasons := make([]int, len(d.GetSeasons()))
			for i, s := range d.GetSeasons() {
				seasons[i] = int(s)
			}
			body.Seasons = &seasons
		}
	}

	req, err := cl.createRequest(ctx, body)
	var ae *apiError
	switch {
	case errors.As(err, &ae) && ae.Status == http.StatusUnprocessableEntity:
		return &pluginv1.FulfillResponse{Message: "Kestrel refused the Request: " + ae.Detail}, nil
	case err != nil:
		return nil, err
	}

	res := &pluginv1.FulfillResponse{Targets: skipped}
	for _, slot := range tiers {
		res.Targets = append(res.Targets, targetOf(conn.GetId(), req, slot))
	}
	return res, nil
}

// idempotencyKey makes a repeated Fulfill land on the same Kestrel Request:
// the descriptor has no Silo request id, so it is the requester, the Title,
// the seasons, the Slots asked for and the Root folder, so a route that now
// files the Title elsewhere is a new Kestrel Request.
func idempotencyKey(d *pluginv1.RequestDescriptor, slots []slotCreate, rootFolder string) string {
	ids := d.GetExternalIds()
	title := "tmdb:" + ids["tmdb"]
	if ids["tmdb"] == "" {
		title = "tvdb:" + ids["tvdb"]
	}
	if ids["tmdb"] == "" && ids["tvdb"] == "" {
		title = "imdb:" + ids["imdb"]
	}
	seasons := slices.Clone(d.GetSeasons())
	slices.Sort(seasons)
	var names []string
	for _, s := range slots {
		n := s.Slot
		if s.Profile != nil {
			n += "=" + *s.Profile
		}
		names = append(names, n)
	}
	slices.Sort(names)
	key := fmt.Sprintf("u%d/%s/%s/s%v/%s", d.GetRequesterUserId(), d.GetMediaType(), title, seasons, strings.Join(names, ","))
	if rootFolder != "" {
		key += "/r:" + rootFolder
	}
	return key
}

func rejection(reason *string) string {
	if reason == nil {
		return "Kestrel rejected the Request"
	}
	switch *reason {
	case "not_on_tvdb":
		return "Kestrel could not find this Series on TheTVDB"
	case "unknown_title":
		return "Kestrel does not know this Title"
	case "no_enabled_profile":
		return "Kestrel has no enabled Profile for this tier"
	}
	return "Kestrel rejected the Request: " + *reason
}

func targetOf(connID string, req kestrelRequest, slot string) *pluginv1.FulfillmentTarget {
	st := statusOf(req, slot)
	return &pluginv1.FulfillmentTarget{
		Quality: qualityOf(slot), ConnectionId: connID, ExternalId: strconv.FormatInt(req.ID, 10),
		ExternalStatus: st.ExternalStatus, Status: st.Status, Message: st.Message, Wording: st.Wording,
	}
}

func statusOf(req kestrelRequest, slot string) *pluginv1.TargetStatus {
	out := &pluginv1.TargetStatus{Quality: qualityOf(slot)}
	if req.Outcome == "rejected" {
		out.Status, out.Message = "failed", rejection(req.RejectReason)
		return out
	}
	s, ok := req.slot(slot)
	if !ok {
		out.Status, out.Message = "failed", "Kestrel has no "+slotName(slot)+" Version for this Request"
		return out
	}
	out.Status, out.ExternalStatus = s.Status, s.StatusLabel
	switch s.Status {
	case "failed":
		out.Message = "The Version was removed from Kestrel"
	case "queued":
		if s.StatusLabel == "Not released yet" {
			out.Wording = &pluginv1.RequestStatusWording{Label: "Not out yet", Detail: "Kestrel adds it once it is out."}
		}
	case "downloading":
		if d := s.Download; d != nil {
			p := &pluginv1.DownloadProgress{Phase: phaseOf(d.Phase), BytesTotal: d.BytesTotal, BytesLeft: d.BytesLeft, Downloads: 1}
			if p.BytesTotal <= 0 {
				p.BytesTotal, p.BytesLeft = 0, 0
			}
			p.BytesLeft = min(max(p.BytesLeft, 0), p.BytesTotal)
			if d.ETA != nil {
				p.EstimatedCompletion = timestamppb.New(time.Now().Add(time.Duration(*d.ETA) * time.Second))
			}
			out.Progress = p
		}
	}
	return out
}

func phaseOf(kestrel string) string {
	switch kestrel {
	case "queued", "downloading", "paused", "importing":
		return kestrel
	case "post_processing":
		return "importing"
	}
	return "downloading"
}

// CheckStatus reads the Kestrel Requests behind the Targets in one bulk call.
func (r *Router) CheckStatus(ctx context.Context, in *pluginv1.CheckStatusRequest) (*pluginv1.CheckStatusResponse, error) {
	conns := map[string]*pluginv1.RouterConnection{}
	for _, c := range in.GetConnections() {
		conns[c.GetId()] = c
	}
	byConn := map[string][]*pluginv1.TargetRef{}
	for _, t := range in.GetTargets() {
		byConn[t.GetConnectionId()] = append(byConn[t.GetConnectionId()], t)
	}
	res := &pluginv1.CheckStatusResponse{}
	for id, refs := range byConn {
		c, ok := conns[id]
		if !ok {
			return nil, fmt.Errorf("connection %q was not passed", id)
		}
		cl, err := r.client(c)
		if err != nil {
			return nil, err
		}
		var ids []int64
		for _, t := range refs {
			if n, err := strconv.ParseInt(t.GetExternalId(), 10, 64); err == nil && !slices.Contains(ids, n) {
				ids = append(ids, n)
			}
		}
		got, err := cl.requests(ctx, ids)
		if err != nil {
			return nil, err
		}
		for _, t := range refs {
			n, _ := strconv.ParseInt(t.GetExternalId(), 10, 64)
			slot := "standard"
			if t.GetQuality() == "2160p" {
				slot = "4k"
			}
			st := &pluginv1.TargetStatus{Quality: t.GetQuality(), ConnectionId: id, Status: "failed", Message: "Kestrel no longer has this Request"}
			if req, ok := got[n]; ok {
				st = statusOf(req, slot)
				st.ConnectionId = id
				st.Quality = t.GetQuality()
			}
			res.Statuses = append(res.Statuses, st)
		}
	}
	return res, nil
}

// ListConfigOptions fills the Standard Profile, 4K Profile and Root folder
// dropdowns from Kestrel. Root folders are offered for both kinds: one of the
// wrong kind for a Request is Kestrel's 422, surfaced as the Request's failure.
func (r *Router) ListConfigOptions(ctx context.Context, in *pluginv1.ListConfigOptionsRequest) (*pluginv1.ListConfigOptionsResponse, error) {
	cl, err := r.client(in.GetConnection())
	if err != nil {
		return nil, err
	}
	profiles, err := cl.profiles(ctx)
	if err != nil {
		return nil, err
	}
	roots, err := cl.rootFolders(ctx)
	if err != nil {
		return nil, err
	}
	folders := &pluginv1.ConfigOptionList{Options: []*pluginv1.ConfigOption{{Value: "", Label: "Kestrel default"}}}
	for _, p := range roots {
		folders.Options = append(folders.Options, &pluginv1.ConfigOption{Value: p, Label: p})
	}
	list := func(slot string) *pluginv1.ConfigOptionList {
		out := &pluginv1.ConfigOptionList{Options: []*pluginv1.ConfigOption{{Value: "", Label: "Kestrel default"}}}
		for _, p := range profiles {
			if p.Slot == slot && p.Enabled {
				out.Options = append(out.Options, &pluginv1.ConfigOption{Value: p.Key, Label: p.Name})
			}
		}
		return out
	}
	return &pluginv1.ListConfigOptionsResponse{OptionsByField: map[string]*pluginv1.ConfigOptionList{
		"standard_profile": list("standard"), "4k_profile": list("4k"), "root_folder": folders,
	}}, nil
}

// TestConnection authenticates with the API key and compares the API major.
func (r *Router) TestConnection(ctx context.Context, in *pluginv1.TestConnectionRequest) (*pluginv1.TestConnectionResponse, error) {
	cl, err := r.client(in.GetConnection())
	if err != nil {
		return &pluginv1.TestConnectionResponse{Message: err.Error()}, nil
	}
	major, version, err := cl.system(ctx)
	var ae *apiError
	switch {
	case errors.As(err, &ae) && ae.Status == http.StatusUnauthorized:
		return &pluginv1.TestConnectionResponse{Message: "Kestrel rejected the API key"}, nil
	case err != nil:
		return &pluginv1.TestConnectionResponse{Message: "Could not reach Kestrel: " + err.Error()}, nil
	case major != APIMajor:
		return &pluginv1.TestConnectionResponse{Message: fmt.Sprintf("Kestrel %s speaks API v%d but this plugin speaks v%d; install the plugin release that matches Kestrel", version, major, APIMajor)}, nil
	}
	return &pluginv1.TestConnectionResponse{Ok: true, Message: "Connected to Kestrel " + version}, nil
}

// Validate has no cross-connection rules.
func (r *Router) Validate(context.Context, *pluginv1.ValidateRequest) (*pluginv1.ValidateResponse, error) {
	return &pluginv1.ValidateResponse{}, nil
}
