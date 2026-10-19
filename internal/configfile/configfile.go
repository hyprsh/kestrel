// Package configfile reads the Config File: the YAML file KESTREL_CONFIG_FILE
// names, which declares sections that the UI then can't change (ADR 0014).
//
// Load decodes the file strictly and resolves the environment variables that
// carry its secrets. It checks the file's shape only: whether a declared value
// is acceptable is the owning module's rule, checked when the file is applied
// (internal/app). Every section is optional, and a nil section is one the file
// does not declare.
package configfile

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"reflect"
	"regexp"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"
)

// File is a decoded Config File.
type File struct {
	// Path is where the file was read from; errors and 409s name it.
	Path string `yaml:"-"`

	Account        *Account        `yaml:"account"`
	LanguageRegion *LanguageRegion `yaml:"language_region"`
	RootFolders    *RootFolders    `yaml:"root_folders"`
	// Profiles maps a Profile key to its declared state.
	Profiles map[string]Profile `yaml:"profiles"`
	// PluginInstances are known by name. Nil means the file leaves plugin
	// instances to the UI; an empty list declares none.
	PluginInstances    []PluginInstance `yaml:"plugin_instances"`
	ReverseProxy       *ReverseProxy    `yaml:"reverse_proxy"`
	CheckGitHubUpdates *bool            `yaml:"check_github_updates"`
}

// Account is the admin login. The password is named by an environment variable.
type Account struct {
	Username    string `yaml:"username"`
	PasswordEnv string `yaml:"password_env"`
	// Password is the value of PasswordEnv, resolved by Load.
	Password Secret `yaml:"-"`
}

// LanguageRegion is the Primary Language and the release-date country.
type LanguageRegion struct {
	PrimaryLanguage    string `yaml:"primary_language"`
	ReleaseDateCountry string `yaml:"release_date_country"`
}

// RootFolders are the Root folders per kind; the first of each is the default.
type RootFolders struct {
	Movies []string `yaml:"movies"`
	Series []string `yaml:"series"`
}

// Profile is one Profile's declared settings. A nil field is one the file left out.
type Profile struct {
	Enabled          *bool `yaml:"enabled"`
	OriginalFallback *bool `yaml:"original_fallback"`
	DefaultMovies    *bool `yaml:"default_movies"`
	DefaultSeries    *bool `yaml:"default_series"`
}

// PluginInstance is one declared plugin instance. Config is kept as YAML: its
// keys depend on the plugin's manifest, and a secret field is given as
// <field>_env naming an environment variable.
type PluginInstance struct {
	Name     string    `yaml:"name"`
	PluginID string    `yaml:"plugin_id"`
	Enabled  *bool     `yaml:"enabled"`
	Priority *int      `yaml:"priority"`
	Config   yaml.Node `yaml:"config"`

	// Line is where the instance starts in the file.
	Line   int                 `yaml:"-"`
	getenv func(string) string // resolves the secrets Config names
}

// ReverseProxy is the reverse-proxy login, declared as a whole like PUT /reverse-proxy.
type ReverseProxy struct {
	Enabled        *bool    `yaml:"enabled"`
	TrustedProxies []string `yaml:"trusted_proxies"`
	Header         string   `yaml:"header"`
}

// Secret is a value resolved from the environment. It prints as a mask, so a
// logged or wrapped File never shows it.
type Secret string

func (Secret) String() string   { return "[secret]" }
func (Secret) GoString() string { return `"[secret]"` }

// Load reads and decodes the file at path. getenv resolves the variables the
// file names (os.Getenv in production). No error carries a secret value.
func Load(path string, getenv func(string) string) (*File, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config file: %w", err)
	}
	fail := func(err error) (*File, error) { return nil, fmt.Errorf("config file %s: %w", path, err) }

	var doc yaml.Node
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return fail(yamlError(err))
	}
	if len(doc.Content) > 0 {
		if err := unknownKeys(doc.Content[0], reflect.TypeFor[File](), ""); err != nil {
			return fail(err)
		}
		if err := emptySection(doc.Content[0]); err != nil {
			return fail(err)
		}
	}
	f := &File{}
	dec := yaml.NewDecoder(bytes.NewReader(raw))
	dec.KnownFields(true)
	if err := dec.Decode(f); err != nil && !errors.Is(err, io.EOF) {
		return fail(yamlError(err))
	}
	f.Path = path
	if len(doc.Content) > 0 {
		f.locate(doc.Content[0], getenv)
	}
	if err := f.complete(getenv); err != nil {
		return fail(err)
	}
	return f, nil
}

// complete checks that each declared section names all its fields and
// resolves the secrets.
func (f *File) complete(getenv func(string) string) error {
	var missing []string
	need := func(ok bool, field string) {
		if !ok {
			missing = append(missing, field)
		}
	}
	if a := f.Account; a != nil {
		need(strings.TrimSpace(a.Username) != "", "account.username")
		need(a.PasswordEnv != "", "account.password_env")
	}
	if l := f.LanguageRegion; l != nil {
		need(l.PrimaryLanguage != "", "language_region.primary_language")
		need(l.ReleaseDateCountry != "", "language_region.release_date_country")
	}
	if r := f.RootFolders; r != nil {
		need(r.Movies != nil, "root_folders.movies")
		need(r.Series != nil, "root_folders.series")
	}
	if p := f.ReverseProxy; p != nil {
		need(p.Enabled != nil, "reverse_proxy.enabled")
		need(p.TrustedProxies != nil, "reverse_proxy.trusted_proxies")
		need(p.Header != "", "reverse_proxy.header")
	}
	for _, key := range slices.Sorted(maps.Keys(f.Profiles)) {
		p, field := f.Profiles[key], "profiles."+key+"."
		need(p.Enabled != nil, field+"enabled")
		need(p.OriginalFallback != nil, field+"original_fallback")
		need(p.DefaultMovies != nil, field+"default_movies")
		need(p.DefaultSeries != nil, field+"default_series")
	}
	for i, p := range f.PluginInstances {
		field := fmt.Sprintf("plugin_instances[%d].", i)
		need(strings.TrimSpace(p.Name) != "", field+"name")
		need(p.PluginID != "", field+"plugin_id")
	}
	if len(missing) > 0 {
		return fmt.Errorf("%s: required in a declared section", strings.Join(missing, ", "))
	}
	seen := map[string]bool{}
	for i, p := range f.PluginInstances {
		name := strings.TrimSpace(p.Name)
		if seen[name] {
			return fmt.Errorf("line %d: plugin_instances[%d].name: %q is declared twice: an instance is known by its name", p.Line, i, name)
		}
		seen[name] = true
	}
	if a := f.Account; a != nil {
		pw, err := resolve(getenv, "account.password_env", a.PasswordEnv)
		if err != nil {
			return err
		}
		a.Password = pw
	}
	return nil
}

// ConfigValues returns the instance's config with its secrets read from the
// environment, as JSON would carry it to POST /plugin-instances. fields says
// which keys the plugin's manifest knows and which of them are secret: a
// secret is given only as <field>_env, and <field>_env on any other field is
// an unknown key. No error carries a value.
func (p PluginInstance) ConfigValues(fields func(key string) (known, secret bool)) (map[string]any, error) {
	name := strings.TrimSpace(p.Name)
	fail := func(line int, key, format string, args ...any) error {
		return fmt.Errorf("line %d: plugin_instances %q: config%s: %s", line, name, key, fmt.Sprintf(format, args...))
	}
	n := &p.Config
	for n.Kind == yaml.AliasNode && n.Alias != nil {
		n = n.Alias
	}
	out := map[string]any{}
	switch {
	case n.Kind == 0 || n.Kind == yaml.ScalarNode && n.Tag == "!!null":
		return out, nil
	case n.Kind != yaml.MappingNode:
		return nil, fail(n.Line, "", "must be a map of the plugin's settings")
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		key, val := n.Content[i], n.Content[i+1]
		field, isEnv := strings.CutSuffix(key.Value, "_env")
		if known, secret := fields(field); isEnv && known && secret {
			if _, dup := out[field]; dup {
				return nil, fail(key.Line, "."+field, "given twice")
			}
			var env string
			if val.Decode(&env) != nil {
				return nil, fail(key.Line, "."+key.Value, "must name an environment variable")
			}
			v, err := resolve(p.getenv, "config."+key.Value, env)
			if err != nil {
				return nil, fmt.Errorf("line %d: plugin_instances %q: %w", key.Line, name, err)
			}
			out[field] = string(v)
			continue
		}
		known, secret := fields(key.Value)
		switch {
		case !known:
			return nil, fail(key.Line, "."+key.Value, "unknown key")
		case secret:
			return nil, fail(key.Line, "."+key.Value, "a secret is never written in the file: name its environment variable with %s_env", key.Value)
		}
		if _, dup := out[key.Value]; dup {
			return nil, fail(key.Line, "."+key.Value, "given twice")
		}
		var v any
		if err := val.Decode(&v); err != nil {
			return nil, fail(key.Line, "."+key.Value, "not a value")
		}
		out[key.Value] = v
	}
	// Round-trip through JSON so numbers compare with the stored config.
	raw, err := json.Marshal(out)
	if err != nil {
		return nil, fail(n.Line, "", "not a map of plain values")
	}
	out = map[string]any{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// locate records where each plugin instance starts, and how its secrets resolve.
func (f *File) locate(root *yaml.Node, getenv func(string) string) {
	for i := 0; i+1 < len(root.Content); i += 2 {
		if root.Content[i].Value != "plugin_instances" {
			continue
		}
		for j, item := range root.Content[i+1].Content {
			if j < len(f.PluginInstances) {
				f.PluginInstances[j].Line = item.Line
			}
		}
	}
	for i := range f.PluginInstances {
		f.PluginInstances[i].getenv = getenv
	}
}

// emptySection reports a top-level key with no value. It would decode like an
// absent section, leaving to the UI what the file seems to declare.
func emptySection(root *yaml.Node) error {
	if root.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(root.Content); i += 2 {
		if key, val := root.Content[i], root.Content[i+1]; val.Kind == yaml.ScalarNode && val.Tag == "!!null" {
			return fmt.Errorf("line %d: %s has no value: leave the key out to keep the section in the UI", key.Line, key.Value)
		}
	}
	return nil
}

var envName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// resolve reads the environment variable a <field>_env names.
func resolve(getenv func(string) string, field, name string) (Secret, error) {
	if !envName.MatchString(name) {
		// Likely the secret itself, written where its variable belongs: don't repeat it.
		return "", fmt.Errorf("%s: not an environment variable name (letters, digits and _): name the variable that holds the secret", field)
	}
	v := getenv(name)
	if v == "" {
		return "", fmt.Errorf("%s: the environment variable %s is not set or empty", field, name)
	}
	return Secret(v), nil
}

// unknownKeys walks a YAML tree against the Go type it decodes into and
// reports the first key the type has no field for, with its path and line.
// Values are never quoted, so an inline secret does not end up in the error.
func unknownKeys(n *yaml.Node, t reflect.Type, path string) error {
	for n.Kind == yaml.AliasNode && n.Alias != nil {
		n = n.Alias
	}
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t == reflect.TypeFor[yaml.Node]() {
		return nil
	}
	join := func(key string) string {
		if path == "" {
			return key
		}
		return path + "." + key
	}
	switch {
	case t.Kind() == reflect.Struct && n.Kind == yaml.MappingNode:
		fields := map[string]reflect.Type{}
		for i := range t.NumField() {
			name, _, _ := strings.Cut(t.Field(i).Tag.Get("yaml"), ",")
			if name != "" && name != "-" {
				fields[name] = t.Field(i).Type
			}
		}
		for i := 0; i+1 < len(n.Content); i += 2 {
			key, val := n.Content[i], n.Content[i+1]
			ft, ok := fields[key.Value]
			if !ok {
				return fmt.Errorf("line %d: unknown key %s", key.Line, join(key.Value))
			}
			if err := unknownKeys(val, ft, join(key.Value)); err != nil {
				return err
			}
		}
	case t.Kind() == reflect.Map && n.Kind == yaml.MappingNode:
		for i := 0; i+1 < len(n.Content); i += 2 {
			if err := unknownKeys(n.Content[i+1], t.Elem(), join(n.Content[i].Value)); err != nil {
				return err
			}
		}
	case t.Kind() == reflect.Slice && n.Kind == yaml.SequenceNode:
		for i, item := range n.Content {
			if err := unknownKeys(item, t.Elem(), fmt.Sprintf("%s[%d]", path, i)); err != nil {
				return err
			}
		}
	}
	// Anything else is a value, or the wrong kind of node, which the decoder reports.
	return nil
}

// yamlError drops the YAML library's framing and Go type names, keeping the
// line it reports.
func yamlError(err error) error {
	var te *yaml.TypeError
	if errors.As(err, &te) {
		msgs := make([]string, len(te.Errors))
		for i, e := range te.Errors {
			msgs[i] = strings.Replace(e, "configfile.", "", 1)
		}
		return errors.New(strings.Join(msgs, "; "))
	}
	return errors.New(strings.TrimPrefix(err.Error(), "yaml: "))
}
