// Command portfixtures is a dev-only tool. It reads the NUnit fixture files of
// an upstream *arr checkout and writes their [TestCase] and [TestCaseSource]
// rows as JSON, so the Go tests replay the upstream cases without hand copying.
//
// Usage:
//
//	go run ./scripts/portfixtures -src <upstream>/src/NzbDrone.Core.Test/ParserTests \
//	    -out internal/release/testdata/radarr ParserFixture LanguageParserFixture ...
//
// Each output file is <Fixture>.json:
//
//	{"fixture":"ParserFixture","cases":[{"method":"should_parse_movie_title","args":["..."]}]}
//
// Argument encoding: strings, numbers, booleans and null map to JSON natives,
// array initialisers to arrays, and any other C# expression (an enum member
// such as QualitySource.TV) to {"ident":"QualitySource.TV"}. A named argument
// such as Description = "x" is stored under "description".
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type testCase struct {
	Method      string `json:"method"`
	Args        []any  `json:"args"`
	Description string `json:"description,omitempty"`
}

type fixtureFile struct {
	Fixture string     `json:"fixture"`
	Cases   []testCase `json:"cases"`
}

type ident struct {
	Ident string `json:"ident"`
}

func main() {
	src := flag.String("src", "", "upstream ParserTests directory")
	out := flag.String("out", "", "output directory")
	flag.Parse()
	if *src == "" || *out == "" || flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: portfixtures -src DIR -out DIR Fixture...")
		os.Exit(2)
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		fatal(err)
	}
	for _, name := range flag.Args() {
		raw, err := os.ReadFile(filepath.Join(*src, name+".cs"))
		if err != nil {
			fatal(err)
		}
		cases, err := extract(stripComments(string(raw)))
		if err != nil {
			fatal(fmt.Errorf("%s: %w", name, err))
		}
		data, err := json.MarshalIndent(fixtureFile{Fixture: name, Cases: cases}, "", "  ")
		if err != nil {
			fatal(err)
		}
		if err := os.WriteFile(filepath.Join(*out, name+".json"), append(data, '\n'), 0o644); err != nil {
			fatal(err)
		}
		fmt.Printf("%s: %d cases\n", name, len(cases))
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

// stripComments removes // and /* */ comments outside string literals.
func stripComments(s string) string {
	var b strings.Builder
	r := []rune(s)
	for i := 0; i < len(r); i++ {
		switch {
		case r[i] == '@' && i+1 < len(r) && r[i+1] == '"':
			j := i + 2
			for j < len(r) {
				if r[j] == '"' {
					if j+1 < len(r) && r[j+1] == '"' {
						j += 2
						continue
					}
					break
				}
				j++
			}
			b.WriteString(string(r[i : j+1]))
			i = j
		case r[i] == '"':
			j := i + 1
			for j < len(r) && r[j] != '"' {
				if r[j] == '\\' {
					j++
				}
				j++
			}
			b.WriteString(string(r[i : j+1]))
			i = j
		case r[i] == '/' && i+1 < len(r) && r[i+1] == '/':
			for i < len(r) && r[i] != '\n' {
				i++
			}
			b.WriteRune('\n')
		case r[i] == '/' && i+1 < len(r) && r[i+1] == '*':
			i += 2
			for i+1 < len(r) && !(r[i] == '*' && r[i+1] == '/') {
				i++
			}
			i++
		default:
			b.WriteRune(r[i])
		}
	}
	return b.String()
}

var (
	methodRe = regexp.MustCompile(`public\s+(?:static\s+)?void\s+(\w+)\s*\(`)
	sourceRe = regexp.MustCompile(`\[TestCaseSource\((?:nameof\()?"?(\w+)"?\)?\)\]`)
)

func extract(src string) ([]testCase, error) {
	type pending struct {
		args []any
		desc string
	}
	var cases []testCase
	var queue []pending
	var sources []string
	pos := 0
	for pos < len(src) {
		tc := strings.Index(src[pos:], "[TestCase(")
		ts := sourceRe.FindStringIndex(src[pos:])
		me := methodRe.FindStringSubmatchIndex(src[pos:])
		next := -1
		kind := ""
		for _, c := range []struct {
			idx  int
			kind string
		}{{tc, "case"}, {startOf(ts), "source"}, {startOf(me), "method"}} {
			if c.idx >= 0 && (next < 0 || c.idx < next) {
				next, kind = c.idx, c.kind
			}
		}
		if next < 0 {
			break
		}
		switch kind {
		case "case":
			p := &parser{s: src, i: pos + next + len("[TestCase(")}
			args, desc, err := p.argList()
			if err != nil {
				return nil, err
			}
			queue = append(queue, pending{args, desc})
			pos = p.i
		case "source":
			m := sourceRe.FindStringSubmatch(src[pos:])
			sources = append(sources, m[1])
			pos += next + len(m[0])
		case "method":
			name := src[pos+me[2] : pos+me[3]]
			for _, q := range queue {
				cases = append(cases, testCase{Method: name, Args: q.args, Description: q.desc})
			}
			for _, s := range sources {
				rows, err := sourceRows(src, s)
				if err != nil {
					return nil, err
				}
				for _, row := range rows {
					cases = append(cases, testCase{Method: name, Args: row})
				}
			}
			queue, sources = nil, nil
			pos += me[1]
		}
	}
	return cases, nil
}

func startOf(loc []int) int {
	if loc == nil {
		return -1
	}
	return loc[0]
}

// sourceRows parses `public static object[] NAME = { new object[] {...}, ... };`.
func sourceRows(src, name string) ([][]any, error) {
	re := regexp.MustCompile(`object\[\]\s+` + regexp.QuoteMeta(name) + `\s*=`)
	loc := re.FindStringIndex(src)
	if loc == nil {
		return nil, fmt.Errorf("case source %s not found", name)
	}
	p := &parser{s: src, i: loc[1]}
	v, err := p.expr()
	if err != nil {
		return nil, err
	}
	rows, ok := v.([]any)
	if !ok {
		return nil, fmt.Errorf("case source %s is not an array", name)
	}
	var out [][]any
	for _, r := range rows {
		row, ok := r.([]any)
		if !ok {
			return nil, fmt.Errorf("case source %s: row is not an array", name)
		}
		out = append(out, row)
	}
	return out, nil
}

type parser struct {
	s string
	i int
}

func (p *parser) ws() {
	for p.i < len(p.s) && isSpace(p.s[p.i]) {
		p.i++
	}
}

func (p *parser) peek() byte {
	p.ws()
	if p.i >= len(p.s) {
		return 0
	}
	return p.s[p.i]
}

// argList parses arguments up to and including the closing ")]".
func (p *parser) argList() ([]any, string, error) {
	var args []any
	desc := ""
	for {
		c := p.peek()
		if c == ')' {
			p.i++
			break
		}
		if c == ',' {
			p.i++
			continue
		}
		if c == 0 {
			return nil, "", fmt.Errorf("unterminated TestCase")
		}
		if name, ok := p.namedArg(); ok {
			v, err := p.expr()
			if err != nil {
				return nil, "", err
			}
			if name == "Description" {
				desc, _ = v.(string)
			}
			continue
		}
		v, err := p.expr()
		if err != nil {
			return nil, "", err
		}
		args = append(args, v)
	}
	return args, desc, nil
}

var namedRe = regexp.MustCompile(`^[A-Za-z_]\w*\s*=[^=]`)

func (p *parser) namedArg() (string, bool) {
	p.ws()
	rest := p.s[p.i:min(len(p.s), p.i+64)]
	if !namedRe.MatchString(rest) {
		return "", false
	}
	end := strings.Index(rest, "=")
	name := strings.TrimSpace(rest[:end])
	p.i += end + 1
	return name, true
}

func (p *parser) expr() (any, error) {
	c := p.peek()
	var v any
	var err error
	switch {
	case c == '"':
		v, err = p.str()
	case c == '@':
		p.i++
		v, err = p.verbatim()
	case c == '{':
		v, err = p.array()
	case c == '-' || isDigit(c):
		v, err = p.number()
	case isLetter(c) || c == '_':
		v, err = p.word()
	default:
		return nil, fmt.Errorf("unexpected %q at %d", c, p.i)
	}
	if err != nil {
		return nil, err
	}
	// Strip trailing member calls such as .AsOsAgnostic().
	for p.i < len(p.s) && p.s[p.i] == '.' {
		p.i++
		for p.i < len(p.s) && (isLetter(p.s[p.i]) || isDigit(p.s[p.i])) {
			p.i++
		}
		if p.i+1 < len(p.s) && p.s[p.i] == '(' && p.s[p.i+1] == ')' {
			p.i += 2
		}
	}
	return v, nil
}

func (p *parser) str() (string, error) {
	p.i++ // opening quote
	var b strings.Builder
	for p.i < len(p.s) && p.s[p.i] != '"' {
		c := p.s[p.i]
		if c != '\\' {
			b.WriteByte(c)
			p.i++
			continue
		}
		p.i++
		e := p.s[p.i]
		switch e {
		case 'n':
			b.WriteRune('\n')
		case 't':
			b.WriteRune('\t')
		case 'r':
			b.WriteRune('\r')
		case '0':
			b.WriteRune(0)
		case 'u':
			n, err := strconv.ParseUint(p.s[p.i+1:p.i+5], 16, 32)
			if err != nil {
				return "", err
			}
			b.WriteRune(rune(n))
			p.i += 4
		default:
			b.WriteByte(e)
		}
		p.i++
	}
	if p.i >= len(p.s) {
		return "", fmt.Errorf("unterminated string")
	}
	p.i++
	return b.String(), nil
}

func (p *parser) verbatim() (string, error) {
	p.i++ // opening quote
	var b strings.Builder
	for p.i < len(p.s) {
		c := p.s[p.i]
		if c == '"' {
			if p.i+1 < len(p.s) && p.s[p.i+1] == '"' {
				b.WriteByte('"')
				p.i += 2
				continue
			}
			p.i++
			return b.String(), nil
		}
		b.WriteByte(c)
		p.i++
	}
	return "", fmt.Errorf("unterminated verbatim string")
}

func (p *parser) number() (any, error) {
	start := p.i
	if p.s[p.i] == '-' {
		p.i++
	}
	for p.i < len(p.s) && (isDigit(p.s[p.i]) || p.s[p.i] == '.') {
		p.i++
	}
	text := p.s[start:p.i]
	if n, err := strconv.ParseInt(text, 10, 64); err == nil {
		return n, nil
	}
	return strconv.ParseFloat(text, 64)
}

// array parses `{ a, b, ... }` after any `new T[]` prefix was consumed by word.
func (p *parser) array() (any, error) {
	p.i++ // {
	out := []any{}
	for {
		c := p.peek()
		switch c {
		case '}':
			p.i++
			return out, nil
		case ',':
			p.i++
		case 0:
			return nil, fmt.Errorf("unterminated array")
		default:
			v, err := p.expr()
			if err != nil {
				return nil, err
			}
			out = append(out, v)
		}
	}
}

func (p *parser) word() (any, error) {
	start := p.i
	for p.i < len(p.s) && (isLetter(p.s[p.i]) || isDigit(p.s[p.i]) || p.s[p.i] == '_' || p.s[p.i] == '.') {
		p.i++
	}
	w := p.s[start:p.i]
	switch w {
	case "true":
		return true, nil
	case "false":
		return false, nil
	case "null":
		return nil, nil
	case "new":
		// new[] {..}, new string[] {..}, new object[] {..}
		for p.i < len(p.s) && p.s[p.i] != ']' {
			p.i++
		}
		p.i++
		if p.peek() != '{' {
			return []any{}, nil // new string[0]
		}
		return p.array()
	}
	// Cast or call such as (Language)"x" is not used; keep as identifier.
	if p.i < len(p.s) && p.s[p.i] == '(' {
		return nil, fmt.Errorf("unsupported call %s(", w)
	}
	return ident{Ident: w}, nil
}

func isSpace(c byte) bool  { return c == ' ' || c == '\t' || c == '\n' || c == '\r' }
func isDigit(c byte) bool  { return c >= '0' && c <= '9' }
func isLetter(c byte) bool { return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' }
