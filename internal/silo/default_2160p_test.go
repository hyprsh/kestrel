package silo_test

import (
	"context"
	"strings"
	"testing"

	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"

	"github.com/hyprsh/kestrel/internal/silo"
)

func TestAnUnmappedTierGoesToTheFirstSlotWhoseDefaultProfileIs4K(t *testing.T) {
	k := newSlotStub(t, "standard", "remux", "4k")
	k.remux4K = true
	r := silo.NewRouter(silo.Options{})

	fulfil(t, r, conn(t, k.URL, "kst_x", nil), movie(7), "1080p", "2160p")

	if got := strings.Join(k.sentSlots(), ","); got != "standard=<nil>,remux=<nil>" {
		t.Errorf("slots = %s, want the first 4K Slot (remux) in Slot order", got)
	}
}

func TestAnUnmappedTierFallsBackToThe1080pSlotWhenNoSlotDefaultsTo4K(t *testing.T) {
	k := newSlotStub(t, "standard", "remux")
	r := silo.NewRouter(silo.Options{})

	res := fulfil(t, r, conn(t, k.URL, "kst_x", nil), movie(7), "1080p", "2160p")

	if got := strings.Join(k.sentSlots(), ","); got != "standard=<nil>" {
		t.Errorf("slots = %s, want the 1080p Slot alone", got)
	}
	if tg := target(t, res, "2160p"); tg.Status != "queued" {
		t.Errorf("2160p target = %+v", tg)
	}

	other := fulfil(t, r, conn(t, k.URL, "kst_x", map[string]any{"1080p_slot": "remux"}), movie(7), "2160p")
	if got := strings.Join(k.sentSlots(), ","); got != "remux=<nil>" {
		t.Errorf("slots = %s, want the mapped 1080p Slot", got)
	}
	if tg := target(t, other, "2160p"); tg.Status != "queued" {
		t.Errorf("2160p target = %+v", tg)
	}
}

func TestAnExplicit2160pMappingBeatsTheProfileDefault(t *testing.T) {
	k := newSlotStub(t, "standard", "remux", "4k")
	r := silo.NewRouter(silo.Options{})

	fulfil(t, r, conn(t, k.URL, "kst_x", map[string]any{"2160p_slot": "remux"}), movie(7), "2160p")

	if got := strings.Join(k.sentSlots(), ","); got != "remux=<nil>" {
		t.Errorf("slots = %s, want the mapped Slot", got)
	}
}

func TestTheDefaultOptionOfThe2160pSlotNamesTheSlotItResolvesTo(t *testing.T) {
	list := func(k *slotStub, cfg map[string]any) []string {
		opts, err := silo.NewRouter(silo.Options{}).ListConfigOptions(context.Background(),
			&pluginv1.ListConfigOptionsRequest{CapabilityId: "kestrel", Connection: conn(t, k.URL, "kst_x", cfg)})
		if err != nil {
			t.Fatal(err)
		}
		var labels []string
		for _, f := range []string{"1080p_slot", "2160p_slot"} {
			labels = append(labels, opts.OptionsByField[f].GetOptions()[0].Label)
		}
		return labels
	}

	if got := strings.Join(list(newSlotStub(t, "standard", "4k"), nil), "|"); got != "Default|Default (4K)" {
		t.Errorf("default options = %s", got)
	}
	if got := strings.Join(list(newSlotStub(t, "standard", "remux"), nil), "|"); got != "Default|Default (STANDARD)" {
		t.Errorf("default options with no 4K Slot = %s", got)
	}
	if got := strings.Join(list(newSlotStub(t, "standard", "4k"), map[string]any{"2160p_slot": "standard"}), "|"); got != "Default|Default" {
		t.Errorf("default options with an explicit mapping = %s", got)
	}
}
