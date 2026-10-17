package release

// Ported from Radarr v5.28.0.10274 (54cbbe05d976ac053744012f8b48d44e384e2d41):
// src/NzbDrone.Core/Parser/Parser.cs (ParseMovieTitle, ParseMoviePath and the
// Movie title expressions). Radarr is GPL-3.0, like Kestrel.

import (
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/dlclark/regexp2"
)

const editionPattern = `\(?\b(?<edition>(((Recut.|Extended.|Ultimate.)?(Director.?s|Collector.?s|Theatrical|Ultimate|Extended|Despecialized|(Special|Rouge|Final|Assembly|Imperial|Diamond|Signature|Hunter|Rekall)(?=(.(Cut|Edition|Version)))|\d{2,3}(th)?.Anniversary)(?:.(Cut|Edition|Version))?(.(Extended|Uncensored|Remastered|Unrated|Uncut|Open.?Matte|IMAX|Fan.?Edit))?|((Uncensored|Remastered|Unrated|Uncut|Open?.Matte|IMAX|Fan.?Edit|Restored|((2|3|4)in1))))))\b\)?`

var (
	reportEditionRegex = ci(`^.+?` + editionPattern)

	reportMovieTitleRegex = []*rx{
		// Anime [Subgroup] and Year
		ci(`^(?:\[(?<subgroup>.+?)\][-_. ]?)(?<title>(?![(\[]).+?)?(?:(?:[-_\W](?<![)\[!]))*(?<year>(1(8|9)|20)\d{2}(?!p|i|x|\d+|\]|\W\d+)))+.*?(?<hash>\[\w{8}\])?(?:$|\.)`),

		// Anime [Subgroup] no year, versioned title, hash
		ci(`^(?:\[(?<subgroup>.+?)\][-_. ]?)(?<title>(?![(\[]).+?)((v)(?:\d{1,2})(?:([-_. ])))(\[.*)?(?:[\[(][^])])?.*?(?<hash>\[\w{8}\])(?:$|\.)`),

		// Anime [Subgroup] no year, info in double sets of brackets, hash
		ci(`^(?:\[(?<subgroup>.+?)\][-_. ]?)(?<title>(?![(\[]).+?)(\[.*).*?(?<hash>\[\w{8}\])(?:$|\.)`),

		// Anime [Subgroup] no year, info in parentheses or brackets, hash
		ci(`^(?:\[(?<subgroup>.+?)\][-_. ]?)(?<title>(?![(\[]).+)(?:[\[(][^])]).*?(?<hash>\[\w{8}\])(?:$|\.)`),

		// Some german or french tracker formats (missing year, ...) (Only applies to german and TrueFrench releases) - see ParserFixture for examples and tests - french removed as it broke all movies w/ french titles
		ci(`^(?<title>(?![(\[]).+?)((\W|_))(` + editionPattern + `.{1,3})?(?:(?<!(19|20)\d{2}.*?)(?<!(?:Good|The)[_ .-])(German|TrueFrench))(.+?)(?=((19|20)\d{2}|$))(?<year>(19|20)\d{2}(?!p|i|\d+|\]|\W\d+))?(\W+|_|$)(?!\\)`),

		// Special, Despecialized, etc. Edition Movies, e.g: Mission.Impossible.3.Special.Edition.2011
		ci(`^(?<title>(?![(\[]).+?)?(?:(?:[-_\W](?<![)\[!]))*` + editionPattern + `.{1,3}(?<year>(1(8|9)|20)\d{2}(?!p|i|\d+|\]|\W\d+)))+(\W+|_|$)(?!\\)`),

		// Normal movie format, e.g: Mission.Impossible.3.2011
		ci(`^(?<title>(?![(\[]).+?)?(?:(?:[-_\W](?<![)\[!]))*(?<year>(1(8|9)|20)\d{2}(?!p|i|(1(8|9)|20)\d{2}|\]|\W(1(8|9)|20)\d{2})))+(\W+|_|$)(?!\\)`),

		// PassThePopcorn Torrent names: Star.Wars[PassThePopcorn]
		ci(`^(?<title>.+?)?(?:(?:[-_\W](?<![()\[!]))*(?<year>(\[\w *\])))+(\W+|_|$)(?!\\)`),

		// That did not work? Maybe some tool uses [] for years. Who would do that?
		ci(`^(?<title>(?![(\[]).+?)?(?:(?:[-_\W](?<![)!]))*(?<year>(1(8|9)|20)\d{2}(?!p|i|\d+|\W\d+)))+(\W+|_|$)(?!\\)`),

		// As a last resort for movies that have ( or [ in their title.
		ci(`^(?<title>.+?)?(?:(?:[-_\W](?<![)\[!]))*(?<year>(1(8|9)|20)\d{2}(?!p|i|\d+|\]|\W\d+)))+(\W+|_|$)(?!\\)`),
	}

	reportMovieTitleFolderRegex = []*rx{
		// When year comes first.
		cs(`^(?:(?:[-_\W](?<![)!]))*(?<year>(19|20)\d{2}(?!p|i|\d+|\W\d+)))+(\W+|_|$)(?<title>.+?)?$`),
	}

	// Regex to split movie titles that contain `AKA`.
	alternativeTitleRegex = ci(`[ ]+(?:AKA|\/)[ ]+`)

	// Regex to unbracket alternative titles.
	bracketedAlternativeTitleRegex = ci(`(.*) \([ ]*AKA[ ]+(.*)\)`)

	normalizeAlternativeTitleRegex = ci(`[ ]+(?:A\.K\.A\.)[ ]+`)

	// Multi-part Movies: CD1, CD2, Disc 2. Kestrel only; Radarr does not read this.
	multiPartRegex = ci(`(?:^|[-_. \[(])(?:CD|Disc|Disk)[-_. ]?(?<part>\d{1,2})(?:$|[-_. \])])`)
)

// parseMoviePath ports Parser.ParseMoviePath.
func parseMoviePath(path string) (ParsedRelease, error) {
	dir, file := "", path
	if i := strings.LastIndex(path, "/"); i >= 0 {
		file = path[i+1:]
		dirPath := strings.TrimRight(path[:i], "/")
		dir = dirPath[strings.LastIndex(dirPath, "/")+1:]
	}

	if r, ok := parseMovieTitle(file, true); ok {
		return r, nil
	}
	if r, ok := parseMovieTitle(dir+" "+file, false); ok {
		return r, nil
	}
	if r, ok := parseMovieTitle(dir+pathExtension(file), false); ok {
		return r, nil
	}
	return ParsedRelease{}, ErrUnparseable
}

// parseMovieTitle ports Parser.ParseMovieTitle. A failure anywhere, including
// the panics Radarr's try/catch swallows, is an unparseable name.
func parseMovieTitle(title string, isDir bool) (result ParsedRelease, ok bool) {
	originalTitle := title

	if !validateBeforeParsing(title) {
		return ParsedRelease{}, false
	}

	if reversedTitleRegex.isMatch(title) {
		// Radarr formats the reversed char[] with string interpolation, which
		// yields the type name; the port keeps that result.
		withoutExt := removeFileExtension(title)
		title = "System.Char[]" + string([]rune(title)[utf8.RuneCountInString(withoutExt):])
	}

	releaseTitle := removeFileExtension(title)

	// Trim dashes from end
	releaseTitle = strings.Trim(releaseTitle, "-_")

	releaseTitle = strings.ReplaceAll(strings.ReplaceAll(releaseTitle, "【", "["), "】", "]")

	simpleTitle := simpleTitleRegex.replace(releaseTitle, "")

	// TODO: Quick fix stripping [url] - prefixes.
	simpleTitle = websitePrefixRegex.replace(simpleTitle, "")
	simpleTitle = websitePostfixRegex.replace(simpleTitle, "")

	simpleTitle = cleanTorrentSuffixRegex.replace(simpleTitle, "")

	simpleTitle = cleanQualityBracketsRegex.replaceFunc(simpleTitle, func(m *regexp2.Match) string {
		if parseQualityName(m.String()).Quality != qUnknown {
			return ""
		}
		return m.String()
	})

	regexes := reportMovieTitleRegex
	if isDir {
		regexes = append(append([]*rx{}, regexes...), reportMovieTitleFolderRegex...)
	}

	for _, re := range regexes {
		match := re.match(simpleTitle)
		if match == nil {
			continue
		}

		parsed, matched := parseMovieMatch(match)
		if !matched {
			continue
		}

		// TODO: Add tests for this!
		simpleReleaseTitle := simpleReleaseTitleRegex.replace(releaseTitle, "")

		titleGroup := match.GroupByName("title")
		titleOK := titleGroup != nil && len(titleGroup.Captures) > 0
		replaceString := parsed.Title()
		if titleOK {
			replaceString = titleGroup.String()
		}

		if !isBlank(replaceString) {
			placeholder := "A Movie"
			if strings.Contains(replaceString, ".") {
				placeholder = "A.Movie"
			}
			if titleOK {
				runes := []rune(simpleReleaseTitle)
				if titleGroup.Index+titleGroup.Length > len(runes) {
					// String.Remove throws; Radarr's catch turns that into "unable to parse".
					return ParsedRelease{}, false
				}
				simpleReleaseTitle = string(runes[:titleGroup.Index]) + placeholder + string(runes[titleGroup.Index+titleGroup.Length:])
			} else {
				simpleReleaseTitle = strings.ReplaceAll(simpleReleaseTitle, replaceString, placeholder)
			}
		}

		parsed.ReleaseGroup = ParseReleaseGroup(simpleReleaseTitle)

		if sub, ok := group(match, "subgroup"); ok && !isBlank(sub) {
			parsed.ReleaseGroup = sub
		}

		parsed.HardcodedSubs = parseHardcodeSubs(title)

		languageTitle := simpleReleaseTitle
		if !isBlank(parsed.ReleaseGroup) {
			languageTitle = strings.ReplaceAll(simpleReleaseTitle, parsed.ReleaseGroup, "RlsGrp")
		}
		parsed.Languages = ParseLanguages(languageTitle)

		parsed.Quality = ParseQuality(title)

		if parsed.Edition == "" {
			parsed.Edition = parseEdition(simpleReleaseTitle)
		}

		if hash, ok := group(match, "hash"); ok {
			hash = strings.Trim(hash, "[]")
			if hash != "1280x720" {
				parsed.ReleaseHash = hash
			}
		}

		parsed.OriginalTitle = originalTitle
		parsed.ReleaseTitle = releaseTitle
		parsed.SimpleReleaseTitle = simpleReleaseTitle

		parsed.ImdbID = parseImdbID(simpleReleaseTitle)
		parsed.TmdbID = parseTmdbID(simpleReleaseTitle)

		if m := multiPartRegex.match(releaseTitle); m != nil {
			if v, ok := group(m, "part"); ok {
				parsed.Part, _ = strconv.Atoi(v)
			}
		}

		parsed.Kind = KindMovie
		return parsed, true
	}

	return ParsedRelease{}, false
}

func parseEdition(languageTitle string) string {
	m := reportEditionRegex.match(languageTitle)
	if v, ok := group(m, "edition"); ok && !isBlank(v) {
		return strings.ReplaceAll(v, ".", " ")
	}
	return ""
}

func parseMovieMatch(match *regexp2.Match) (ParsedRelease, bool) {
	rawTitle, ok := group(match, "title")
	if !ok || rawTitle == "(" {
		return ParsedRelease{}, false
	}

	movieName := strings.ReplaceAll(rawTitle, "_", " ")
	movieName = normalizeAlternativeTitleRegex.replace(movieName, " AKA ")
	movieName = strings.Trim(requestInfoRegex.replace(movieName, ""), " ")

	parts := strings.Split(movieName, ".")
	var name strings.Builder
	previousAcronym := false
	for n, part := range parts {
		nextPart := ""
		if len(parts) >= n+2 {
			nextPart = parts[n+1]
		}

		lower := strings.ToLower(part)
		switch {
		case utf16Len(part) == 1 && lower != "a" && !isInt(part) &&
			(previousAcronym || n < len(parts)-1) &&
			(previousAcronym || utf16Len(nextPart) != 1 || !isInt(nextPart)):
			name.WriteString(part + ".")
			previousAcronym = true
		case lower == "a" && (previousAcronym || utf16Len(nextPart) == 1):
			name.WriteString(part + ".")
			previousAcronym = true
		case lower == "dr":
			name.WriteString(part + ".")
			previousAcronym = true
		default:
			if previousAcronym {
				name.WriteString(" ")
				previousAcronym = false
			}
			name.WriteString(part + " ")
		}
	}
	movieName = strings.Trim(name.String(), " ")

	result := ParsedRelease{}
	if y, ok := group(match, "year"); ok && isInt(y) {
		result.Year, _ = strconv.Atoi(strings.TrimSpace(y))
	}

	if e, ok := group(match, "edition"); ok {
		result.Edition = strings.ReplaceAll(e, ".", " ")
	}

	titles := []string{movieName}

	// Delete parentheses of the form (aka ...).
	unbracketed := bracketedAlternativeTitleRegex.replace(movieName, "$1 AKA $2")

	// Split by AKA and filter out empty and duplicate names.
	for _, alt := range alternativeTitleRegex.split(unbracketed) {
		if !isBlank(alt) && alt != movieName {
			titles = append(titles, alt)
		}
	}

	result.Titles = titles
	return result, true
}

func validateBeforeParsing(title string) bool {
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

	withoutExt := removeFileExtension(title)
	for _, re := range rejectHashedReleasesRegex {
		if re.isMatch(withoutExt) {
			return false
		}
	}

	return true
}

// utf16Len is C#'s string.Length.
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// isInt mirrors int.TryParse for the single characters and short tokens the
// title code tests.
func isInt(s string) bool {
	_, err := strconv.ParseInt(strings.TrimSpace(s), 10, 32)
	return err == nil
}
