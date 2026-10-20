package release

// Ported from Sonarr v4.0.20.3014 (cab419ade8ac7fcab5bf80394ee492abd35d5f5a):
// src/NzbDrone.Core/Parser/Parser.cs (ParseTitle, ParsePath, ParseReleaseGroup,
// ParseMatchCollection and their helpers). The report-title patterns live in
// seriesparser_regex.go. Sonarr is GPL-3.0, like Kestrel.

import (
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/dlclark/regexp2"
	"golang.org/x/text/unicode/norm"
)

// now is the clock the future-date check of daily episodes reads.
var now = time.Now

var (
	rejectHashedReleasesRegexSeries = []*rx{
		// Generic match for md5 and mixed-case hashes.
		cs(`^[0-9a-zA-Z]{32}`),
		// Generic match for shorter lower-case hashes.
		cs(`^[a-z0-9]{24}$`),
		// Format seen on some NZBGeek releases. Strict, because it is close to
		// the valid 101 episode numbering.
		cs(`^[A-Z]{11}\d{3}$`),
		cs(`^[a-z]{12}\d{3}$`),
		// Backup filename (unknown origins)
		cs(`^Backup_\d{5,}S\d{2}-\d{2}$`),
		cs(`^123$`),
		ci(`^abc$`),
		ci(`^abc[-_. ]xyz`),
		ci(`^b00bs$`),
		// 170424_26 - started appearing August 2018
		cs(`^\d{6}_\d{2}$`),
		// Additional generic matches for mixed-case hashes.
		cs(`^[0-9a-zA-Z]{30}`),
		cs(`^[0-9a-zA-Z]{26}`),
		cs(`^[0-9a-zA-Z]{39}`),
		cs(`^[0-9a-zA-Z]{24}`),
	}

	seasonFolderRegexes = []*rx{cs(`^(Season[ ._-]*\d+|Specials)$`)}

	reversedTitleRegexSeries = cs(`(?:^|[-._ ])(p027|p0801|\d{2,3}E\d{2}S)[-._ ]`)

	normalizeSeriesRegex = ci(`((?:\b|_)(?<!^)([aà](?!$)|an|the|and|or|of)(?!$)(?:\b|_))|\W|_`)

	percentRegex = cs(`(?<=\b\d+)%`)

	simpleTitleRegexSeries = ci(`(?:(480|540|576|720|1080|2160)[ip]|[xh][\W_]?26[45]|DD\W?5\W1|[<>?*]|848x480|1280x720|1920x1080|3840x2160|4096x2160|(?<![a-f0-9])(8|10)(b(?![a-z0-9])|bit)|10-bit)\s*?`)

	sixDigitAirDateRegex = ci(`(?<=[_.-])(?<airdate>(?<!\d)(?<airyear>[1-9]\d{1})(?<airmonth>[0-1][0-9])(?<airday>[0-3][0-9]))(?=[_.-])`)

	cleanReleaseGroupRegexSeries = ci(`^(.*?[-._ ](S\d+E\d+)[-._ ])|(-(RP|1|NZBGeek|Obfuscated|Scrambled|sample|Pre|postbot|xpost|Rakuv[a-z0-9]*|WhiteRev|BUYMORE|AsRequested|AlternativeToRequested|GEROV|Z0iDS3N|Chamele0n|4P|4Planet|AlteZachen|RePACKPOST))+$`)

	releaseGroupRegexSeries = ci(`-(?<releasegroup>[a-z0-9]+(?<part2>-[a-z0-9]+)?(?!.+?(?:480p|576p|720p|1080p|2160p)))(?<!(?:WEB-DL|Blu-Ray|480p|576p|720p|1080p|2160p|DTS-HD|DTS-X|DTS-MA|DTS-ES|-ES|-EN|-CAT|[ ._]\d{4}-\d{2}|-\d{2})(?:\k<part2>)?)(?:\b|[-._ ]|$)|[-._ ]\[(?<releasegroup>[a-z0-9]+)\]$`)

	exceptionReleaseGroupRegexExactSeries = ci(`(?<releasegroup>(?:D\-Z0N3|Fight-BB|VARYG|E\.N\.D|KRaLiMaRKo|BluDragon|DarQ|KCRT|BEN[_. ]THE[_. ]MEN)\b)`)

	exceptionReleaseGroupRegexSeries = ci(`(?<=[._ \[])(?<releasegroup>(Silence|afm72|Panda|Ghost|MONOLITH|Tigole|Joy|ImE|UTR|t3nzin|Anime Time|Project Angel|Hakata Ramen|HONE|Vyndros|SEV|Garshasp|Kappa|Natty|RCVR|SAMPA|YOGI|r00t|EDGE2020|RZeroX)(?=\]|\)))`)

	yearInTitleRegex = ci(`^(?<title>.+?)[-_. ]+?[\(\[]?(?<year>\d{4})[\]\)]?`)

	titleComponentsRegex = ci(`^(?:(?<title>.+?) \((?<title>.+?)\)|(?<title>.+?) \| (?<title>.+?)|(?<title>.+?) AKA (?<title>.+?))$`)

	partRegex                = cs(`\(\d+\)$`)
	punctuationRegex         = cs(`[^\w\s]`)
	duplicateSpacesRegex     = cs(`\s{2,}`)
	seasonFolderRegex        = ci(`^(?:S|Season|Saison|Series|Stagione)[-_. ]*(?<season>(?<!\d+)\d{1,4}(?!\d+))(?:[_. ]+(?!\d+)|$)`)
	simpleEpisodeNumberRegex = ci(`^[ex]?(?<episode>(?<!\d+)\d{1,3}(?!\d+))(?:[ex-](?<episode>(?<!\d+)\d{1,3}(?!\d+)))?(?:[_. ](?!\d+)(?<remaining>.+)|$)`)

	specialEpisodeTitleRegex = []*rx{
		ci(`\.S\d+E00\.(?<episodetitle>.+?)(?:\.(?:720p|1080p|2160p|HDTV|WEB|WEBRip|WEB-DL)\.|$)`),
		ci(`\.S\d+\.Special\.(?<episodetitle>.+?)(?:\.(?:720p|1080p|2160p|HDTV|WEB|WEBRip|WEB-DL)\.|$)`),
	}

	numberWords = []string{"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"}
)

// errInvalidDate is Sonarr's InvalidDateException: the name has a date that
// cannot be an air date.
type invalidDateError struct{ msg string }

func (e *invalidDateError) Error() string { return e.msg }

// parseSeriesPath ports Parser.ParsePath. Only "/" separates path segments.
func parseSeriesPath(path string) (ParsedRelease, error) {
	dir, file := "", path
	if i := strings.LastIndex(path, "/"); i >= 0 {
		file = path[i+1:]
		dirPath := strings.TrimRight(path[:i], "/")
		dir = dirPath[strings.LastIndex(dirPath, "/")+1:]
	}
	hasDir := dir != ""

	result, ok := parseSeriesTitle(file)

	// Parse using the folder and file separately, but combine if they both
	// parse correctly.
	if m := simpleEpisodeNumberRegex.match(file); m != nil && hasDir &&
		(!ok || (result.Series != nil && (result.Series.MiniSeries || len(result.Series.AbsoluteEpisodes) > 0))) {
		if sm := seasonFolderRegex.match(dir); sm != nil && hasGroup(sm, "season") {
			caps := captureValues(m, "episode")
			first, err1 := parseNumber(caps[0])
			last, err2 := parseNumber(caps[len(caps)-1])
			if err1 == nil && err2 == nil {
				season, _ := group(sm, "season")
				pathTitle := fmt.Sprintf("S%sE%02d", season, first)
				if first != last {
					pathTitle += fmt.Sprintf("-E%02d", last)
				}
				if rem, ok := group(m, "remaining"); ok {
					pathTitle += " " + rem
				}

				if r, ok := parseSeriesTitle(pathTitle); ok {
					return r, nil
				}
				return ParsedRelease{}, ErrUnparseable
			}
			return ParsedRelease{}, ErrUnparseable
		}
	}

	if !ok {
		if number, err := strconv.Atoi(strings.TrimSpace(strings.TrimSuffix(file, pathExtension(file)))); err == nil {
			result, ok = parseSeriesTitle(dir)
			switch {
			case ok && containsInt(result.Series.AbsoluteEpisodes, number):
				result.Series.AbsoluteEpisodes = []int{number}
			case ok && containsInt(result.Series.Episodes, number):
				result.Series.Episodes = []int{number}
			default:
				ok = false
			}
		}
	}

	if !ok {
		result, ok = parseSeriesTitle(dir + " " + file)
	}

	if !ok {
		result, ok = parseSeriesTitle(dir + pathExtension(file))
	}

	if !ok {
		return ParsedRelease{}, ErrUnparseable
	}
	return result, nil
}

func containsInt(s []int, v int) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// simplifySeriesTitle ports Parser.SimplifyTitle.
func simplifySeriesTitle(title string) string {
	if !validateSeriesBeforeParsing(title) {
		return title
	}

	if reversedTitleRegexSeries.isMatch(title) {
		title = reverseTitle(title)
	}

	simple := websitePrefixRegex.replace(title, "")
	simple = websitePostfixRegex.replace(simple, "")
	return cleanTorrentSuffixRegex.replace(simple, "")
}

// reverseTitle reverses the name without its file extension and keeps the
// extension in place.
func reverseTitle(title string) string {
	withoutExt := []rune(removeFileExtensionSeries(title))
	n := len(withoutExt)
	for i, j := 0, n-1; i < j; i, j = i+1, j-1 {
		withoutExt[i], withoutExt[j] = withoutExt[j], withoutExt[i]
	}
	return string(withoutExt) + string([]rune(title)[n:])
}

// parseSeriesTitle ports Parser.ParseTitle. A failure anywhere, including the
// exceptions Sonarr's try/catch swallows, is an unparseable name.
func parseSeriesTitle(title string) (result ParsedRelease, ok bool) {
	defer func() {
		if r := recover(); r != nil {
			result, ok = ParsedRelease{}, false
		}
	}()

	originalTitle := title

	if !validateSeriesBeforeParsing(title) {
		return ParsedRelease{}, false
	}

	if reversedTitleRegexSeries.isMatch(title) {
		title = reverseTitle(title)
	}

	releaseTitle := removeFileExtensionSeries(title)

	releaseTitle = strings.ReplaceAll(strings.ReplaceAll(releaseTitle, "【", "["), "】", "]")

	for _, p := range preSubstitutions {
		releaseTitle = p.re.replace(releaseTitle, p.repl)
	}

	simpleTitle := simpleTitleRegexSeries.replace(releaseTitle, "")

	// TODO upstream: quick fix stripping [url] - prefixes and postfixes.
	simpleTitle = websitePrefixRegex.replace(simpleTitle, "")
	simpleTitle = websitePostfixRegex.replace(simpleTitle, "")

	simpleTitle = cleanTorrentSuffixRegex.replace(simpleTitle, "")

	simpleTitle = cleanQualityBracketsRegex.replaceFunc(simpleTitle, func(m *regexp2.Match) string {
		if parseQualityNameSeries(m.String()).Quality != sUnknown {
			return ""
		}
		return m.String()
	})

	if m := sixDigitAirDateRegex.match(simpleTitle); m != nil {
		airYear, _ := group(m, "airyear")
		airMonth, _ := group(m, "airmonth")
		airDay, _ := group(m, "airday")

		if airMonth != "00" || airDay != "00" {
			airDate, _ := group(m, "airdate")
			fixed := fmt.Sprintf("20%s.%s.%s", airYear, airMonth, airDay)
			simpleTitle = strings.ReplaceAll(simpleTitle, airDate, fixed)
		}
	}

	for _, re := range reportTitleRegexSeries {
		matches := re.matchAll(simpleTitle)
		if len(matches) == 0 {
			continue
		}

		parsed, matched, err := parseMatchCollection(matches, simpleTitle, releaseTitle)
		if err != nil {
			// InvalidDateException stops the search; every other exception is
			// caught by ParseTitle. Either way the name is unparseable.
			return ParsedRelease{}, false
		}
		if !matched {
			continue
		}

		info := parsed.Series
		if info.FullSeason && containsFold(info.ReleaseTokens, "Special") {
			info.FullSeason = false
			info.Special = true
		}

		parsed.Languages = parseLanguagesSeries(info.ReleaseTokens)
		parsed.Quality = parseQualitySeries(title)
		parsed.ReleaseGroup = parseReleaseGroupSeries(releaseTitle)

		if sub, ok := group(matches[0], "subgroup"); ok && strings.TrimSpace(sub) != "" {
			parsed.ReleaseGroup = sub
		}

		parsed.ReleaseHash = releaseHash(matches)

		parsed.Kind = KindSeries
		parsed.OriginalTitle = originalTitle
		parsed.ReleaseTitle = releaseTitle
		parsed.SimpleReleaseTitle = simplifySeriesTitle(title)
		return parsed, true
	}

	return ParsedRelease{}, false
}

// parseMatchCollection ports Parser.ParseMatchCollection. matched is false
// where Sonarr returns null and the next pattern is tried; err ends parsing.
func parseMatchCollection(matches []*regexp2.Match, simpleTitle, releaseTitle string) (ParsedRelease, bool, error) {
	first := matches[0]

	seriesName, _ := group(first, "title")
	seriesName = strings.ReplaceAll(strings.ReplaceAll(seriesName, ".", " "), "_", " ")
	seriesName = strings.Trim(requestInfoRegex.replace(seriesName, ""), " ")

	airYear, _ := group(first, "airyear")
	airYearNum, _ := strconv.Atoi(strings.TrimSpace(airYear))

	// All indexes are rune offsets into simpleTitle; they become UTF-16 units
	// at the end, as .NET counts them.
	lastIndex := groupEnd(first, "title")

	info := &SeriesInfo{}
	var result ParsedRelease

	if airYearNum < 1900 {
		for _, m := range matches {
			episodeCaps := captures(m, "episode")
			absoluteCaps := captures(m, "absoluteepisode")

			// Allows a list of 0 episodes (handled as a full season release).
			if len(episodeCaps) > 0 {
				firstEp, err := parseNumber(episodeCaps[0].String())
				if err != nil {
					return ParsedRelease{}, false, err
				}
				lastEp, err := parseNumber(episodeCaps[len(episodeCaps)-1].String())
				if err != nil {
					return ParsedRelease{}, false, err
				}

				if firstEp > lastEp {
					return ParsedRelease{}, false, nil
				}

				info.Episodes = intRange(firstEp, lastEp-firstEp+1)

				lastIndex = max(lastIndex, captureEnd(episodeCaps[len(episodeCaps)-1]))

				if hasGroup(m, "special") {
					info.Special = true
				}
				if hasGroup(m, "splitepisode") {
					info.SplitEpisode = true
				}
			}

			if len(absoluteCaps) > 0 {
				firstAbs, err := parseDecimal(absoluteCaps[0].String())
				if err != nil {
					return ParsedRelease{}, false, err
				}
				lastAbs, err := parseDecimal(absoluteCaps[len(absoluteCaps)-1].String())
				if err != nil {
					return ParsedRelease{}, false, err
				}

				if firstAbs > lastAbs {
					return ParsedRelease{}, false, nil
				}

				if firstAbs != float64(int64(firstAbs)) || lastAbs != float64(int64(lastAbs)) {
					if len(absoluteCaps) != 1 {
						return ParsedRelease{}, false, nil // multiple matches not allowed for specials
					}

					info.SpecialAbsoluteEpisodes = []float64{firstAbs}
					info.Special = true

					lastIndex = max(lastIndex, captureEnd(absoluteCaps[0]))
				} else {
					info.AbsoluteEpisodes = intRange(int(firstAbs), int(lastAbs-firstAbs)+1)

					if hasGroup(m, "special") {
						info.Special = true
					}

					lastIndex = max(lastIndex, captureEnd(absoluteCaps[len(absoluteCaps)-1]))
				}
			}

			if len(episodeCaps) == 0 && len(absoluteCaps) == 0 {
				// An "Extras" or "SUBPACK" release is flagged so it can be
				// filtered out.
				if extras, _ := group(first, "extras"); strings.TrimSpace(extras) != "" {
					info.SeasonExtra = true
				}

				// Partial season packs carry a seasonpart group, which tells
				// them from a full season or single episode release.
				if part, _ := group(first, "seasonpart"); strings.TrimSpace(part) != "" {
					n, err := strconv.Atoi(strings.TrimSpace(part))
					if err != nil {
						return ParsedRelease{}, false, err
					}
					info.SeasonPart = n
					info.PartialSeason = true
				} else {
					info.FullSeason = true
				}
			}

			if len(episodeCaps) == 2 && hasGroup(first, "episodecount") {
				if count, _ := group(first, "episodecount"); episodeCaps[1].String() == count {
					info.Episodes = nil
					info.FullSeason = true
				}
			}
		}

		var seasons []int
		for _, c := range captures(first, "season") {
			if n, err := strconv.Atoi(strings.TrimSpace(c.String())); err == nil {
				seasons = append(seasons, n)
				lastIndex = max(lastIndex, captureEnd(c))
			}
		}

		// More than one season is flagged so it can be rejected later.
		if distinctCount(seasons) > 1 {
			info.MultiSeason = true
		}

		if len(seasons) > 0 {
			// The first season is the season.
			info.Season = seasons[0]
		} else if len(info.AbsoluteEpisodes) == 0 && len(info.Episodes) > 0 {
			// No season and not absolute only: a mini series, season 1.
			info.Season = 1
			info.MiniSeries = true
		}
	} else {
		// Try to parse as a daily show.
		var airMonth, airDay int

		if hasGroup(first, "ambiguousairmonth") && hasGroup(first, "ambiguousairday") {
			m, err := atoi(first, "ambiguousairmonth")
			if err != nil {
				return ParsedRelease{}, false, err
			}
			d, err := atoi(first, "ambiguousairday")
			if err != nil {
				return ParsedRelease{}, false, err
			}

			if d <= 12 && m <= 12 {
				return ParsedRelease{}, false, &invalidDateError{fmt.Sprintf("ambiguous date, cannot validate month and day with %d and %d", m, d)}
			}

			airMonth, airDay = m, d
		} else {
			var err error
			if airMonth, err = atoi(first, "airmonth"); err != nil {
				return ParsedRelease{}, false, err
			}
			if airDay, err = atoi(first, "airday"); err != nil {
				return ParsedRelease{}, false, err
			}

			// Swap day and month if the month is bigger than 12 (scene fail).
			if airMonth > 12 {
				airDay, airMonth = airMonth, airDay
			}
		}

		airDate := time.Date(airYearNum, time.Month(airMonth), airDay, 0, 0, 0, 0, time.UTC)
		if airMonth < 1 || airMonth > 12 || airDay < 1 || airDate.Day() != airDay || int(airDate.Month()) != airMonth {
			return ParsedRelease{}, false, &invalidDateError{fmt.Sprintf("invalid date found: %d-%d-%d", airYearNum, airMonth, airDay)}
		}

		// An episode in the future is most likely a parse error.
		n := now()
		limit := time.Date(n.Year(), n.Month(), n.Day()+1, 0, 0, 0, 0, time.UTC)
		if airDate.After(limit) {
			return ParsedRelease{}, false, &invalidDateError{fmt.Sprintf("invalid date found: %s", airDate.Format("2006-01-02"))}
		}

		// Before 1970, and not the Plex DVR format (no title year), is an error.
		if airDate.Before(time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC)) && !hasNonBlank(first, "titleyear") {
			return ParsedRelease{}, false, &invalidDateError{fmt.Sprintf("invalid date found: %s", airDate.Format("2006-01-02"))}
		}

		lastIndex = max(lastIndex, groupEnd(first, "airyear"))
		lastIndex = max(lastIndex, groupEnd(first, "airmonth"))
		lastIndex = max(lastIndex, groupEnd(first, "airday"))

		info.AirDate = airDate.Format("2006-01-02")

		if part, ok := group(first, "part"); ok {
			n, err := strconv.Atoi(strings.TrimSpace(part))
			if err != nil {
				return ParsedRelease{}, false, err
			}
			info.DailyPart = n
		}
	}

	if lastIndex16 := utf16Index(simpleTitle, lastIndex); lastIndex16 < utf16Len(releaseTitle) {
		info.ReleaseTokens = substringUTF16(releaseTitle, lastIndex16)
	} else {
		info.ReleaseTokens = releaseTitle
	}

	result.Titles = []string{seriesName}
	titleInfo := seriesTitleInfo(seriesName, first)
	info.TitleWithoutYear = titleInfo.titleWithoutYear
	info.AllTitles = titleInfo.allTitles
	result.Year = titleInfo.year
	for _, t := range titleInfo.allTitles {
		if t != seriesName && !isBlank(t) {
			result.Titles = append(result.Titles, t)
		}
	}

	result.Series = info
	return result, true, nil
}

type seriesTitleInfoResult struct {
	titleWithoutYear string
	year             int
	allTitles        []string
}

// seriesTitleInfo ports Parser.GetSeriesTitleInfo.
func seriesTitleInfo(title string, first *regexp2.Match) seriesTitleInfoResult {
	var info seriesTitleInfoResult

	if m := yearInTitleRegex.match(title); m == nil {
		info.titleWithoutYear = title
	} else {
		info.titleWithoutYear, _ = group(m, "title")
		y, _ := group(m, "year")
		info.year, _ = strconv.Atoi(y)
	}

	if m := titleComponentsRegex.match(info.titleWithoutYear); m != nil {
		info.allTitles = captureValues(m, "title")
	} else if caps := captures(first, "title"); len(caps) > 1 {
		for _, c := range caps {
			info.allTitles = append(info.allTitles, strings.ReplaceAll(strings.ReplaceAll(c.String(), ".", " "), "_", " "))
		}
	}

	return info
}

func releaseHash(matches []*regexp2.Match) string {
	h, ok := group(matches[0], "hash")
	if !ok {
		return ""
	}
	h = strings.Trim(h, "[]()")
	if h == "1280x720" {
		return ""
	}
	return h
}

// parseReleaseGroupSeries ports Sonarr's Parser.ParseReleaseGroup. It must
// equal Sonarr's or the release-group Custom Formats stop matching.
func parseReleaseGroupSeries(title string) string {
	title = strings.TrimSpace(title)
	title = removeFileExtensionSeries(title)
	for _, p := range preSubstitutions {
		if p.re.isMatch(title) {
			title = p.re.replace(title, p.repl)
			break
		}
		title = p.re.replace(title, p.repl)
	}

	title = websitePrefixRegex.replace(title, "")
	title = cleanTorrentSuffixRegex.replace(title, "")

	if m := animeReleaseGroupRegex.match(title); m != nil {
		v, _ := group(m, "subgroup")
		return v
	}

	title = cleanReleaseGroupRegexSeries.replace(title, "")

	if ms := exceptionReleaseGroupRegexSeries.matchAll(title); len(ms) != 0 {
		v, _ := group(ms[len(ms)-1], "releasegroup")
		return v
	}

	if ms := exceptionReleaseGroupRegexExactSeries.matchAll(title); len(ms) != 0 {
		v, _ := group(ms[len(ms)-1], "releasegroup")
		return v
	}

	if ms := releaseGroupRegexSeries.matchAll(title); len(ms) != 0 {
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

// removeFileExtensionSeries strips a media file extension (and .par2, .nzb).
func removeFileExtensionSeries(title string) string {
	return fileExtensionRegex.replaceFunc(title, func(m *regexp2.Match) string {
		ext := strings.ToLower(m.String())
		if isSonarrMediaExtension(ext) || ext == ".par2" || ext == ".nzb" {
			return ""
		}
		return m.String()
	})
}

func validateSeriesBeforeParsing(title string) bool {
	lower := strings.ToLower(title)
	if strings.Contains(lower, "password") && strings.Contains(lower, "yenc") {
		return false
	}

	hasLetterOrDigit := false
	for _, r := range title {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			hasLetterOrDigit = true
			break
		}
	}
	if !hasLetterOrDigit {
		return false
	}

	withoutExt := removeFileExtensionSeries(title)
	for _, re := range rejectHashedReleasesRegexSeries {
		if re.isMatch(withoutExt) {
			return false
		}
	}

	for _, re := range seasonFolderRegexes {
		if re.isMatch(withoutExt) {
			return false
		}
	}

	return true
}

// CleanSeriesTitle reduces a Series title to the form titles are compared in:
// lower case, no accents, no punctuation and no articles in the middle
// ("3%" becomes "3percent").
func CleanSeriesTitle(title string) string {
	if isBlank(title) {
		return title
	}

	// If the title only contains numbers return it as is.
	if _, err := strconv.ParseInt(strings.TrimSpace(title), 10, 64); err == nil {
		return title
	}

	title = percentRegex.replace(title, "percent")

	return removeAccent(strings.ToLower(normalizeSeriesRegex.replace(title, "")))
}

// NormalizeEpisodeTitle reduces an episode title for comparison with a
// release's own: punctuation and repeated spaces dropped, lower case.
func NormalizeEpisodeTitle(title string) string {
	for _, re := range specialEpisodeTitleRegex {
		if m := re.match(title); m != nil {
			title, _ = group(m, "episodetitle")
			break
		}
	}

	title = partRegex.replace(title, "")
	title = punctuationRegex.replace(title, " ")
	title = duplicateSpacesRegex.replace(title, " ")

	return strings.ToLower(strings.TrimSpace(title))
}

// parseSeriesName ports Parser.ParseSeriesName.
func parseSeriesName(title string) string {
	if p, ok := parseSeriesTitle(title); ok {
		return p.Title()
	}
	return CleanSeriesTitle(title)
}

func intRange(start, count int) []int {
	out := make([]int, 0, max(count, 0))
	for i := 0; i < count; i++ {
		out = append(out, start+i)
	}
	return out
}

func distinctCount(s []int) int {
	seen := map[int]bool{}
	for _, v := range s {
		seen[v] = true
	}
	return len(seen)
}

// captures returns every capture of the named group, in order.
func captures(m *regexp2.Match, name string) []regexp2.Capture {
	if m == nil {
		return nil
	}
	g := m.GroupByName(name)
	if g == nil {
		return nil
	}
	return g.Captures
}

func captureValues(m *regexp2.Match, name string) []string {
	var out []string
	for _, c := range captures(m, name) {
		out = append(out, c.String())
	}
	return out
}

func captureEnd(c regexp2.Capture) int { return c.Index + c.Length }

// groupEnd is the end of the group's last capture, 0 if it took no part.
func groupEnd(m *regexp2.Match, name string) int {
	caps := captures(m, name)
	if len(caps) == 0 {
		return 0
	}
	return captureEnd(caps[len(caps)-1])
}

func hasNonBlank(m *regexp2.Match, name string) bool {
	v, _ := group(m, name)
	return strings.TrimSpace(v) != ""
}

// atoi is Convert.ToInt32 on a group's value; an absent group is a format error.
func atoi(m *regexp2.Match, name string) (int, error) {
	v, _ := group(m, name)
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return 0, fmt.Errorf("%q is not a number", v)
	}
	return n, nil
}

// utf16Index converts a rune offset into s to a UTF-16 code unit offset.
func utf16Index(s string, runeIdx int) int {
	n := 0
	for i, r := range []rune(s) {
		if i >= runeIdx {
			break
		}
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// substringUTF16 is C#'s s.Substring(n) with n in UTF-16 code units.
func substringUTF16(s string, n int) string {
	units := 0
	for i, r := range s {
		if units >= n {
			return s[i:]
		}
		if r >= 0x10000 {
			units += 2
		} else {
			units++
		}
	}
	return ""
}

// parseNumber ports Parser.ParseNumber: digits (including other scripts and
// full-width forms), or a number word from zero to nine.
func parseNumber(value string) (int, error) {
	normalized := convertToNumerals(norm.NFKC.String(value))

	if n, err := strconv.Atoi(strings.TrimSpace(normalized)); err == nil {
		return n, nil
	}

	for i, w := range numberWords {
		if strings.ToLower(value) == w {
			return i, nil
		}
	}

	return 0, fmt.Errorf("%s isn't a number", value)
}

func parseDecimal(value string) (float64, error) {
	normalized := convertToNumerals(norm.NFKC.String(value))

	f, err := strconv.ParseFloat(strings.TrimSpace(normalized), 64)
	if err != nil {
		return 0, fmt.Errorf("%s isn't a number", value)
	}
	return f, nil
}

// convertToNumerals replaces decimal digits of any script with ASCII digits.
func convertToNumerals(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsDigit(r) && r > unicode.MaxASCII {
			// Decimal digit blocks are runs of ten, zero first.
			start := r
			for unicode.IsDigit(start-1) && start > 0 {
				start--
			}
			b.WriteRune('0' + (r-start)%10)
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}
