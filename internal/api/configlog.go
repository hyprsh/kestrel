package api

import (
	"context"
	"encoding/json"
	"reflect"
	"sort"
	"strings"

	"github.com/hyprsh/kestrel/internal/history"
)

// recordConfig writes the Log entry of a change to the configuration. The caller (the API request) is the trigger,
// from the context; data is the entry's payload and must hold no secret value.
func (s *server) recordConfig(ctx context.Context, kind history.Kind, message, reason string, data map[string]any) {
	var raw json.RawMessage
	if len(data) > 0 {
		raw, _ = json.Marshal(data)
	}
	s.history.Record(ctx, history.Event{Kind: kind, Message: message, Reason: reason, Data: raw})
}

// asTree is v as the generic JSON tree it marshals to.
func asTree(v any) map[string]any {
	var tree map[string]any
	if raw, err := json.Marshal(v); err == nil {
		_ = json.Unmarshal(raw, &tree)
	}
	return tree
}

// sentKeys lists the dotted paths of the leaves a PATCH body sets ("root_folders.movies", "display.season_order"),
// sorted.
func sentKeys(body any) []string {
	var out []string
	var walk func(prefix string, v any)
	walk = func(prefix string, v any) {
		if m, ok := v.(map[string]any); ok && len(m) > 0 {
			for k, c := range m {
				p := k
				if prefix != "" {
					p = prefix + "." + k
				}
				walk(p, c)
			}
			return
		}
		out = append(out, prefix)
	}
	walk("", asTree(body))
	sort.Strings(out)
	return out
}

// secretSetting says whether a settings key holds a secret value (an API key, password, token or secret). The
// settings body shows such a key only as `<name>_set`; an entry names the key and never carries its value.
func secretSetting(key string) bool {
	last := key[strings.LastIndex(key, ".")+1:]
	for _, w := range []string{"api_key", "password", "token", "secret"} {
		if strings.Contains(last, w) {
			return true
		}
	}
	return false
}

// changedSettings is the keys body sets whose value differs from what the settings showed before. A secret key
// counts as changed whenever it is sent, since its stored value is never read back.
func changedSettings(before, body any) []string {
	old, sent := asTree(before), asTree(body)
	var out []string
	for _, k := range sentKeys(body) {
		if secretSetting(k) || !reflect.DeepEqual(lookup(old, k), lookup(sent, k)) {
			out = append(out, k)
		}
	}
	return out
}

func lookup(tree map[string]any, key string) any {
	var cur any = tree
	for _, part := range strings.Split(key, ".") {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = m[part]
	}
	return cur
}

// said is "a, b and c" for the names in a message.
func said(names []string) string {
	switch len(names) {
	case 0:
		return "nothing"
	case 1:
		return names[0]
	}
	return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
}

// recordSettingsPut writes the settings entry for a PUT of one section (section names it, "silo"): the fields of
// after that differ from before, by name only. Nothing is written when none does.
func (s *server) recordSettingsPut(ctx context.Context, section string, before, after any) {
	old, now := asTree(before), asTree(after)
	var keys []string
	for _, k := range sentKeys(after) {
		if secretSetting(k) || !reflect.DeepEqual(lookup(old, k), lookup(now, k)) {
			keys = append(keys, section+"."+k)
		}
	}
	if len(keys) > 0 {
		s.recordConfig(ctx, history.SettingsChanged, "Settings changed: "+said(keys), "saved by hand in Settings", map[string]any{"keys": keys})
	}
}
