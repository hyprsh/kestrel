package api_test

import (
	"fmt"
	"strconv"
	"strings"
	"testing"
)

// withoutEnabled drops the first count enabled lines from file.
func withoutEnabled(t *testing.T, file string, count int) string {
	t.Helper()
	out := strings.Replace(file, "    enabled: true\n", "", count)
	if out == file {
		t.Fatal("no enabled line to drop")
	}
	return out
}

func TestADeclaredInstanceWithoutEnabledIsToggledInTheUIAndKeepsItAcrossRestarts(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "", withFakes(t))
	file := declaredAccount + withoutEnabled(t, declaredInstances, 1)
	in.mustDeclare(file, fakeEnv...)
	b := in.login()

	sab := instancesByName(t, b)["SABnzbd"]
	if !sab.Enabled || !sab.FromConfigFile || sab.EnabledDeclared {
		t.Fatalf("SABnzbd = %+v, want enabled, declared and its enabled not declared", sab)
	}
	if a := instancesByName(t, b)["Alpha"]; !a.EnabledDeclared {
		t.Errorf("Alpha = %+v, want its enabled declared", a)
	}
	path := "/plugin-instances/" + strconv.FormatInt(sab.ID, 10)

	if r := b.valid("PATCH", path, `{"enabled":false}`); r.Status != 200 || !strings.Contains(r.Body, `"enabled":false`) {
		t.Fatalf("PATCH enabled = %d %s, want 200 and disabled", r.Status, r.Body)
	}
	in.mustDeclare(file, fakeEnv...)
	if c := instancesByName(t, b)["SABnzbd"]; c.Enabled {
		t.Errorf("SABnzbd = %+v, want it still disabled after a restart", c)
	}

	if r := b.valid("PATCH", path, `{"enabled":true}`); r.Status != 200 {
		t.Fatalf("PATCH enabled = %d %s", r.Status, r.Body)
	}
	in.mustDeclare(file, fakeEnv...)
	if c := instancesByName(t, b)["SABnzbd"]; !c.Enabled {
		t.Errorf("SABnzbd = %+v, want it still enabled after a restart", c)
	}
}

func TestADeclaredInstanceRefusesEverythingButAnUndeclaredEnabled(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "", withFakes(t))
	in.mustDeclare(declaredAccount+withoutEnabled(t, declaredInstances, 1), fakeEnv...)
	b := in.login()
	got := instancesByName(t, b)
	sab := "/plugin-instances/" + strconv.FormatInt(got["SABnzbd"].ID, 10)
	alpha := "/plugin-instances/" + strconv.FormatInt(got["Alpha"].ID, 10)

	for _, c := range []struct{ name, path, body string }{
		{"enabled set in the file", alpha, `{"enabled":false}`},
		{"name", sab, `{"name":"Mine"}`},
		{"priority", sab, `{"priority":3}`},
		{"config", sab, `{"config":{"movie_category":"x"}}`},
		{"enabled with priority", sab, `{"enabled":false,"priority":3}`},
	} {
		t.Run(c.name, func(t *testing.T) {
			r := b.valid("PATCH", c.path, c.body)
			if r.Status != 409 || !strings.Contains(r.Body, "declared in the Config File") {
				t.Errorf("PATCH %s = %d %s, want 409 naming the file", c.body, r.Status, r.Body)
			}
		})
	}
	if c := instancesByName(t, b)["SABnzbd"]; !c.Enabled || c.Priority != 0 {
		t.Errorf("SABnzbd = %+v, want it unchanged", c)
	}
}

func TestTheEnabledCapCountsTheStoredEnabledOfADeclaredInstanceTheFileLeavesOut(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "", withFakes(t))
	backup := "  - name: Backup\n    plugin_id: fake\n%s    config:\n      api_key_env: CLIENT_KEY\n"
	in.mustDeclare(declaredAccount+declaredInstances+fmt.Sprintf(backup, "    enabled: false\n"), fakeEnv...)

	// The file stops declaring Backup's enabled: it keeps the stored false
	// rather than starting enabled beside SABnzbd.
	open := declaredAccount + declaredInstances + fmt.Sprintf(backup, "")
	in.mustDeclare(open, fakeEnv...)
	b := in.login()
	got := instancesByName(t, b)
	if got["Backup"].Enabled || !got["SABnzbd"].Enabled {
		t.Fatalf("Backup enabled = %v, SABnzbd enabled = %v, want only SABnzbd", got["Backup"].Enabled, got["SABnzbd"].Enabled)
	}
	backupPath := "/plugin-instances/" + strconv.FormatInt(got["Backup"].ID, 10)

	// A toggle in the UI goes through the usual cap check.
	r := b.valid("PATCH", backupPath, `{"enabled":true}`)
	if r.Status != 422 || strings.Contains(r.Body, "declared in the Config File") {
		t.Errorf("enabling Backup beside SABnzbd = %d %s, want the cap to refuse it", r.Status, r.Body)
	}

	// Swapped in the UI, the stored values are what startup counts.
	if r := b.valid("PATCH", "/plugin-instances/"+strconv.FormatInt(got["SABnzbd"].ID, 10), `{"enabled":false}`); r.Status != 409 {
		t.Fatalf("SABnzbd declares enabled: PATCH = %d %s, want 409", r.Status, r.Body)
	}
	both := strings.Replace(declaredInstances, "    enabled: true\n", "", 1) + fmt.Sprintf(backup, "")
	in.mustDeclare(declaredAccount+both, fakeEnv...) // both undeclared: SABnzbd stays enabled, Backup stays disabled
	b = in.login()
	got = instancesByName(t, b)
	if r := b.valid("PATCH", "/plugin-instances/"+strconv.FormatInt(got["SABnzbd"].ID, 10), `{"enabled":false}`); r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	if r := b.valid("PATCH", backupPath, `{"enabled":true}`); r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	if err := in.declare(declaredAccount+declaredInstances+fmt.Sprintf(backup, ""), fakeEnv...); err == nil ||
		!strings.Contains(err.Error(), `"Backup"`) || !strings.Contains(err.Error(), `"SABnzbd"`) {
		t.Errorf("err = %v, want the cap to fail startup naming both", err)
	}
}
