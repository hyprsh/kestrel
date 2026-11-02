package silo

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"
	"github.com/Silo-Server/silo-plugin-sdk/pkg/pluginsdk/manifest"
	"github.com/hyprsh/kestrel/internal/slot"
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

// defaultOption is the value of the "Kestrel default" entry in each dropdown.
// Silo's admin UI crashes on an option whose value is empty, so the default
// gets a value of its own. No Profile key or absolute Root folder can be it.
const defaultOption = "default"

// The two Silo tiers. Each maps to one Kestrel Slot (ADR 0024).
const (
	tier1080p = "1080p"
	tier2160p = "2160p"
)

var tiers = [...]string{tier1080p, tier2160p}

// settings is the connection's config blob. Silo request routes can override
// any key per tier; an empty value or defaultOption means Kestrel's default.
type settings struct {
	// slotOf and profileOf are the Slot each tier maps to (standard for 1080p
	// and 4k for 2160p unless the config says otherwise) and the Profile asked
	// for there, "" for the Slot's default.
	slotOf     map[string]slot.Slot
	profileOf  map[string]string
	rootFolder string
	// watchAhead is nil for Kestrel's default, else the chosen on or off.
	watchAhead *bool
	// shadowed lists the tiers whose profile key and alias are both set.
	shadowed []string
}

func settingsOf(c *pluginv1.RouterConnection) settings {
	m := c.GetConfig().AsMap()
	get := func(key string) string {
		v, _ := m[key].(string)
		if v == defaultOption {
			return ""
		}
		return v
	}
	out := settings{
		slotOf:     map[string]slot.Slot{tier1080p: slot.Standard, tier2160p: slot.FourK},
		profileOf:  map[string]string{},
		rootFolder: get("root_folder"),
	}
	for _, t := range tiers {
		if id := get(t + "_slot"); id != "" {
			out.slotOf[t] = slot.Slot(id)
		}
		// standard_profile and 4k_profile are aliases for the seeded Slots; the
		// per-tier key wins over them.
		var alias, aliasKey string
		switch out.slotOf[t] {
		case slot.Standard:
			aliasKey = "standard_profile"
		case slot.FourK:
			aliasKey = "4k_profile"
		}
		if aliasKey != "" {
			alias = get(aliasKey)
		}
		out.profileOf[t] = get(t + "_profile")
		switch {
		case out.profileOf[t] == "":
			out.profileOf[t] = alias
		case alias != "":
			out.shadowed = append(out.shadowed, t)
		}
	}
	switch get("watch_ahead") {
	case "on":
		out.watchAhead = new(true)
	case "off":
		out.watchAhead = new(false)
	}
	return out
}

// shadowLogged remembers the connections whose alias-versus-key clash was logged.
var shadowLogged sync.Map

// logShadowed says once per connection that a per-tier profile key beat the
// alias set next to it.
func logShadowed(connID string, cfg settings) {
	for _, t := range cfg.shadowed {
		if _, seen := shadowLogged.LoadOrStore(connID+"/"+t, true); seen {
			continue
		}
		alias := "standard_profile"
		if cfg.slotOf[t] == slot.FourK {
			alias = "4k_profile"
		}
		slog.Warn("kestrel plugin: both "+alias+" and "+t+"_profile are set; "+t+"_profile is used", "connection", connID, "tier", t)
	}
}

// tierOf names the Silo tier of a requested quality: 2160p for a 4K one, the
// id itself when it is a tier; ok is false for any other id.
func tierOf(q *pluginv1.RequestedQuality) (tier string, ok bool) {
	if q.GetIs4K() {
		return tier2160p, true
	}
	return tierOfID(q.GetId())
}

func tierOfID(id string) (string, bool) {
	if id == tier1080p || id == tier2160p {
		return id, true
	}
	return tier1080p, false
}

// slotOfTier is the Kestrel Slot a Silo tier id maps to. An unknown tier
// follows the 1080p mapping with ok false, and is logged.
func (s settings) slotOfTier(id string) (slot.Slot, bool) {
	tier, ok := tierOfID(id)
	if !ok {
		slog.Warn("kestrel plugin: Silo asked for an unknown tier; using the 1080p mapping", "tier", id)
	}
	return s.slotOf[tier], ok
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

// Fulfill turns the Silo Request into one Kestrel Request naming the Slots the
// asked tiers map to and answers with one Target per Silo tier.
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

	logShadowed(conn.GetId(), cfg)

	var asked []string // Silo tiers Kestrel serves, in the order asked
	var skipped []*pluginv1.FulfillmentTarget
	for _, q := range in.GetQualities() {
		tier, ok := tierOf(q)
		if !ok {
			slog.Warn("kestrel plugin: Silo asked for an unknown tier", "tier", q.GetId())
			skipped = append(skipped, &pluginv1.FulfillmentTarget{
				Quality: q.GetId(), ConnectionId: conn.GetId(), Status: "failed", Message: "Kestrel has no Slot for " + q.GetId(),
			})
			continue
		}
		if !slices.Contains(asked, tier) {
			asked = append(asked, tier)
		}
	}
	if len(in.GetQualities()) == 0 {
		asked = []string{tier1080p}
	}
	if len(asked) == 0 {
		return &pluginv1.FulfillResponse{Targets: skipped, Message: "no tier Kestrel can serve"}, nil
	}

	// One Kestrel Slot per distinct mapping; two tiers on one Slot share it.
	var slots []slotCreate
	for _, t := range asked {
		id := cfg.slotOf[t].Key()
		if slices.ContainsFunc(slots, func(sc slotCreate) bool { return sc.Slot == id }) {
			continue
		}
		sc := slotCreate{Slot: id}
		if p := cfg.profileOf[t]; p != "" {
			sc.Profile = &p
		}
		slots = append(slots, sc)
	}

	// The watch-ahead choice is left out of the key on purpose: a retry after
	// the setting changed must land on the same Kestrel Request.
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
		} else {
			body.WatchAhead = cfg.watchAhead
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
	for _, t := range asked {
		res.Targets = append(res.Targets, targetOf(conn.GetId(), req, t, cfg.slotOf[t]))
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

func targetOf(connID string, req kestrelRequest, tier string, sl slot.Slot) *pluginv1.FulfillmentTarget {
	st := statusOf(req, tier, sl)
	return &pluginv1.FulfillmentTarget{
		Quality: tier, ConnectionId: connID, ExternalId: strconv.FormatInt(req.ID, 10),
		ExternalStatus: st.ExternalStatus, Status: st.Status, Message: st.Message, Wording: st.Wording,
	}
}

func statusOf(req kestrelRequest, tier string, sl slot.Slot) *pluginv1.TargetStatus {
	out := &pluginv1.TargetStatus{Quality: tier}
	if req.Outcome == "rejected" {
		out.Status, out.Message = "failed", rejection(req.RejectReason)
		return out
	}
	s, ok := req.slot(sl.Key())
	if !ok {
		out.Status, out.Message = "failed", "Kestrel has no "+tier+" Version for this Request"
		return out
	}
	out.Status, out.ExternalStatus = s.Status, s.StatusLabel
	if s.Stalled && (s.Status == "queued" || s.Status == "downloading") {
		// A stalled download or Import: the cause stays in Kestrel for the admin.
		out.Wording = &pluginv1.RequestStatusWording{Label: "Taking longer than usual"}
	}
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
		cfg := settingsOf(c)
		for _, t := range refs {
			n, _ := strconv.ParseInt(t.GetExternalId(), 10, 64)
			sl, _ := cfg.slotOfTier(t.GetQuality())
			st := &pluginv1.TargetStatus{Quality: t.GetQuality(), ConnectionId: id, Status: "failed", Message: "Kestrel no longer has this Request"}
			if req, ok := got[n]; ok {
				st = statusOf(req, t.GetQuality(), sl)
				st.ConnectionId = id
				st.Quality = t.GetQuality()
			}
			res.Statuses = append(res.Statuses, st)
		}
	}
	return res, nil
}

// ListConfigOptions fills the Slot, Profile and Root folder dropdowns from
// Kestrel. Root folders are offered for both kinds: one of the
// wrong kind for a Request is Kestrel's 422, surfaced as the Request's failure.
// Silo's Test button lists options rather than calling TestConnection, so the
// API major is compared here first; client errors pass through unchanged for
// Silo's options probe.
func (r *Router) ListConfigOptions(ctx context.Context, in *pluginv1.ListConfigOptionsRequest) (*pluginv1.ListConfigOptionsResponse, error) {
	cl, err := r.client(in.GetConnection())
	if err != nil {
		return nil, err
	}
	major, version, err := cl.system(ctx)
	if err != nil {
		return nil, err
	}
	if major != APIMajor {
		return nil, errors.New(majorMismatch(version, major))
	}
	profiles, err := cl.profiles(ctx)
	if err != nil {
		return nil, err
	}
	roots, err := cl.rootFolders(ctx)
	if err != nil {
		return nil, err
	}
	slots, err := cl.slots(ctx)
	if err != nil {
		return nil, err
	}
	folders := &pluginv1.ConfigOptionList{Options: []*pluginv1.ConfigOption{{Value: defaultOption, Label: "Kestrel default"}}}
	for _, p := range roots {
		folders.Options = append(folders.Options, &pluginv1.ConfigOption{Value: p, Label: p})
	}
	slotList := &pluginv1.ConfigOptionList{Options: []*pluginv1.ConfigOption{{Value: defaultOption, Label: "Default"}}}
	for _, sl := range slots {
		slotList.Options = append(slotList.Options, &pluginv1.ConfigOption{Value: sl.ID, Label: sl.Label})
	}
	// Any enabled Profile can fill any Slot. The first option, the preselected
	// one, is the mapped Slot's own default Profile for each kind.
	list := func(sl slot.Slot) *pluginv1.ConfigOptionList {
		name := func(key *string) string {
			if key == nil {
				return "none"
			}
			for _, p := range profiles {
				if p.Key == *key {
					return p.Name
				}
			}
			return *key
		}
		label := "Kestrel default"
		if i := slices.IndexFunc(slots, func(s kestrelSlot) bool { return s.ID == sl.Key() }); i >= 0 {
			movies, series := name(slots[i].DefaultMovies), name(slots[i].DefaultSeries)
			label = "Slot default (" + movies + ")"
			if movies != series {
				label = "Slot default (Movies " + movies + ", Series " + series + ")"
			}
		}
		out := &pluginv1.ConfigOptionList{Options: []*pluginv1.ConfigOption{{Value: defaultOption, Label: label}}}
		for _, p := range profiles {
			if p.Enabled {
				out.Options = append(out.Options, &pluginv1.ConfigOption{Value: p.Key, Label: p.Name})
			}
		}
		return out
	}
	cfg := settingsOf(in.GetConnection())
	return &pluginv1.ListConfigOptionsResponse{OptionsByField: map[string]*pluginv1.ConfigOptionList{
		"standard_profile": list(slot.Standard), "4k_profile": list(slot.FourK),
		"1080p_slot": slotList, "2160p_slot": slotList,
		"1080p_profile": list(cfg.slotOf[tier1080p]), "2160p_profile": list(cfg.slotOf[tier2160p]),
		"root_folder": folders,
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
		return &pluginv1.TestConnectionResponse{Message: majorMismatch(version, major)}, nil
	}
	return &pluginv1.TestConnectionResponse{Ok: true, Message: "Connected to Kestrel " + version}, nil
}

// majorMismatch is the message for a Kestrel whose API major differs from
// APIMajor, shared by TestConnection and ListConfigOptions.
func majorMismatch(version string, major int) string {
	return fmt.Sprintf("Kestrel %s speaks API v%d but this plugin speaks v%d; install the plugin release that matches Kestrel", version, major, APIMajor)
}

// Validate fails a tier that maps to a Slot Kestrel does not have, naming the
// tier's field. It reads Kestrel's Slots with the connection; where Kestrel
// cannot be reached the mapping is left for Test connection to report.
func (r *Router) Validate(ctx context.Context, in *pluginv1.ValidateRequest) (*pluginv1.ValidateResponse, error) {
	res := &pluginv1.ValidateResponse{}
	c := in.GetConnection()
	cl, err := r.client(c)
	if err != nil {
		return res, nil
	}
	known, err := cl.slots(ctx)
	if err != nil {
		return res, nil
	}
	cfg := settingsOf(c)
	for _, t := range tiers {
		id := cfg.slotOf[t].Key()
		if !slices.ContainsFunc(known, func(sl kestrelSlot) bool { return sl.ID == id }) {
			if res.FieldErrors == nil {
				res.FieldErrors = map[string]string{}
			}
			res.FieldErrors[t+"_slot"] = fmt.Sprintf("Kestrel has no Slot %q for the %s tier", id, t)
		}
	}
	return res, nil
}
