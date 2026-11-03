package sabnzbd

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// removeFolder deletes a completed job's storage folder when that is provably
// safe, and returns why it did not otherwise. SABnzbd reports paths as it sees
// them; Kestrel has no path mapping, so it reaches the same paths unchanged.
// The folder is removed only when all of these hold:
//
//   - storage and completeDir are absolute and carry no ".." element, so
//     nothing is resolved lexically to somewhere the OS would not go;
//   - storage is not a symlink and, with every symlink resolved, lies strictly
//     inside completeDir (also resolved), never the directory itself;
//   - it neither lies inside nor contains any keep path (the Library's Root
//     folders), and completeDir is not one of them or inside one, so a download
//     directory placed in the Library, or a storage that is the Library or a
//     parent of it, is left.
//
// An empty reason means the folder is gone, deleted now or before.
func removeFolder(storage, completeDir string, keep []string) (reason string) {
	if storage == "" {
		return "SABnzbd reported no folder"
	}
	if completeDir == "" {
		return "SABnzbd's complete directory is unknown"
	}
	if !cleanAbs(storage) || !cleanAbs(completeDir) {
		return "its path is not an absolute path SABnzbd and Kestrel agree on"
	}
	storage, completeDir = filepath.Clean(storage), filepath.Clean(completeDir)
	if !inside(completeDir, storage) {
		return "it is outside SABnzbd's complete directory"
	}
	info, err := os.Lstat(storage)
	if errors.Is(err, fs.ErrNotExist) {
		if _, derr := os.Stat(completeDir); derr != nil {
			return "Kestrel cannot reach SABnzbd's complete directory"
		}
		return "" // already gone
	}
	if err != nil {
		return "Kestrel cannot reach it: " + err.Error()
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "it is a symbolic link"
	}
	realStorage, err := filepath.EvalSymlinks(storage)
	if err != nil {
		return "Kestrel cannot reach it: " + err.Error()
	}
	realDir, err := filepath.EvalSymlinks(completeDir)
	if err != nil {
		return "Kestrel cannot reach SABnzbd's complete directory"
	}
	if !inside(realDir, realStorage) {
		return "it resolves outside SABnzbd's complete directory"
	}
	for _, k := range keep {
		if k == "" {
			continue
		}
		rk := filepath.Clean(k)
		if r, err := filepath.EvalSymlinks(rk); err == nil {
			rk = r
		}
		if realDir == rk || realStorage == rk || inside(rk, realDir) || inside(rk, realStorage) || inside(realStorage, rk) {
			return "it is in or above the Library"
		}
	}
	if err := os.RemoveAll(realStorage); err != nil {
		return "deleting it failed: " + err.Error()
	}
	return ""
}

// cleanAbs says p is absolute and has no ".." element.
func cleanAbs(p string) bool {
	if !filepath.IsAbs(p) {
		return false
	}
	for _, el := range strings.Split(filepath.ToSlash(p), "/") {
		if el == ".." {
			return false
		}
	}
	return true
}

// inside says p lies strictly below dir.
func inside(dir, p string) bool {
	rel, err := filepath.Rel(dir, p)
	return err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
