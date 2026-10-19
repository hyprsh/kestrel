package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/term"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/config"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/store"
)

// resetPassword is `kestrel reset-password`, the only CLI command. It opens the
// config dir directly, so it works while the server is running, and ends every
// session. The new password is prompted for, or read from stdin with
// --password-stdin.
func resetPassword(ctx context.Context, args []string, stdin io.Reader, stdout io.Writer, getenv func(string) string) error {
	fs := flag.NewFlagSet("reset-password", flag.ContinueOnError)
	fs.SetOutput(stdout)
	fromStdin := fs.Bool("password-stdin", false, "read the new password from stdin instead of prompting")
	if err := fs.Parse(args); err != nil {
		return err
	}
	cfg, err := config.Load(getenv)
	if err != nil {
		return err
	}
	if err := refuseDeclaredAccount(cfg.ConfigFile, getenv); err != nil {
		return err
	}
	password, err := readNewPassword(stdin, stdout, *fromStdin)
	if err != nil {
		return err
	}
	st, err := store.Open(ctx, store.Options{Dir: cfg.ConfigDir})
	if err != nil {
		return err
	}
	defer st.Close()
	if err := api.ResetPassword(ctx, st, password); err != nil {
		return err
	}
	fmt.Fprintln(stdout, "Password reset. Every session was logged out.")
	return nil
}

// refuseDeclaredAccount fails when the Config File at path declares the
// account: its password comes from the file's variable on every start, so a
// reset here would not last (ADR 0014).
func refuseDeclaredAccount(path string, getenv func(string) string) error {
	if path == "" {
		return nil
	}
	f, err := configfile.Load(path, getenv)
	if err != nil {
		return err
	}
	if a := f.Account; a != nil {
		return fmt.Errorf("the account is declared in the Config File %s: set the new password in %s and restart Kestrel", path, a.PasswordEnv)
	}
	return nil
}

func readNewPassword(stdin io.Reader, stdout io.Writer, fromStdin bool) (string, error) {
	if fromStdin {
		line, err := bufio.NewReader(stdin).ReadString('\n')
		if err != nil && (!errors.Is(err, io.EOF) || line == "") {
			return "", errors.New("no password on stdin")
		}
		return strings.TrimRight(line, "\r\n"), nil
	}
	f, ok := stdin.(*os.File)
	if !ok || !term.IsTerminal(int(f.Fd())) {
		return "", errors.New("stdin is not a terminal: use --password-stdin, or run with docker exec -it")
	}
	ask := func(prompt string) (string, error) {
		fmt.Fprint(stdout, prompt)
		b, err := term.ReadPassword(int(f.Fd()))
		fmt.Fprintln(stdout)
		return string(b), err
	}
	first, err := ask("New password: ")
	if err != nil {
		return "", err
	}
	again, err := ask("Repeat it: ")
	if err != nil {
		return "", err
	}
	if first != again {
		return "", errors.New("the passwords differ")
	}
	return first, nil
}
