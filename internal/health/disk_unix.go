//go:build unix

package health

import "syscall"

// diskSpace reads the space available to unprivileged users on path's mount.
func diskSpace(path string) (Space, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return Space{}, err
	}
	bs := uint64(st.Bsize)
	return Space{Free: uint64(st.Bavail) * bs, Total: uint64(st.Blocks) * bs}, nil
}
