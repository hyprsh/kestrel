package library

import (
	"context"
	"database/sql"
)

// ListBuilds is how many times the Library list has been built from the tables.
func (s *Service) ListBuilds() int {
	s.listed.mu.Lock()
	defer s.listed.mu.Unlock()
	return s.listed.builds
}

// ListTables are the tables the kept list is stamped with.
func ListTables() []string { return listTables }

// ListQueries builds the list and returns the SQL of every query it ran.
func (s *Service) ListQueries(ctx context.Context, view View) ([]string, error) {
	r := &recorder{db: s.st.Read()}
	if _, err := s.buildList(ctx, view, r); err != nil {
		return nil, err
	}
	return r.queries, nil
}

type recorder struct {
	db      *sql.DB
	queries []string
}

func (r *recorder) ExecContext(ctx context.Context, q string, a ...any) (sql.Result, error) {
	r.queries = append(r.queries, q)
	return r.db.ExecContext(ctx, q, a...)
}

func (r *recorder) PrepareContext(ctx context.Context, q string) (*sql.Stmt, error) {
	r.queries = append(r.queries, q)
	return r.db.PrepareContext(ctx, q)
}

func (r *recorder) QueryContext(ctx context.Context, q string, a ...any) (*sql.Rows, error) {
	r.queries = append(r.queries, q)
	return r.db.QueryContext(ctx, q, a...)
}

func (r *recorder) QueryRowContext(ctx context.Context, q string, a ...any) *sql.Row {
	r.queries = append(r.queries, q)
	return r.db.QueryRowContext(ctx, q, a...)
}
