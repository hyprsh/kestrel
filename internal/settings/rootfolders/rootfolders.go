// Package rootfolders holds the Root folders Imports put Titles in: one or
// more absolute paths per kind, the first being the default when adding a
// Title. A folder is checked to exist, be a directory and be writable when it
// is saved.
package rootfolders

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"github.com/hyprsh/kestrel/internal/settings"
)

const key = "root_folders"

// Folders are the Root folders per kind.
type Folders struct {
	Movies []string `json:"movies"`
	Series []string `json:"series"`
}

// Patch replaces the named lists; nil ones stay.
type Patch struct {
	Movies *[]string
	Series *[]string
}

// ValidationError is a rejected folder. Field is an API field name such as
// root_folders.movies[0].
type ValidationError struct {
	Field, Code, Message string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Message }

// Service reads and writes the Root folders.
type Service struct {
	settings *settings.Settings
	dataDir  string
}

// InTx returns a Service that saves through tx; the caller commits or rolls back.
func (s *Service) InTx(tx *sql.Tx) *Service {
	return &Service{settings: s.settings.InTx(tx), dataDir: s.dataDir}
}

// New returns a Service. dataDir prefills the folders until they are saved.
func New(s *settings.Settings, dataDir string) *Service {
	return &Service{settings: s, dataDir: dataDir}
}

// Get returns the Root folders and whether they were ever saved. Unsaved, it
// reports the prefilled <data dir>/media/movies and <data dir>/media/tv.
func (s *Service) Get(ctx context.Context) (Folders, bool, error) {
	raw, ok, err := s.settings.Get(ctx, key)
	if err != nil {
		return Folders{}, false, err
	}
	if !ok {
		return Folders{
			Movies: []string{filepath.Join(s.dataDir, "media", "movies")},
			Series: []string{filepath.Join(s.dataDir, "media", "tv")},
		}, false, nil
	}
	var f Folders
	if err := json.Unmarshal(raw, &f); err != nil {
		return Folders{}, false, fmt.Errorf("rootfolders: stored %s: %w", key, err)
	}
	return f, true, nil
}

// Set replaces the named lists after checking every folder in them. A
// rejected patch changes nothing.
func (s *Service) Set(ctx context.Context, p Patch) (Folders, error) {
	f, _, err := s.Get(ctx)
	if err != nil {
		return Folders{}, err
	}
	if p.Movies != nil {
		f.Movies = *p.Movies
	}
	if p.Series != nil {
		f.Series = *p.Series
	}
	if p.Movies != nil {
		if verr := checkList("movies", f.Movies); verr != nil {
			return Folders{}, verr
		}
	}
	if p.Series != nil {
		if verr := checkList("series", f.Series); verr != nil {
			return Folders{}, verr
		}
	}
	raw, err := json.Marshal(f)
	if err != nil {
		return Folders{}, err
	}
	if err := s.settings.Put(ctx, key, raw); err != nil {
		return Folders{}, err
	}
	return f, nil
}

// Check applies Set's rules to both lists without saving them. A rejection is
// a *ValidationError.
func Check(f Folders) error {
	if verr := checkList("movies", f.Movies); verr != nil {
		return verr
	}
	if verr := checkList("series", f.Series); verr != nil {
		return verr
	}
	return nil
}

// checkList checks one kind's list, named by its key in root_folders.
func checkList(name string, list []string) *ValidationError {
	if len(list) == 0 {
		return &ValidationError{Field: "root_folders." + name, Code: "required", Message: "Add at least one folder"}
	}
	for i, path := range list {
		if verr := check(path); verr != nil {
			verr.Field = fmt.Sprintf("root_folders.%s[%d]", name, i)
			return verr
		}
	}
	return nil
}

func check(path string) *ValidationError {
	bad := func(code, msg string) *ValidationError { return &ValidationError{Code: code, Message: msg} }
	if path == "" {
		return bad("required", "Enter a folder")
	}
	if !filepath.IsAbs(path) {
		return bad("not_absolute", "Use an absolute path")
	}
	info, err := os.Stat(path)
	if err != nil {
		return bad("not_found", "This folder does not exist")
	}
	if !info.IsDir() {
		return bad("not_directory", "This is not a folder")
	}
	probe, err := os.CreateTemp(path, ".kestrel-write-check-*")
	if err != nil {
		return bad("not_writable", "Kestrel cannot write to this folder")
	}
	probe.Close()
	_ = os.Remove(probe.Name())
	return nil
}

// Why a Root folder cannot be picked for a Title.
var (
	// ErrNotConfigured means the requested folder is not one of the kind's Root folders.
	ErrNotConfigured = errors.New("not one of the Root folders")
	// ErrNoneSet means the kind has no Root folder at all.
	ErrNoneSet = errors.New("no Root folder is configured")
)

// Kind is what a Root folder holds: the "movie" or "series" of a Title's kind.
type Kind string

// The kinds of Root folder.
const (
	Movie  Kind = "movie"
	Series Kind = "series"
)

// NotConfiguredMessage is the 422 text for a Root folder that is not one of the
// kind's configured ones.
func (k Kind) NotConfiguredMessage() string {
	return "That is not one of the " + k.Noun() + " Root folders"
}

// Noun is the capitalised name the kind goes by in messages: "Movie" or "Series".
func (k Kind) Noun() string {
	if k == Series {
		return "Series"
	}
	return "Movie"
}

// of is the kind's folders.
func (f Folders) of(kind Kind) []string {
	if kind == Series {
		return f.Series
	}
	return f.Movies
}

// Pick is the Root folder a new Title goes in: the requested one, which must
// be configured for the kind, else the kind's first (its default).
func (f Folders) Pick(kind Kind, requested string) (string, error) {
	configured := f.of(kind)
	if requested != "" {
		if !slices.Contains(configured, requested) {
			return "", ErrNotConfigured
		}
		return requested, nil
	}
	if len(configured) == 0 {
		return "", ErrNoneSet
	}
	return configured[0], nil
}
