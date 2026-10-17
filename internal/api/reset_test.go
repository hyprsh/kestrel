package api_test

import (
	"context"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/store"
)

func TestResetPasswordSetsANewPasswordAndEndsEverySession(t *testing.T) {
	in := newInstance(t, "")
	b := in.setUp()

	if err := api.ResetPassword(context.Background(), in.st, "brand new secret"); err != nil {
		t.Fatal(err)
	}
	if r := b.get("/auth/me"); r.Status != 401 {
		t.Errorf("old session after reset = %d, want 401", r.Status)
	}
	if r := in.browser().post("/auth/login", adminJSON); r.Status != 401 {
		t.Errorf("old password after reset = %d, want 401", r.Status)
	}
	r := in.browser().post("/auth/login", `{"username":"admin","password":"brand new secret"}`)
	if r.Status != 204 {
		t.Errorf("new password = %d %s, want 204", r.Status, r.Body)
	}
}

func TestResetPasswordWorksOnTheConfigDirOfARunningInstance(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(context.Background(), store.Options{Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := api.ResetPassword(context.Background(), st, "whatever it is"); err == nil ||
		!strings.Contains(err.Error(), "no account") {
		t.Errorf("reset before setup = %v, want a 'no account' error", err)
	}
}

func TestResetPasswordRefusesAWeakPassword(t *testing.T) {
	in := newInstance(t, "")
	in.setUp()
	if err := api.ResetPassword(context.Background(), in.st, "short"); err == nil {
		t.Error("a 5-character password was accepted")
	}
	if r := in.browser().post("/auth/login", adminJSON); r.Status != 204 {
		t.Errorf("old password after a refused reset = %d, want 204", r.Status)
	}
}
