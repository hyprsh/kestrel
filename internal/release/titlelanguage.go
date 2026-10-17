package release

// Ported from Radarr and Sonarr (GPL-3.0), the first half of
// src/NzbDrone.Core/Download/Aggregation/Aggregators/AggregateLanguages.cs:
//   Radarr v5.28.0.10274, commit 54cbbe05d976ac053744012f8b48d44e384e2d41
//   Sonarr v4.0.20.3014,  commit cab419ade8ac7fcab5bf80394ee492abd35d5f5a

import (
	"slices"
	"strings"
	"unicode/utf16"
)

var specialEpisodeWordRegex = ci(`\b(part|special|edition|christmas)\b\s?`)

// normalizeMovieTitle ports Radarr's Parser.NormalizeMovieTitle.
func normalizeMovieTitle(title string) string {
	title = specialEpisodeWordRegex.replace(title, "")
	title = punctuationRegex.replace(title, " ")
	title = duplicateSpacesRegex.replace(title, " ")
	return strings.ToLower(strings.TrimSpace(title))
}

// WithoutTitleLanguages drops from a release's parsed languages the ones the
// Title's own name accounts for, as Radarr and Sonarr do before they score: a
// Movie called "The German Doctor" does not make its Releases German. For
// Series the languages come from the titles of the episodes the release
// covers (episodeTitles). A language stays if the rest of the release name
// still names it. The result can be empty.
func WithoutTitleLanguages(p ParsedRelease, titleName string, episodeTitles []string) []Language {
	var (
		releaseTokens string
		normalize     func(string) string
		parse         func(string) []Language
		names         []string
	)
	if p.Kind == KindSeries {
		releaseTokens = p.ReleaseTitle
		if p.Series != nil && p.Series.ReleaseTokens != "" {
			releaseTokens = p.Series.ReleaseTokens
		}
		normalize, parse, names = NormalizeEpisodeTitle, parseLanguagesSeries, episodeTitles
	} else {
		releaseTokens = p.SimpleReleaseTitle
		if releaseTokens == "" {
			releaseTokens = p.ReleaseTitle
		}
		normalize, parse, names = normalizeMovieTitle, ParseLanguages, []string{titleName}
	}
	normalizedTokens := normalize(releaseTokens)

	var toRemove []Language
	for _, name := range names {
		nameLanguages := parse(name)
		if slices.Contains(nameLanguages, LangUnknown) {
			continue
		}
		normalizedName := normalize(name)
		// The index is found in the normalised tokens and applied to the raw
		// ones, as upstream does.
		if i := strings.Index(normalizedTokens, normalizedName); i >= 0 {
			releaseTokens = removeUTF16(releaseTokens, utf16Len(normalizedTokens[:i]), utf16Len(normalizedName))
			toRemove = append(toRemove, nameLanguages...)
		}
	}
	remaining := parse(releaseTokens)
	toRemove = slices.DeleteFunc(toRemove, func(l Language) bool { return slices.Contains(remaining, l) })

	kept := slices.DeleteFunc(slices.Clone(p.Languages), func(l Language) bool { return slices.Contains(toRemove, l) })
	return distinctLanguages(kept)
}

// removeUTF16 removes n UTF-16 code units starting at unit index idx, like
// .NET's String.Remove.
func removeUTF16(s string, idx, n int) string {
	u := utf16.Encode([]rune(s))
	if idx > len(u) {
		return s
	}
	end := min(idx+n, len(u))
	return string(utf16.Decode(append(u[:idx:idx], u[end:]...)))
}
