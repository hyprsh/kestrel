package acquire

import (
	"strings"
	"unicode"
)

var transliterations = strings.NewReplacer(
	"ä", "ae", "ö", "oe", "ü", "ue", "Ä", "Ae", "Ö", "Oe", "Ü", "Ue", "ß", "ss",
	"à", "a", "á", "a", "â", "a", "ã", "a", "å", "a", "À", "A", "Á", "A", "Â", "A", "Å", "A",
	"è", "e", "é", "e", "ê", "e", "ë", "e", "È", "E", "É", "E", "Ê", "E", "Ë", "E",
	"ì", "i", "í", "i", "î", "i", "ï", "i", "Ì", "I", "Í", "I", "Î", "I", "Ï", "I",
	"ò", "o", "ó", "o", "ô", "o", "õ", "o", "ø", "o", "Ò", "O", "Ó", "O", "Ô", "O", "Ø", "O",
	"ù", "u", "ú", "u", "û", "u", "Ù", "U", "Ú", "U", "Û", "U",
	"ç", "c", "Ç", "C", "ñ", "n", "Ñ", "N", "ÿ", "y", "ý", "y", "œ", "oe", "Œ", "Oe", "æ", "ae", "Æ", "Ae",
)

// transliterate spells accented letters the way release names do (ü as ue, é
// as e), so a title is found whichever way the indexer wrote it.
func transliterate(s string) string { return transliterations.Replace(s) }

// searchTitles are the names an indexer is searched for as text: the English,
// original and Primary-Language titles, each also transliterated, without
// repeats.
func searchTitles(names ...string) []string {
	var out []string
	seen := map[string]bool{}
	add := func(s string) {
		s = strings.TrimSpace(s)
		if k := strings.ToLower(s); s != "" && !seen[k] {
			seen[k] = true
			out = append(out, s)
		}
	}
	for _, n := range names {
		add(n)
	}
	for _, n := range names {
		add(transliterate(n))
	}
	return out
}

// normalize reduces a title to lower-case words, for comparing a release's
// parsed title with the Title's names.
func normalize(s string) string {
	words := strings.FieldsFunc(strings.ToLower(transliterate(s)), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	return strings.Join(words, " ")
}
