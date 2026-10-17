//go:build !unix

package main

// applyUmask is a no-op where there is no umask; Kestrel ships as a Linux image.
func applyUmask(int) {}
