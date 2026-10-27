package mediaserver

import (
	"context"

	"github.com/hyprsh/kestrel/internal/plugin"
)

// This file is the additive half of media_server.v1 (ADR 0019): marking a
// Title's item on a media server so the people sharing it see that it was
// requested. A server that can do it also implements Marker; one that cannot
// (Jellyfin, Silo) just stays a Server. Hosts look for it with a type
// assertion.

// Marker is a media server that can label items, keep a smart collection and
// replace posters. Every call is stateless and made with the server owner's
// connection, and an item the server no longer has is a not_found Error.
type Marker interface {
	Server

	// FindItems finds the server's item for each Title ref. A ref the server
	// does not list (yet) is left out of the answer, which is not an error.
	FindItems(ctx context.Context, conn plugin.Connection, refs []ItemRef) ([]FoundItem, error)

	// AddLabels gives the item the labels it lacks and answers which it added;
	// labels it had already are left alone and not answered.
	AddLabels(ctx context.Context, conn plugin.Connection, item Item, labels []string) (added []string, err error)
	// RemoveLabels takes the labels off the item; one it does not carry is skipped.
	RemoveLabels(ctx context.Context, conn plugin.Connection, item Item, labels []string) error

	// EnsureCollection creates or updates the smart collection named name in
	// the library section, holding the section's items that carry label.
	EnsureCollection(ctx context.Context, conn plugin.Connection, sectionKey, name, label string) error
	// RemoveCollection deletes that smart collection from the section, and only
	// that: a collection with the name that is not a smart collection on the
	// label is left alone. One that is not there is not an error.
	RemoveCollection(ctx context.Context, conn plugin.Connection, sectionKey, name, label string) error

	// Posters lists the posters the item can show, with the selected one marked.
	Posters(ctx context.Context, conn plugin.Connection, item Item) ([]Poster, error)
	// PosterImage reads the image the item shows now.
	PosterImage(ctx context.Context, conn plugin.Connection, item Item) (Image, error)
	// UploadPoster adds the image to the item's posters, selects it and answers
	// its identity. The identity is stable: Posters lists it under the same key.
	UploadPoster(ctx context.Context, conn plugin.Connection, item Item, img Image) (Poster, error)
	// SelectPoster makes the poster with that key the item's poster.
	SelectPoster(ctx context.Context, conn plugin.Connection, item Item, key string) error
}

// TitleKind is what a Title is, for finding its item.
type TitleKind string

const (
	KindMovie  TitleKind = "movie"
	KindSeries TitleKind = "series"
)

// ItemRef names a Title so the server can find its item: by the Title's folder
// as Kestrel sees it, or by its TMDB or TVDB id when the folder does not match.
type ItemRef struct {
	Kind   TitleKind `json:"kind"`
	Path   string    `json:"path"`
	TMDBID int       `json:"tmdb_id,omitempty"`
	TVDBID int       `json:"tvdb_id,omitempty"`
}

// Item is one item on the server.
type Item struct {
	// ID is the server's own id for the item (Plex's ratingKey).
	ID string `json:"id"`
	// SectionKey is the library section holding it.
	SectionKey string    `json:"section_key"`
	Kind       TitleKind `json:"kind"`
}

// FoundItem is the item found for ref number Ref of FindItems' refs.
type FoundItem struct {
	Ref  int  `json:"ref"`
	Item Item `json:"item"`
}

// Poster is one poster an item can show. Key is its identity on the server.
type Poster struct {
	Key      string `json:"key"`
	Selected bool   `json:"selected,omitempty"`
}

// Image is image bytes with their media type, e.g. image/jpeg.
type Image struct {
	ContentType string `json:"content_type"`
	Data        []byte `json:"data"`
}
