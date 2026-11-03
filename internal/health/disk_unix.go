//go:build unix

package health

import (
	"strconv"
	"syscall"
)

// diskSpace reads the space available to unprivileged users on path's mount.
func diskSpace(path string) (Space, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return Space{}, err
	}
	var fs string
	var dev syscall.Stat_t
	if err := syscall.Stat(path, &dev); err == nil {
		fs = strconv.FormatUint(uint64(dev.Dev), 10) //nolint:unconvert // Dev is int32 on Darwin and uint64 on Linux
	}
	bs := uint64(st.Bsize)
	return Space{Free: uint64(st.Bavail) * bs, Total: uint64(st.Blocks) * bs, Filesystem: fs}, nil
}
