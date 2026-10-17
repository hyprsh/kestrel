package imports

import "github.com/hyprsh/kestrel/internal/probe"

// languageNames maps the canonical ISO 639-2/T codes Kestrel probes to the
// English language names used in file names.
var languageNames = map[string]string{
	"eng": "English", "fra": "French", "spa": "Spanish", "deu": "German",
	"ita": "Italian", "dan": "Danish", "nld": "Dutch", "jpn": "Japanese",
	"isl": "Icelandic", "zho": "Chinese", "rus": "Russian", "pol": "Polish",
	"vie": "Vietnamese", "swe": "Swedish", "nor": "Norwegian", "fin": "Finnish",
	"tur": "Turkish", "por": "Portuguese", "ell": "Greek", "kor": "Korean",
	"hun": "Hungarian", "heb": "Hebrew", "lit": "Lithuanian", "ces": "Czech",
	"hin": "Hindi", "ron": "Romanian", "tha": "Thai", "bul": "Bulgarian",
	"ara": "Arabic", "ukr": "Ukrainian", "fas": "Persian", "ben": "Bengali",
	"slk": "Slovak", "lav": "Latvian", "cat": "Catalan", "hrv": "Croatian",
	"srp": "Serbian", "bos": "Bosnian", "est": "Estonian", "tam": "Tamil",
	"ind": "Indonesian", "tel": "Telugu", "mkd": "Macedonian", "slv": "Slovenian",
	"mal": "Malayalam", "kan": "Kannada", "sqi": "Albanian", "afr": "Afrikaans",
	"mar": "Marathi", "tgl": "Tagalog", "urd": "Urdu", "roh": "Romansh",
	"mon": "Mongolian", "kat": "Georgian",
}

// dualWords is the word that follows the Primary Language when the file also
// carries the Original Language: German "DL", French "MULTi", English "DUAL".
var dualWords = map[string]string{
	"deu": "DL",
	"fra": "MULTi",
	"eng": "DUAL",
}

// languageTag is the language bracket of a file (Settled 4), or "" when no
// probed language is known. primary and original are the household Primary
// Language and the Title's Original Language; probed are the canonical codes
// of the file's audio in track order. Only P, O and the first known probed
// language count; extra tracks are ignored.
func languageTag(primary, original string, probed []string) string {
	hasP := known(primary) && contains(probed, primary)
	hasO := known(original) && contains(probed, original)

	switch {
	case hasP && hasO && primary != original:
		return "[" + languageNames[primary] + " " + dualWord(primary) + "]"
	case hasP:
		return "[" + languageNames[primary] + "]"
	case hasO:
		return "[" + languageNames[original] + "]"
	}
	for _, code := range probed {
		if known(code) {
			return "[" + languageNames[code] + "]"
		}
	}
	return ""
}

// canonicalCodes normalizes codes and drops empty and untagged entries,
// keeping track order.
func canonicalCodes(codes []string) []string {
	out := make([]string, 0, len(codes))
	for _, c := range codes {
		if n := probe.NormalizeLanguage(c); n != "" {
			out = append(out, n)
		}
	}
	return out
}

func contains(codes []string, want string) bool {
	for _, c := range codes {
		if c == want {
			return true
		}
	}
	return false
}

func known(code string) bool {
	_, ok := languageNames[code]
	return ok
}

func dualWord(primary string) string {
	if w, ok := dualWords[primary]; ok {
		return w
	}
	return "MULTi"
}
