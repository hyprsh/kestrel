// Package settings holds Kestrel's app settings as JSON documents keyed by
// name. This is the seam later modules read and write their sections through.
package settings

import (
	"context"
	"database/sql"
	"errors"

	"github.com/hyprsh/kestrel/internal/settings/db"
	"github.com/hyprsh/kestrel/internal/store"
)

// Settings reads through the store's read pool and writes through its write
// connection.
type Settings struct {
	read  *db.Queries
	write *db.Queries
}

// New returns Settings backed by st.
func New(st *store.Store) *Settings {
	return &Settings{read: db.New(st.Read()), write: db.New(st.Write())}
}

// Get returns the JSON value stored under key.
func (s *Settings) Get(ctx context.Context, key string) (value []byte, ok bool, err error) {
	v, err := s.read.Get(ctx, key)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return []byte(v), true, nil
}

// Put stores value, which must be valid JSON, under key.
func (s *Settings) Put(ctx context.Context, key string, value []byte) error {
	return s.write.Put(ctx, db.PutParams{Key: key, Value: string(value)})
}
