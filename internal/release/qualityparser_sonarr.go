package release

// Ported from Sonarr v4.0.20.3014 (cab419ade8ac7fcab5bf80394ee492abd35d5f5a):
// src/NzbDrone.Core/Parser/QualityParser.cs. Sonarr is GPL-3.0, like Kestrel.
//
// Sonarr's quality parser is a different program from Radarr's (other
// regexes, no modifiers, a remux is a quality of its own), so Series names
// run through this one and Movie names through qualityparser.go.

import (
	"strconv"
	"strings"

	"github.com/dlclark/regexp2"
)

var (
	sourceRegexSeries = cix(`\b(?:
                                                                (?<bluray>BluRay|Blu-Ray|HD-?DVD|BDMux|BD(?!$))|
                                                                (?<webdl>WEB[-_. ]DL(?:mux)?|WEBDL|AmazonHD|AmazonSD|iTunesHD|MaxdomeHD|NetflixU?HD|WebHD|HBOMaxHD|DisneyHD|[. ]WEB[. ](?:[xh][ .]?26[45]|AVC|HEVC|DDP?5[. ]1)|[. ](?-i:WEB)$|(?:720|1080|2160)p[-. ]WEB[-. ]|[-. ]WEB[-. ](?:720|1080|2160)p|\b\s\/\sWEB\s\/\s\b|(?:AMZN|NF|DP)[. -]WEB[. -](?!Rip))|
                                                                (?<webrip>WebRip|Web-Rip|WEBMux)|
                                                                (?<hdtv>HDTV)|
                                                                (?<bdrip>BDRip|BDLight)|
                                                                (?<brrip>BRRip)|
                                                                (?<dvd>DVD|DVDRip|NTSC|PAL|xvidvd)|
                                                                (?<dsr>WS[-_. ]DSR|DSR)|
                                                                (?<pdtv>PDTV)|
                                                                (?<sdtv>SDTV)|
                                                                (?<tvrip>TVRip)
                                                                )(?:\b|$|[ .])`)

	rawHDRegexSeries = ci(`\b(?<rawhd>RawHD|Raw[-_. ]HD)\b`)

	versionRegexSeries = ci(`\d[-._ ]?v(?<version>\d)[-._ ]|\[v(?<version>\d)\]|repack(?<version>\d)|rerip(?<version>\d)|(?:480|576|720|1080|2160)p[._ ]v(?<version>\d)`)

	resolutionRegexSeries = ci(`\b(?:(?<R360p>360p)|(?<R480p>480p|480i|640x480|848x480)|(?<R540p>540p)|(?<R576p>576p)|(?<R720p>720p|1280x720|960p)|(?<R1080p>1080p|1920x1080|1440p|FHD|1080i|4kto1080p)|(?<R2160p>2160p|3840x2160|4k[-_. ](?:UHD|HEVC|BD|H265)|(?:UHD|HEVC|BD|H265)[-_. ]4k))\b`)

	codecRegexSeries = ci(`\b(?:(?<x264>x264)|(?<h264>h264)|(?<xvidhd>XvidHD)|(?<xvid>Xvid)|(?<divx>divx))\b`)

	remuxRegexSeries = ci(`(?:[_. ]|\d{4}p-|\bHybrid-)(?<remux>(?:(BD|UHD)[-_. ]?)?Remux)\b|(?<remux>(?:(BD|UHD)[-_. ]?)?Remux[_. ]\d{4}p)`)
)

// The remaining regexes of Sonarr's QualityParser are the same as Radarr's
// (proper, repack, real, alternative resolution, other source, anime, high
// definition PDTV, MPEG-2) and are shared with qualityparser.go.

// ParseQualityOf parses the quality of a release name for a kind: Radarr's
// parser and quality table for a Movie, Sonarr's for a Series. A kind with no
// parser yields Unknown.
func ParseQualityOf(name string, kind Kind) QualityModel {
	switch kind {
	case KindMovie:
		return ParseQuality(name)
	case KindSeries:
		return parseQualitySeries(name)
	}
	return QualityModel{Quality: qUnknown, Revision: Revision{Version: 1}}
}

// parseQualitySeries ports QualityParser.ParseQuality for Sonarr, falling back
// to the file extension when the name says nothing.
func parseQualitySeries(name string) QualityModel {
	if strings.TrimSpace(name) == "" {
		return QualityModel{Quality: sUnknown, Revision: Revision{Version: 1}}
	}

	name = strings.TrimSpace(name)
	result := parseQualityNameSeries(name)

	// Based on extension
	if result.Quality == sUnknown && !containsInvalidPathChars(name) {
		result.Quality = sonarrQualityForExtension(pathExtension(name))
		result.SourceDetection = DetectedExtension
		result.ResolutionDetection = DetectedExtension
	}

	return result
}

func parseQualityNameSeries(name string) QualityModel {
	normalizedName := strings.TrimSpace(strings.ReplaceAll(name, "_", " "))
	result := parseQualityModifiersSeries(name, normalizedName)

	if rawHDRegexSeries.isMatch(normalizedName) {
		result.SourceDetection = DetectedName
		result.ResolutionDetection = DetectedName
		result.Quality = sRAWHD
		return result
	}

	var sourceMatch *regexp2.Match
	for _, m := range sourceRegexSeries.matchAll(normalizedName) {
		sourceMatch = m
	}
	resolution := parseResolutionSeries(normalizedName)
	codec := codecRegexSeries.match(normalizedName)
	remuxMatch := remuxRegexSeries.isMatch(normalizedName)

	if resolution != ResolutionUnknown {
		result.ResolutionDetection = DetectedName
	}

	if sourceMatch != nil {
		result.SourceDetection = DetectedName

		switch {
		case hasGroup(sourceMatch, "bluray"):
			if hasGroup(codec, "xvid") || hasGroup(codec, "divx") {
				result.Quality = sBluray480p
				return result
			}

			switch resolution {
			case Res2160p:
				result.Quality = pick(remuxMatch, sBluray2160pRemux, sBluray2160p)
				return result
			case Res1080p:
				result.Quality = pick(remuxMatch, sBluray1080pRemux, sBluray1080p)
				return result
			case Res576p:
				result.Quality = sBluray576p
				return result
			case Res360p, Res480p, Res540p:
				result.Quality = sBluray480p
				return result
			}

			// Treat a remux without a source as 1080p, not 720p.
			// 720p remux should fall back to 720p BluRay.
			if remuxMatch && resolution != Res720p {
				result.Quality = sBluray1080pRemux
				return result
			}

			result.Quality = sBluray720p
			return result

		case hasGroup(sourceMatch, "webdl"):
			switch resolution {
			case Res2160p:
				result.Quality = sWEBDL2160p
			case Res1080p:
				result.Quality = sWEBDL1080p
			case Res720p:
				result.Quality = sWEBDL720p
			default:
				if strings.Contains(name, "[WEBDL]") {
					result.Quality = sWEBDL720p
				} else {
					result.Quality = sWEBDL480p
				}
			}
			return result

		case hasGroup(sourceMatch, "webrip"):
			switch resolution {
			case Res2160p:
				result.Quality = sWEBRip2160p
			case Res1080p:
				result.Quality = sWEBRip1080p
			case Res720p:
				result.Quality = sWEBRip720p
			default:
				result.Quality = sWEBRip480p
			}
			return result

		case hasGroup(sourceMatch, "hdtv"):
			if mpeg2Regex.isMatch(normalizedName) {
				result.Quality = sRAWHD
				return result
			}

			switch resolution {
			case Res2160p:
				result.Quality = sHDTV2160p
			case Res1080p:
				result.Quality = sHDTV1080p
			case Res720p:
				result.Quality = sHDTV720p
			default:
				if strings.Contains(name, "[HDTV]") {
					result.Quality = sHDTV720p
				} else {
					result.Quality = sSDTV
				}
			}
			return result

		case hasGroup(sourceMatch, "bdrip"), hasGroup(sourceMatch, "brrip"):
			switch resolution {
			case Res720p:
				result.Quality = sBluray720p
			case Res1080p:
				result.Quality = sBluray1080p
			case Res2160p:
				result.Quality = sBluray2160p
			default:
				result.Quality = sBluray480p
			}
			return result

		case hasGroup(sourceMatch, "dvd"):
			result.Quality = sDVD
			return result

		case hasGroup(sourceMatch, "pdtv"), hasGroup(sourceMatch, "sdtv"),
			hasGroup(sourceMatch, "dsr"), hasGroup(sourceMatch, "tvrip"):
			if resolution == Res1080p || containsFold(normalizedName, "1080p") {
				result.Quality = sHDTV1080p
				return result
			}

			if resolution == Res720p || containsFold(normalizedName, "720p") {
				result.Quality = sHDTV720p
				return result
			}

			if highDefPdtvRegex.isMatch(normalizedName) {
				result.ResolutionDetection = DetectedName
				result.Quality = sHDTV720p
				return result
			}

			result.Quality = sSDTV
			return result
		}
	}

	if sourceMatch == nil && remuxMatch && resolution != ResolutionUnknown {
		result.SourceDetection = DetectedUnknown

		switch resolution {
		case Res480p:
			result.Quality = sBluray480p
			return result
		case Res720p:
			result.Quality = sBluray720p
			return result
		case Res2160p:
			result.Quality = sBluray2160pRemux
			return result
		case Res1080p:
			result.Quality = sBluray1080pRemux
			return result
		}
	}

	// Anime Bluray matching
	if animeBlurayRegex.isMatch(normalizedName) {
		result.SourceDetection = DetectedName

		if resolution == Res360p || resolution == Res480p || resolution == Res540p ||
			resolution == Res576p || containsFold(normalizedName, "480p") {
			result.ResolutionDetection = DetectedName
			result.Quality = sDVD
			return result
		}

		if resolution == Res1080p || containsFold(normalizedName, "1080p") {
			result.ResolutionDetection = DetectedName
			result.Quality = pick(remuxMatch, sBluray1080pRemux, sBluray1080p)
			return result
		}

		if resolution == Res2160p || containsFold(normalizedName, "2160p") {
			result.ResolutionDetection = DetectedName
			result.Quality = pick(remuxMatch, sBluray2160pRemux, sBluray2160p)
			return result
		}

		// Treat a remux without a source as 1080p, not 720p.
		if remuxMatch && resolution != Res720p {
			result.Quality = sBluray1080pRemux
			return result
		}

		result.Quality = sBluray720p
		return result
	}

	if animeWebDlRegex.isMatch(normalizedName) {
		result.SourceDetection = DetectedName

		if resolution == Res360p || resolution == Res480p || resolution == Res540p ||
			resolution == Res576p || containsFold(normalizedName, "480p") {
			result.ResolutionDetection = DetectedName
			result.Quality = sWEBDL480p
			return result
		}

		if resolution == Res1080p || containsFold(normalizedName, "1080p") {
			result.ResolutionDetection = DetectedName
			result.Quality = sWEBDL1080p
			return result
		}

		if resolution == Res2160p || containsFold(normalizedName, "2160p") {
			result.ResolutionDetection = DetectedName
			result.Quality = sWEBDL2160p
			return result
		}

		result.Quality = sWEBDL720p
		return result
	}

	if resolution != ResolutionUnknown {
		source := SourceUnknown

		if remuxMatch {
			result.SourceDetection = DetectedName
			source = SourceBlurayRaw
		} else if q := sonarrQualityForExtension(lastDotExtension(name)); q != sUnknown {
			result.SourceDetection = DetectedExtension
			source = q.Source
		}

		pickRes := func(unknown Quality, res int) Quality {
			if source == SourceUnknown {
				return unknown
			}
			return sonarrFindBySourceAndResolution(source, res)
		}

		switch resolution {
		case Res2160p:
			result.ResolutionDetection = DetectedName
			result.Quality = pickRes(sHDTV2160p, 2160)
			return result
		case Res1080p:
			result.ResolutionDetection = DetectedName
			result.Quality = pickRes(sHDTV1080p, 1080)
			return result
		case Res720p:
			result.ResolutionDetection = DetectedName
			result.Quality = pickRes(sHDTV720p, 720)
			return result
		case Res360p, Res480p, Res540p, Res576p:
			result.ResolutionDetection = DetectedName
			result.Quality = pickRes(sSDTV, 480)
			return result
		}
	}

	if hasGroup(codec, "x264") {
		result.Quality = sSDTV
		return result
	}

	if strings.Contains(normalizedName, "848x480") {
		result.ResolutionDetection = DetectedName

		switch {
		case strings.Contains(normalizedName, "dvd"):
			result.SourceDetection = DetectedName
			result.Quality = sDVD
		case containsFold(normalizedName, "bluray"):
			result.SourceDetection = DetectedName
			result.Quality = sBluray480p
		default:
			result.Quality = sSDTV
		}
		return result
	}

	if containsFold(normalizedName, "1280x720") {
		result.ResolutionDetection = DetectedName

		if containsFold(normalizedName, "bluray") {
			result.SourceDetection = DetectedName
			result.Quality = sBluray720p
		} else {
			result.Quality = sHDTV720p
		}
		return result
	}

	if containsFold(normalizedName, "1920x1080") {
		result.ResolutionDetection = DetectedName

		if containsFold(normalizedName, "bluray") {
			result.SourceDetection = DetectedName
			result.Quality = sBluray1080p
		} else {
			result.Quality = sHDTV1080p
		}
		return result
	}

	for _, c := range []struct {
		token   string
		quality Quality
	}{
		{"bluray720p", sBluray720p},
		{"bluray1080p", sBluray1080p},
		{"bluray2160p", sBluray2160p},
	} {
		if containsFold(normalizedName, c.token) {
			result.SourceDetection = DetectedName
			result.ResolutionDetection = DetectedName
			result.Quality = c.quality
			return result
		}
	}

	if q := otherSourceMatchSeries(normalizedName); q != sUnknown {
		result.SourceDetection = DetectedName
		result.Quality = q
	}

	return result
}

func pick(cond bool, yes, no Quality) Quality {
	if cond {
		return yes
	}
	return no
}

func parseResolutionSeries(name string) Resolution {
	match := resolutionRegexSeries.match(name)
	alt := alternativeResolutionRegex.match(name)

	if match == nil && alt == nil {
		return ResolutionUnknown
	}

	switch {
	case hasGroup(match, "R360p"):
		return Res360p
	case hasGroup(match, "R480p"):
		return Res480p
	case hasGroup(match, "R540p"):
		return Res540p
	case hasGroup(match, "R576p"):
		return Res576p
	case hasGroup(match, "R720p"):
		return Res720p
	case hasGroup(match, "R1080p"):
		return Res1080p
	case hasGroup(match, "R2160p"), hasGroup(alt, "R2160p"):
		return Res2160p
	}

	return ResolutionUnknown
}

func otherSourceMatchSeries(name string) Quality {
	match := otherSourceRegex.match(name)
	if match == nil {
		return sUnknown
	}
	if hasGroup(match, "sdtv") {
		return sSDTV
	}
	if hasGroup(match, "hdtv") {
		return sHDTV720p
	}
	return sUnknown
}

func parseQualityModifiersSeries(name, normalizedName string) QualityModel {
	result := QualityModel{Quality: sUnknown, Revision: Revision{Version: 1}}

	version, versionOK := 0, false
	if m := versionRegexSeries.match(normalizedName); m != nil {
		if v, ok := group(m, "version"); ok {
			version, _ = strconv.Atoi(v)
			versionOK = true
		}
	}
	if versionOK {
		result.Revision.Version = version
		result.RevisionDetection = DetectedName
	}

	if properRegex.isMatch(normalizedName) {
		result.Revision.Version = 2
		if versionOK {
			result.Revision.Version = version + 1
		}
		result.RevisionDetection = DetectedName
	}

	if repackRegex.isMatch(normalizedName) {
		result.Revision.Version = 2
		if versionOK {
			result.Revision.Version = version + 1
		}
		result.Revision.IsRepack = true
		result.RevisionDetection = DetectedName
	}

	if n := len(realRegex.matchAll(name)); n > 0 {
		result.Revision.Real = n
		result.RevisionDetection = DetectedName
	}

	return result
}
