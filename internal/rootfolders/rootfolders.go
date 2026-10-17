// Package rootfolders holds the Root folders Imports put Titles in: one or
// more absolute paths per kind, the first being the default when adding a
// Title. A folder is checked to exist, be a directory and be writable when it
// is saved.
package rootfolders

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/hyprsh/kestrel/internal/settings"
)

const key = "root_folders"

// Folders are the Root folders per kind.
type Folders struct {
	Movies []string `json:"movies"`
	Series []string `json:"series"`
}

// Patch replaces the named lists; nil lists stay.
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

// Set replaces the named lists after checking every folder in them. A rejected
// patch changes nothing.
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
	for _, kind := range []struct {
		name string
		set  bool
		list []string
	}{{"movies", p.Movies != nil, f.Movies}, {"series", p.Series != nil, f.Series}} {
		if !kind.set {
			continue
		}
		if len(kind.list) == 0 {
			return Folders{}, &ValidationError{Field: "root_folders." + kind.name, Code: "required", Message: "Add at least one folder"}
		}
		for i, path := range kind.list {
			if verr := check(path); verr != nil {
				verr.Field = fmt.Sprintf("root_folders.%s[%d]", kind.name, i)
				return Folders{}, verr
			}
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
