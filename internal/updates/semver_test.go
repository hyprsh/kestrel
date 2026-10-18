package updates

import "testing"

func TestCovers(t *testing.T) {
	cases := []struct {
		rng, ver string
		want     bool
	}{
		{">= 0.1.0, < 0.3.2", "0.2.0", true},
		{">= 0.1.0, < 0.3.2", "0.3.2", false},
		{">= 0.1.0, < 0.3.2", "v0.1.0", true},
		{">= 0.1.0, < 0.3.2", "0.0.9", false},
		{"< 0.3.2", "0.3.1", true},
		{"<= 0.3.2", "0.3.2", true},
		{"> 0.3.2", "0.3.2", false},
		{"= 0.3.2", "0.3.2", true},
		{"0.3.2", "0.3.2", true},
		{">= 0.10.0", "0.9.0", false},
		{">= 0.10.0", "0.10.1", true},
		{"< 1.0.0", "0.3.0-rc.1", true},
		{"", "0.3.0", false},
		{"garbage", "0.3.0", false},
		{"< 0.3.2", "dev", false},
		{"< 0.3.2", "edge", false},
	}
	for _, c := range cases {
		if got := Covers(c.rng, c.ver); got != c.want {
			t.Errorf("Covers(%q, %q) = %v, want %v", c.rng, c.ver, got, c.want)
		}
	}
}

func TestNewer(t *testing.T) {
	if !Newer("v0.2.0", "0.1.9") || Newer("0.1.9", "0.1.9") || Newer("0.1.0", "0.1.9") {
		t.Fatal("Newer compares releases")
	}
	if Newer("v0.2.0", "dev") || Newer("v0.2.0", "edge") {
		t.Fatal("dev and edge builds skip comparison")
	}
}
