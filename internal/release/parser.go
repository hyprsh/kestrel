package release

// Ported from Radarr v5.28.0.10274 (54cbbe05d976ac053744012f8b48d44e384e2d41):
// src/NzbDrone.Core/Parser/Parser.cs, the parts both kinds share (release
// group, file extension, hardcoded subs, title cleaning). Radarr is GPL-3.0,
// like Kestrel.

import (
	"strconv"
	"strings"
	"unicode"

	"github.com/dlclark/regexp2"
	"golang.org/x/text/unicode/norm"
)

var (
	hardcodedSubsRegex = mustRx(`\b((?<hcsub>(\w+(?<!SOFT|MULTI|HORRIBLE)SUBS?))|(?<hc>(HC|SUBBED)))\b`,
		regexp2.IgnoreCase|regexp2.IgnorePatternWhitespace)

	normalizeRegex = ci(`((?:\b|_)(?<!^|[^a-zA-Z0-9_']\w[^a-zA-Z0-9_'])([aà](?!$|[^a-zA-Z0-9_']\w[^a-zA-Z0-9_'])|an|the|and|or|of)(?!$)(?:\b|_))|\W|_`)

	fileExtensionRegex = ci(`\.[a-z0-9]{2,4}$`)

	simpleTitleRegex = ci(`(?:(480|540|576|720|1080|2160)[ip]|[xh][\W_]?26[45]|DD\W?5\W1|[<>?*]|848x480|1280x720|1920x1080|3840x2160|4096x2160|(8|10)b(it)?|10-bit)\s*?(?![a-b0-9])`)

	simpleReleaseTitleRegex = ci(`\s*(?:[<>?*|])`)

	// Valid TLDs http://data.iana.org/TLD/tlds-alpha-by-domain.txt
	websitePrefixRegex = ci(`^(?:(?:\[|\()\s*)?(?:www\.)?[-a-z0-9-]{1,256}\.(?<!Naruto-Kun\.)(?:[a-z]{2,6}\.[a-z]{2,6}|xn--[a-z0-9-]{4,}|[a-z]{2,})\b(?:\s*(?:\]|\))|[ -]{2,})[ -]*`)

	websitePostfixRegex = ci(`(?:\[\s*)?(?:www\.)?[-a-z0-9-]{1,256}\.(?:xn--[a-z0-9-]{4,}|[a-z]{2,6})\b(?:\s*\])$`)

	cleanReleaseGroupRegex = ci(`(-(RP|1|NZBGeek|Obfuscated|Obfuscation|Scrambled|sample|Pre|postbot|xpost|Rakuv[a-z0-9]*|WhiteRev|BUYMORE|AsRequested|AlternativeToRequested|GEROV|Z0iDS3N|Chamele0n|4P|4Planet|AlteZachen|RePACKPOST))+$`)

	cleanTorrentSuffixRegex = ci(`\[(?:ettv|rartv|rarbg|cttv|publichd)\]$`)

	cleanQualityBracketsRegex = ci(`\[[a-z0-9 ._-]+\]$`)

	releaseGroupRegex = ci(`-(?<releasegroup>[a-z0-9]+(?<part2>-[a-z0-9]+)?(?!.+?(?:480p|576p|720p|1080p|2160p)))(?<!(?:WEB-(DL|Rip)|Blu-Ray|480p|576p|720p|1080p|2160p|DTS-HD|DTS-X|DTS-MA|DTS-ES|-ES|-EN|-CAT|-ENG|-JAP|-GER|-FRA|-FRE|-ITA|-HDRip|\d{1,2}-bit|[ ._]\d{4}-\d{2}|-\d{2}|tmdb(id)?-(?<tmdbid>\d+)|(?<imdbid>tt\d{7,8}))(?:\k<part2>)?)(?:\b|[-._ ]|$)|[-._ ]\[(?<releasegroup>[a-z0-9]+)\]$`)

	invalidReleaseGroupRegex = ci(`^([se]\d+|[0-9a-f]{8})$`)

	animeReleaseGroupRegex = ci(`^(?:\[(?<subgroup>(?!\s).+?(?<!\s))\](?:_|-|\s|\.)?)`)

	// Handle Exception Release Groups that don't follow -RlsGrp; Manual List
	// groups whose releases end with RlsGroup) or RlsGroup]
	exceptionReleaseGroupRegex = ci(`(?<=[._ \[])(?<releasegroup>(Silence|afm72|Panda|Ghost|MONOLITH|Tigole|Joy|ImE|UTR|t3nzin|Anime Time|Project Angel|Hakata Ramen|HONE|Vyndros|SEV|Garshasp|Kappa|Natty|RCVR|SAMPA|YOGI|r00t|EDGE2020|RZeroX|FreetheFish|Anna|Bandi|Qman|theincognito|HDO|DusIctv|DHD|CtrlHD|-ZR-|ADC|XZVN|RH|Kametsu|Garshasp)(?=\]|\)))`)

	// Handle Exception Release Groups that don't follow -RlsGrp; Manual List
	// name only...BE VERY CAREFUL WITH THIS, HIGH CHANCE OF FALSE POSITIVES
	exceptionReleaseGroupRegexExact = ci(`\b(?<releasegroup>KRaLiMaRKo|E\.N\.D|D\-Z0N3|Koten_Gars|BluDragon|ZØNEHD|Tigole|HQMUX|VARYG|YIFY|YTS(.(MX|LT|AG))?|TMd|Eml HDTeam|LMain|DarQ|BEN THE MEN)\b`)

	requestInfoRegex = cs(`^(?:\[.+?\])+`)

	reportImdbID = ci(`(?<imdbid>tt\d{7,8})`)
	reportTmdbID = ci(`tmdb(id)?-(?<tmdbid>\d+)`)

	// Hashed or obfuscated names that are never a real release.
	rejectHashedReleasesRegex = []*rx{
		// Generic match for md5 and mixed-case hashes.
		cs(`^[0-9a-zA-Z]{32}`),

		// Generic match for shorter lower-case hashes.
		cs(`^[a-z0-9]{24}$`),

		// Format seen on some NZBGeek releases
		// Be very strict with these coz they are very close to the valid 101 ep numbering.
		cs(`^[A-Z]{11}\d{3}$`),
		cs(`^[a-z]{12}\d{3}$`),

		// Backup filename (Unknown origins)
		cs(`^Backup_\d{5,}S\d{2}-\d{2}$`),

		// 123 - Started appearing December 2014
		cs(`^123$`),

		// abc - Started appearing January 2015
		ci(`^abc$`),

		// abc - Started appearing 2020
		ci(`^abc[-_. ]xyz`),

		// b00bs - Started appearing January 2015
		ci(`^b00bs$`),
	}

	// Regex to detect whether the title was reversed.
	reversedTitleRegex = cs(`(?:^|[-._ ])(p027|p0801)[-._ ]`)

	normalizeImdbRegex = cs(`^(\d{1,10}|(tt)\d{1,10})$`)
)

var multiRegex = ci(`[_. ](?<multi>multi)[_. ]`)

// HasMultipleLanguages reports a MULTi token. Radarr does not turn it into a
// language itself; the indexer's multi-language setting does (AggregateLanguages),
// which is the scoring stage's job here.
func HasMultipleLanguages(title string) bool { return multiRegex.isMatch(title) }

// ParseReleaseGroup returns the release group of a release name, "" if none.
// It must equal Radarr's parser or the release-group Custom Formats stop
// matching.
func ParseReleaseGroup(title string) string {
	title = strings.TrimSpace(title)
	title = removeFileExtension(title)
	title = websitePrefixRegex.replace(title, "")
	title = cleanTorrentSuffixRegex.replace(title, "")

	if m := animeReleaseGroupRegex.match(title); m != nil {
		v, _ := group(m, "subgroup")
		return v
	}

	title = cleanReleaseGroupRegex.replace(title, "")

	if ms := exceptionReleaseGroupRegex.matchAll(title); len(ms) != 0 {
		v, _ := group(ms[len(ms)-1], "releasegroup")
		return v
	}

	if ms := exceptionReleaseGroupRegexExact.matchAll(title); len(ms) != 0 {
		v, _ := group(ms[len(ms)-1], "releasegroup")
		return v
	}

	if ms := releaseGroupRegex.matchAll(title); len(ms) != 0 {
		g, _ := group(ms[len(ms)-1], "releasegroup")

		if _, err := strconv.Atoi(strings.TrimSpace(g)); err == nil {
			return ""
		}

		if invalidReleaseGroupRegex.isMatch(g) {
			return ""
		}

		return g
	}

	return ""
}

// removeFileExtension strips a media file extension (and .par2, .nzb).
func removeFileExtension(title string) string {
	return fileExtensionRegex.replaceFunc(title, func(m *regexp2.Match) string {
		ext := strings.ToLower(m.String())
		if isMediaExtension(ext) || ext == ".par2" || ext == ".nzb" {
			return ""
		}
		return m.String()
	})
}

// parseHardcodeSubs returns the hardcoded-subs tag of a name, "" if none.
func parseHardcodeSubs(title string) string {
	ms := hardcodedSubsRegex.matchAll(title)
	if len(ms) == 0 {
		return ""
	}
	last := ms[len(ms)-1]
	if v, ok := group(last, "hcsub"); ok {
		return v
	}
	if hasGroup(last, "hc") {
		return "Generic Hardcoded Subs"
	}
	return ""
}

func parseImdbID(title string) string {
	if m := reportImdbID.match(title); m != nil {
		if v, ok := group(m, "imdbid"); ok && (len(v) == 9 || len(v) == 10) {
			return v
		}
	}
	return ""
}

func parseTmdbID(title string) int {
	if m := reportTmdbID.match(title); m != nil {
		if v, ok := group(m, "tmdbid"); ok {
			n, err := strconv.Atoi(v)
			if err != nil {
				return 0
			}
			return n
		}
	}
	return 0
}

// NormalizeImdbID turns "1234567" or "tt1234567" into "tt1234567"; "" if the
// input is not an IMDb id.
func NormalizeImdbID(imdbID string) string {
	if !normalizeImdbRegex.isMatch(imdbID) {
		return ""
	}
	if len(imdbID) > 2 {
		imdbID = strings.ReplaceAll(imdbID, "tt", "")
		for len(imdbID) < 7 {
			imdbID = "0" + imdbID
		}
		return "tt" + imdbID
	}
	return ""
}

// CleanMovieTitle reduces a title to the form titles are compared in:
// lower case, no accents, no punctuation and no articles in the middle.
func CleanMovieTitle(title string) string {
	if strings.TrimSpace(title) == "" {
		return title
	}

	// If Title only contains numbers return it as is.
	if _, err := strconv.ParseInt(strings.TrimSpace(title), 10, 64); err == nil {
		return title
	}

	return removeAccent(replaceGermanUmlauts(strings.ToLower(normalizeRegex.replace(title, ""))))
}

func replaceGermanUmlauts(s string) string {
	return strings.NewReplacer("ä", "ae", "ö", "oe", "ü", "ue", "Ä", "Ae", "Ö", "Oe", "Ü", "Ue", "ß", "ss").Replace(s)
}

// removeAccent drops combining marks after canonical decomposition.
func removeAccent(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		if !unicode.Is(unicode.Mn, r) {
			b.WriteRune(r)
		}
	}
	return norm.NFC.String(b.String())
}

func isBlank(s string) bool { return strings.TrimSpace(s) == "" }
