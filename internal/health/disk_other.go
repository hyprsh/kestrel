//go:build !unix

package health

import "errors"

func diskSpace(string) (Space, error) { return Space{}, errors.New("free space is not readable on this platform") }
