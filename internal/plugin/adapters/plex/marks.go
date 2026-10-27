package plex

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"path"
	"slices"
	"strconv"
	"strings"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/mediahttp"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
)

// This file is the Plex side of ADR 0019's marks: finding a Title's item,
// labels, the smart collection and posters, all with the owner's token.

var _ mediaserver.Marker = (*Client)(nil)

// pageSize is how many items one section listing page holds.
const pageSize = 500

// Plex's item types in the query strings that edit metadata.
func typeNumber(k mediaserver.TitleKind) string {
	if k == mediaserver.KindSeries {
		return "2"
	}
	return "1"
}

func plexKind(t string) mediaserver.TitleKind {
	if t == "show" {
		return mediaserver.KindSeries
	}
	return mediaserver.KindMovie
}

// call sends one request; Plex's 404 is a not_found Error.
func (c *Client) call(ctx context.Context, conn plugin.Connection, method, p string, q url.Values, body []byte, contentType string) ([]byte, error) {
	base, err := mediahttp.BaseURL(conn)
	if err != nil {
		return nil, err
	}
	tok := conn.String("token")
	u := base + p
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	hdr := map[string]string{"X-Plex-Token": tok, "Accept": "application/json"}
	req := mediahttp.Request{Method: method, URL: u, Name: "Plex", Secret: tok, Header: hdr}
	if body != nil {
		req.Body = bytes.NewReader(body)
		hdr["Content-Type"] = contentType
	}
	status, raw, err := mediahttp.Do(ctx, c.http, req)
	if status == http.StatusNotFound {
		return nil, plugin.Errorf(plugin.CodeNotFound, "Plex does not have %s", p)
	}
	return raw, err
}

func (c *Client) getJSON(ctx context.Context, conn plugin.Connection, p string, q url.Values, out any) error {
	raw, err := c.call(ctx, conn, http.MethodGet, p, q, nil, "")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return plugin.Errorf(plugin.CodeUnavailable, "that is not a Plex server (is the URL right?)")
	}
	return nil
}

// ---- finding items ----

type guid struct{ ID string }

type metadata struct {
	RatingKey string
	Type      string
	Thumb     string
	Guid      []guid
	Label     []struct{ Tag string }
	Location  []struct{ Path string }
	Media     []struct{ Part []struct{ File string } }
}

type metadataContainer struct {
	MediaContainer struct {
		TotalSize int
		Metadata  []metadata
	}
}

type typedSection struct {
	Key      string
	Type     string
	Location []struct{ Path string }
}

func (c *Client) typedSections(ctx context.Context, conn plugin.Connection) ([]typedSection, error) {
	var out struct {
		MediaContainer struct{ Directory []typedSection }
	}
	if err := c.getJSON(ctx, conn, "/library/sections", nil, &out); err != nil {
		return nil, err
	}
	return out.MediaContainer.Directory, nil
}

// listSection reads every item of a section, with its guids, page by page.
func (c *Client) listSection(ctx context.Context, conn plugin.Connection, s typedSection) ([]metadata, error) {
	var all []metadata
	for start := 0; ; {
		var page metadataContainer
		q := url.Values{
			"includeGuids":           {"1"},
			"X-Plex-Container-Start": {strconv.Itoa(start)},
			"X-Plex-Container-Size":  {strconv.Itoa(pageSize)},
		}
		if err := c.getJSON(ctx, conn, "/library/sections/"+url.PathEscape(s.Key)+"/all", q, &page); err != nil {
			return nil, err
		}
		all = append(all, page.MediaContainer.Metadata...)
		start += len(page.MediaContainer.Metadata)
		if len(page.MediaContainer.Metadata) == 0 || start >= page.MediaContainer.TotalSize {
			return all, nil
		}
	}
}

// folders lists the folders an item lives in: a Series' locations, a Movie's
// files' directories.
func (m metadata) folders() []string {
	var out []string
	for _, l := range m.Location {
		out = append(out, path.Clean(l.Path))
	}
	for _, md := range m.Media {
		for _, p := range md.Part {
			out = append(out, path.Dir(p.File))
		}
	}
	return out
}

func (m metadata) hasGuid(id string) bool {
	return slices.ContainsFunc(m.Guid, func(g guid) bool { return g.ID == id })
}

// FindItems matches each ref to an item by its folder first, which is exact,
// and by its TMDB (Movie) or TVDB (Series) guid when no item lives in that
// folder, as when Plex sees the library under another mount.
func (c *Client) FindItems(ctx context.Context, conn plugin.Connection, refs []mediaserver.ItemRef) ([]mediaserver.FoundItem, error) {
	if len(refs) == 0 {
		return nil, nil
	}
	secs, err := c.typedSections(ctx, conn)
	if err != nil {
		return nil, err
	}
	type listed struct {
		sec   typedSection
		items []metadata
	}
	lists := map[mediaserver.TitleKind][]listed{}
	for _, kind := range []mediaserver.TitleKind{mediaserver.KindMovie, mediaserver.KindSeries} {
		if !slices.ContainsFunc(refs, func(r mediaserver.ItemRef) bool { return r.Kind == kind }) {
			continue
		}
		for _, s := range secs {
			if plexKind(s.Type) != kind || (s.Type != "movie" && s.Type != "show") {
				continue
			}
			items, err := c.listSection(ctx, conn, s)
			if err != nil {
				return nil, err
			}
			lists[kind] = append(lists[kind], listed{s, items})
		}
	}
	var out []mediaserver.FoundItem
	for i, ref := range refs {
		want := path.Clean(ref.Path)
		var found *mediaserver.Item
		for _, l := range lists[ref.Kind] {
			for _, it := range l.items {
				if ref.Path != "" && slices.Contains(it.folders(), want) {
					found = &mediaserver.Item{ID: it.RatingKey, SectionKey: l.sec.Key, Kind: ref.Kind}
				}
			}
		}
		if found == nil {
			id := ""
			switch {
			case ref.Kind == mediaserver.KindMovie && ref.TMDBID != 0:
				id = "tmdb://" + strconv.Itoa(ref.TMDBID)
			case ref.Kind == mediaserver.KindSeries && ref.TVDBID != 0:
				id = "tvdb://" + strconv.Itoa(ref.TVDBID)
			}
			for _, l := range lists[ref.Kind] {
				for _, it := range l.items {
					if id != "" && found == nil && it.hasGuid(id) {
						found = &mediaserver.Item{ID: it.RatingKey, SectionKey: l.sec.Key, Kind: ref.Kind}
					}
				}
			}
		}
		if found != nil {
			out = append(out, mediaserver.FoundItem{Ref: i, Item: *found})
		}
	}
	return out, nil
}

// ---- labels ----

func (c *Client) item(ctx context.Context, conn plugin.Connection, item mediaserver.Item) (metadata, error) {
	var out metadataContainer
	if err := c.getJSON(ctx, conn, "/library/metadata/"+url.PathEscape(item.ID), nil, &out); err != nil {
		return metadata{}, err
	}
	if len(out.MediaContainer.Metadata) == 0 {
		return metadata{}, plugin.Errorf(plugin.CodeNotFound, "Plex does not have item %s", item.ID)
	}
	return out.MediaContainer.Metadata[0], nil
}

func (m metadata) labels() []string {
	var out []string
	for _, l := range m.Label {
		out = append(out, l.Tag)
	}
	return out
}

func hasTag(tags []string, tag string) bool {
	return slices.ContainsFunc(tags, func(t string) bool { return strings.EqualFold(t, tag) })
}

func (c *Client) editLabels(ctx context.Context, conn plugin.Connection, item mediaserver.Item, q url.Values) error {
	q.Set("type", typeNumber(item.Kind))
	q.Set("id", item.ID)
	q.Set("label.locked", "1")
	_, err := c.call(ctx, conn, http.MethodPut, "/library/sections/"+url.PathEscape(item.SectionKey)+"/all", q, nil, "")
	return err
}

// AddLabels sends the item's whole label list, because Plex replaces the list
// with the one it is given.
func (c *Client) AddLabels(ctx context.Context, conn plugin.Connection, item mediaserver.Item, labels []string) ([]string, error) {
	m, err := c.item(ctx, conn, item)
	if err != nil {
		return nil, err
	}
	have := m.labels()
	var added []string
	for _, l := range labels {
		if !hasTag(have, l) && !hasTag(added, l) {
			added = append(added, l)
		}
	}
	if len(added) == 0 {
		return nil, nil
	}
	q := url.Values{}
	for i, l := range append(slices.Clone(have), added...) {
		q.Set("label["+strconv.Itoa(i)+"].tag.tag", l)
	}
	return added, c.editLabels(ctx, conn, item, q)
}

func (c *Client) RemoveLabels(ctx context.Context, conn plugin.Connection, item mediaserver.Item, labels []string) error {
	m, err := c.item(ctx, conn, item)
	if err != nil {
		return err
	}
	have := m.labels()
	for _, l := range labels {
		if !hasTag(have, l) {
			continue
		}
		if err := c.editLabels(ctx, conn, item, url.Values{"label[].tag.tag-": {l}}); err != nil {
			return err
		}
	}
	return nil
}

// ---- the smart collection ----

type collection struct {
	RatingKey string
	Title     string
	Smart     any
	Content   string
}

func (k collection) smart() bool {
	switch v := k.Smart.(type) {
	case bool:
		return v
	case string:
		return v == "1" || v == "true"
	case float64:
		return v == 1
	}
	return false
}

func (c *Client) sectionType(ctx context.Context, conn plugin.Connection, key string) (typedSection, error) {
	secs, err := c.typedSections(ctx, conn)
	if err != nil {
		return typedSection{}, err
	}
	for _, s := range secs {
		if s.Key == key {
			return s, nil
		}
	}
	return typedSection{}, plugin.Errorf(plugin.CodeNotFound, "Plex has no library section %s", key)
}

// labelID is the id Plex gives a label in a section, which a smart filter names; "" when no item has it.
func (c *Client) labelID(ctx context.Context, conn plugin.Connection, sectionKey, label string) (string, error) {
	var out struct {
		MediaContainer struct{ Directory []struct{ Key, Title string } }
	}
	if err := c.getJSON(ctx, conn, "/library/sections/"+url.PathEscape(sectionKey)+"/label", nil, &out); err != nil {
		return "", err
	}
	for _, d := range out.MediaContainer.Directory {
		if strings.EqualFold(d.Title, label) {
			return d.Key, nil
		}
	}
	return "", nil
}

// collections lists the section's collections.
func (c *Client) collections(ctx context.Context, conn plugin.Connection, sectionKey string) ([]collection, error) {
	var out struct {
		MediaContainer struct{ Metadata []collection }
	}
	if err := c.getJSON(ctx, conn, "/library/sections/"+url.PathEscape(sectionKey)+"/collections", nil, &out); err != nil {
		return nil, err
	}
	return out.MediaContainer.Metadata, nil
}

func filtersOn(content, labelID string) bool {
	return labelID != "" && strings.Contains(content, "label="+labelID)
}

func (c *Client) EnsureCollection(ctx context.Context, conn plugin.Connection, sectionKey, name, label string) error {
	sec, err := c.sectionType(ctx, conn, sectionKey)
	if err != nil {
		return err
	}
	id, err := c.labelID(ctx, conn, sectionKey, label)
	if err != nil {
		return err
	}
	if id == "" {
		return plugin.Errorf(plugin.CodeUnavailable, "Plex does not list the label %s in section %s yet", label, sectionKey)
	}
	var machine struct {
		MediaContainer struct{ MachineIdentifier string }
	}
	if err := c.getJSON(ctx, conn, "/", nil, &machine); err != nil {
		return err
	}
	kind := plexKind(sec.Type)
	uri := "server://" + machine.MediaContainer.MachineIdentifier + "/com.plexapp.plugins.library/library/sections/" + sectionKey +
		"/all?type=" + typeNumber(kind) + "&label=" + id
	existing, err := c.collections(ctx, conn, sectionKey)
	if err != nil {
		return err
	}
	for _, k := range existing {
		if k.Title != name || !k.smart() {
			continue
		}
		if filtersOn(k.Content, id) {
			return nil
		}
		_, err := c.call(ctx, conn, http.MethodPut, "/library/collections/"+url.PathEscape(k.RatingKey)+"/items", url.Values{"uri": {uri}}, nil, "")
		return err
	}
	_, err = c.call(ctx, conn, http.MethodPost, "/library/collections", url.Values{
		"type": {typeNumber(kind)}, "title": {name}, "smart": {"1"}, "sectionId": {sectionKey}, "uri": {uri},
	}, nil, "")
	return err
}

func (c *Client) RemoveCollection(ctx context.Context, conn plugin.Connection, sectionKey, name, label string) error {
	existing, err := c.collections(ctx, conn, sectionKey)
	if err != nil {
		return err
	}
	var mine []collection
	for _, k := range existing {
		if k.Title == name && k.smart() {
			mine = append(mine, k)
		}
	}
	if len(mine) == 0 {
		return nil
	}
	id, err := c.labelID(ctx, conn, sectionKey, label)
	if err != nil {
		return err
	}
	for _, k := range mine {
		// A smart collection on another filter is somebody else's.
		if k.Content != "" && !filtersOn(k.Content, id) {
			continue
		}
		if _, err := c.call(ctx, conn, http.MethodDelete, "/library/collections/"+url.PathEscape(k.RatingKey), nil, nil, ""); err != nil {
			return err
		}
	}
	return nil
}

// ---- posters ----

func (c *Client) Posters(ctx context.Context, conn plugin.Connection, item mediaserver.Item) ([]mediaserver.Poster, error) {
	var out struct {
		MediaContainer struct {
			Metadata []struct {
				RatingKey string
				Selected  any
			}
		}
	}
	if err := c.getJSON(ctx, conn, "/library/metadata/"+url.PathEscape(item.ID)+"/posters", nil, &out); err != nil {
		return nil, err
	}
	var posters []mediaserver.Poster
	for _, p := range out.MediaContainer.Metadata {
		sel := false
		switch v := p.Selected.(type) {
		case bool:
			sel = v
		case string:
			sel = v == "1" || v == "true"
		case float64:
			sel = v == 1
		}
		posters = append(posters, mediaserver.Poster{Key: p.RatingKey, Selected: sel})
	}
	return posters, nil
}

func (c *Client) PosterImage(ctx context.Context, conn plugin.Connection, item mediaserver.Item) (mediaserver.Image, error) {
	m, err := c.item(ctx, conn, item)
	if err != nil {
		return mediaserver.Image{}, err
	}
	thumb := m.Thumb
	if thumb == "" {
		return mediaserver.Image{}, plugin.Errorf(plugin.CodeNotFound, "item %s has no poster", item.ID)
	}
	raw, err := c.call(ctx, conn, http.MethodGet, thumb, nil, nil, "")
	if err != nil {
		return mediaserver.Image{}, err
	}
	return mediaserver.Image{ContentType: http.DetectContentType(raw), Data: raw}, nil
}

func (c *Client) UploadPoster(ctx context.Context, conn plugin.Connection, item mediaserver.Item, img mediaserver.Image) (mediaserver.Poster, error) {
	before, err := c.Posters(ctx, conn, item)
	if err != nil {
		return mediaserver.Poster{}, err
	}
	if _, err := c.call(ctx, conn, http.MethodPost, "/library/metadata/"+url.PathEscape(item.ID)+"/posters", nil, img.Data, img.ContentType); err != nil {
		return mediaserver.Poster{}, err
	}
	after, err := c.Posters(ctx, conn, item)
	if err != nil {
		return mediaserver.Poster{}, err
	}
	var got *mediaserver.Poster
	for i, p := range after {
		if !slices.ContainsFunc(before, func(b mediaserver.Poster) bool { return b.Key == p.Key }) {
			got = &after[i]
		}
	}
	if got == nil { // the same image was uploaded before: it keeps its key
		for i, p := range after {
			if p.Selected && strings.HasPrefix(p.Key, "upload://") {
				got = &after[i]
			}
		}
	}
	if got == nil {
		return mediaserver.Poster{}, plugin.Errorf(plugin.CodeUnavailable, "Plex did not list the uploaded poster")
	}
	if !got.Selected {
		if err := c.SelectPoster(ctx, conn, item, got.Key); err != nil {
			return mediaserver.Poster{}, err
		}
		got.Selected = true
	}
	return *got, nil
}

func (c *Client) SelectPoster(ctx context.Context, conn plugin.Connection, item mediaserver.Item, key string) error {
	_, err := c.call(ctx, conn, http.MethodPut, "/library/metadata/"+url.PathEscape(item.ID)+"/poster", url.Values{"url": {key}}, nil, "")
	return err
}
