//go:build unix

package main

import "syscall"

// applyUmask sets the process umask, so folders Kestrel creates get 0777 &^ umask.
func applyUmask(mask int) { syscall.Umask(mask) }
