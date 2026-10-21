package api

import (
	"encoding/base64"
	"strconv"
)

// A cursor is a page's position (the last id on the page before, or an offset),
// base64url-encoded so clients treat it as opaque.

// cursorOf is the cursor for position n.
func cursorOf(n int64) *string {
	c := base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(n, 10)))
	return &c
}

// readCursor is the position in c, or 0 when there is none. A position below
// least is not one this server gave out: 422 on cursor.
func readCursor(c *string, least int64) (int64, error) {
	if c == nil || *c == "" {
		return 0, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(*c)
	n, convErr := strconv.ParseInt(string(raw), 10, 64)
	if err != nil || convErr != nil || n < least {
		return 0, invalid("cursor", "invalid", "The cursor is not one this server gave out")
	}
	return n, nil
}
