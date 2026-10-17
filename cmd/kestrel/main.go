// Command kestrel is the one Kestrel binary: it opens the SQLite store and
// serves the REST API and the embedded SPA. cmd/kestrel only wires modules
// together; behaviour lives in internal/.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/config"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/version"
	"github.com/hyprsh/kestrel/web"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cmd := run
	if len(os.Args) > 1 && os.Args[1] == "reset-password" {
		cmd = func(ctx context.Context) error {
			return resetPassword(ctx, os.Args[2:], os.Stdin, os.Stdout, os.Getenv)
		}
	}
	if err := cmd(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "kestrel:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	applyUmask(cfg.Umask)

	st, err := store.Open(ctx, store.Options{Dir: cfg.ConfigDir})
	if err != nil {
		return err
	}
	defer st.Close()
	go api.RunSessionPruner(ctx, st, 24*time.Hour, logger)

	plugins, err := builtinPlugins()
	if err != nil {
		return err
	}

	app := api.New(api.Options{
		Version: version.Version,
		BaseURL: cfg.BaseURL,
		Store:   st,
		Web:     web.FS(),
		Logger:  logger,
		Plugins: plugins,
		DataDir: cfg.DataDir,

		ConfigDir:  cfg.ConfigDir,
		TMDBAPIKey: cfg.TMDBAPIKey,
		TVDBAPIKey: cfg.TVDBAPIKey,
	})
	srv := &http.Server{
		Addr:              net.JoinHostPort("", strconv.Itoa(cfg.Port)),
		Handler:           app.Handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	// Startup reconciliation, then the loops; both stop with ctx.
	jobsCtx, stopJobs := context.WithCancel(ctx)
	jobsDone := make(chan struct{})
	go func() {
		defer close(jobsDone)
		_ = app.Jobs.Run(jobsCtx)
	}()
	defer func() { stopJobs(); <-jobsDone }() // before the store closes

	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	logger.Info("kestrel started", "version", version.Version, "addr", srv.Addr, "base_url", cfg.BaseURL, "config_dir", cfg.ConfigDir)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	logger.Info("shutting down")
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdown); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
