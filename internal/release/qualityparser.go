package release

// Ported from Radarr v5.28.0.10274 (54cbbe05d976ac053744012f8b48d44e384e2d41):
// src/NzbDrone.Core/Parser/QualityParser.cs. Radarr is GPL-3.0, like Kestrel.

import (
	"strconv"
	"strings"

	"github.com/dlclark/regexp2"
)

var (
	sourceRegex = cix(`\b(?:
                                                            (?<bluray>M?Blu[-_. ]?Ray|HD[-_. ]?DVD|BD(?!$)|UHD2?BD|BDISO|BDMux|BD25|BD50|BR[-_. ]?DISK)|
                                                            (?<webdl>WEB[-_. ]?DL(?:mux)?|AmazonHD|AmazonSD|iTunesHD|MaxdomeHD|NetflixU?HD|WebHD|HBOMaxHD|DisneyHD|[. ]WEB[. ](?:[xh][ .]?26[45]|AVC|HEVC|DDP?5[. ]1)|[. ](?-i:WEB)$|(?:\d{3,4}0p)[-. ](?:Hybrid[-_. ]?)?WEB[-. ]|[-. ]WEB[-. ]\d{3,4}0p|\b\s\/\sWEB\s\/\s\b|(?:AMZN|NF|DP)[. -]WEB[. -](?!Rip))|
                                                            (?<webrip>WebRip|Web-Rip|WEBMux)|
                                                            (?<hdtv>HDTV)|
                                                            (?<bdrip>BDRip|BDLight|HD[-_. ]?DVDRip|UHDBDRip)|
                                                            (?<brrip>BRRip)|
                                                            (?<dvdr>\d?x?M?DVD-?[R59])|
                                                            (?<dvd>DVD(?!-R)|DVDRip|xvidvd)|
                                                            (?<dsr>WS[-_. ]DSR|DSR)|
                                                            (?<regional>R[0-9]{1}|REGIONAL)|
                                                            (?<scr>SCR|SCREENER|DVDSCR|DVDSCREENER)|
                                                            (?<ts>TS[-_. ]|TELESYNCH?|HD-TS|HDTS|PDVD|TSRip|HDTSRip)|
                                                            (?<tc>TC|TELECINE|HD-TC|HDTC)|
                                                            (?<cam>CAMRIP|(?:NEW)?CAM|HD-?CAM(?:Rip)?|HQCAM)|
                                                            (?<wp>WORKPRINT|WP)|
                                                            (?<pdtv>PDTV)|
                                                            (?<sdtv>SDTV)|
                                                            (?<tvrip>TVRip)
                                                            )(?:\b|$|[ .])`)

	rawHDRegex = ci(`\b(?<rawhd>RawHD|Raw[-_. ]HD)\b`)

	mpeg2Regex = cs(`\b(?<mpeg2>MPEG[-_. ]?2)\b`)

	brDiskRegex = ci(`^(?!.*\b((?<!HD[._ -]|HD)DVD|BDRip|720p|MKV|XviD|WMV|d3g|(BD)?REMUX|^(?=.*1080p)(?=.*HEVC)|[xh][-_. ]?26[45]|German.*[DM]L|((?<=\d{4}).*German.*([DM]L)?)(?=.*\b(AVC|HEVC|VC[-_. ]?1|MVC|MPEG[-_. ]?2)\b))\b)(((?=.*\b(Blu[-_. ]?ray|BD|HD[-_. ]?DVD)\b)(?=.*\b(AVC|HEVC|VC[-_. ]?1|MVC|MPEG[-_. ]?2|BDMV|ISO)\b))|^((?=.*\b(((?=.*\b((.*_)?COMPLETE.*|Dis[ck])\b)(?=.*(Blu[-_. ]?ray|HD[-_. ]?DVD)))|3D[-_. ]?BD|BR[-_. ]?DISK|Full[-_. ]?Blu[-_. ]?ray|^((?=.*((BD|UHD)[-_. ]?(25|50|66|100|ISO)))))))).*`)

	properRegex = ci(`\b(?<proper>proper)\b`)

	repackRegex = ci(`\b(?<repack>repack\d?|rerip\d?)\b`)

	versionRegex = ci(`\d[-._ ]?v(?<version>\d)[-._ ]|\[v(?<version>\d)\]|repack(?<version>\d)|rerip(?<version>\d)`)

	realRegex = cs(`\b(?<real>REAL)\b`)

	resolutionRegex = ci(`\b(?:(?<R360p>360p)|(?<R480p>480p|480i|640x480|848x480)|(?<R540p>540p)|(?<R576p>576p)|(?<R720p>720p|1280x720|960p)|(?<R1080p>1080p|1920x1080|1440p|FHD|1080i|4kto1080p)|(?<R2160p>2160p|3840x2160|4k[-_. ](?:UHD|HEVC|BD|H\.?265)|(?:UHD|HEVC|BD|H\.?265)[-_. ]4k))\b`)

	// Handle cases where no resolution is in the release name (assume if UHD then 4k) or resolution is non-standard
	alternativeResolutionRegex = ci(`\b(?<R2160p>UHD)\b|(?<R2160p>\[4K\])`)

	codecRegex = ci(`\b(?:(?<x264>x264)|(?<h264>h264)|(?<xvidhd>XvidHD)|(?<xvid>X-?vid)|(?<divx>divx))\b`)

	otherSourceRegex = ci(`(?<hdtv>HD[-_. ]TV)|(?<sdtv>SD[-_. ]TV)`)

	animeBlurayRegex = ci(`bd(?:720|1080|2160)|(?<=[-_. (\[])bd(?=[-_. )\]])`)
	animeWebDlRegex  = ci(`\[WEB\]|[\[\(]WEB[ .]`)

	highDefPdtvRegex = ci(`hr[-_. ]ws`)

	remuxRegex       = ci(`(?:[_. \[]|\d{4}p-|\bHybrid-)(?<remux>(?:(BD|UHD)[-_. ]?)?Remux)\b|(?<remux>(?:(BD|UHD)[-_. ]?)?Remux[_. ]\d{4}p)`)
	germanRemuxRegex = ci(`((?<=\d{4}).*German.*([DM]L)?)(?=.*\b(AVC|HEVC|VC[_. -]?1|MVC|MPEG[_. -]?2))(?=.*Blu-?ray)`)
)

// ParseQuality parses the quality of a release name, falling back to the file
// extension when the name says nothing.
func ParseQuality(name string) QualityModel {
	if strings.TrimSpace(name) == "" {
		return QualityModel{Quality: qUnknown, Revision: Revision{Version: 1}}
	}

	name = strings.TrimSpace(name)
	result := parseQualityName(name)

	// Based on extension
	if result.Quality == qUnknown && !containsInvalidPathChars(name) {
		result.Quality = qualityForExtension(pathExtension(name))
		result.SourceDetection = DetectedExtension
		result.ResolutionDetection = DetectedExtension
		result.ModifierDetection = DetectedExtension
	}

	return result
}

// containsInvalidPathChars mirrors Path.GetInvalidPathChars on Linux (NUL only).
func containsInvalidPathChars(s string) bool { return strings.ContainsRune(s, 0) }

// pathExtension mirrors System.IO.Path.GetExtension.
func pathExtension(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		switch path[i] {
		case '.':
			if i == len(path)-1 {
				return ""
			}
			return path[i:]
		case '/':
			return ""
		}
	}
	return ""
}

// lastDotExtension mirrors NzbDrone.Common's GetPathExtension.
func lastDotExtension(path string) string {
	idx := strings.LastIndex(path, ".")
	if idx == -1 || idx == len(path)-1 {
		return ""
	}
	return path[idx:]
}

func containsFold(s, sub string) bool {
	return strings.Contains(strings.ToLower(s), strings.ToLower(sub))
}

func parseQualityName(name string) QualityModel {
	normalizedName := strings.TrimSpace(strings.ReplaceAll(name, "_", " "))
	result := parseQualityModifiers(name, normalizedName)

	var sourceMatch *regexp2.Match
	for _, m := range sourceRegex.matchAll(normalizedName) {
		sourceMatch = m
	}
	resolution := parseResolution(normalizedName)
	codec := codecRegex.match(normalizedName)
	remuxMatch := remuxRegex.isMatch(normalizedName) || germanRemuxRegex.isMatch(normalizedName)
	brDiskMatch := brDiskRegex.isMatch(normalizedName)

	if rawHDRegex.isMatch(normalizedName) && !brDiskMatch {
		result.SourceDetection = DetectedName
		result.ResolutionDetection = DetectedName
		result.Quality = qRAWHD
		return result
	}

	if resolution != ResolutionUnknown {
		result.ResolutionDetection = DetectedName
	}

	if sourceMatch != nil {
		result.SourceDetection = DetectedName

		if hasGroup(sourceMatch, "bluray") {
			if brDiskMatch {
				result.Quality = qBRDISK
				return result
			}

			if hasGroup(codec, "xvid") || hasGroup(codec, "divx") {
				result.Quality = qBluray480p
				return result
			}

			switch resolution {
			case Res2160p:
				if remuxMatch {
					result.Quality = qRemux2160p
				} else {
					result.Quality = qBluray2160p
				}
				return result
			case Res1080p:
				if remuxMatch {
					result.Quality = qRemux1080p
				} else {
					result.Quality = qBluray1080p
				}
				return result
			case Res720p:
				result.Quality = qBluray720p
				return result
			case Res576p:
				result.Quality = qBluray576p
				return result
			case Res360p, Res480p, Res540p:
				result.Quality = qBluray480p
				return result
			}

			// Treat a remux without a source as 1080p, not 720p.
			// 720p remux should fallback as 720p BluRay
			if remuxMatch && resolution != Res720p {
				result.Quality = qRemux1080p
				return result
			}

			result.Quality = qBluray720p
			return result
		}

		if hasGroup(sourceMatch, "webdl") {
			switch resolution {
			case Res2160p:
				result.Quality = qWEBDL2160p
			case Res1080p:
				result.Quality = qWEBDL1080p
			case Res720p:
				result.Quality = qWEBDL720p
			default:
				if strings.Contains(name, "[WEBDL]") {
					result.Quality = qWEBDL720p
				} else {
					result.Quality = qWEBDL480p
				}
			}
			return result
		}

		if hasGroup(sourceMatch, "webrip") {
			switch resolution {
			case Res2160p:
				result.Quality = qWEBRip2160p
			case Res1080p:
				result.Quality = qWEBRip1080p
			case Res720p:
				result.Quality = qWEBRip720p
			default:
				result.Quality = qWEBRip480p
			}
			return result
		}

		if hasGroup(sourceMatch, "scr") {
			result.Quality = qDVDSCR
			return result
		}

		if hasGroup(sourceMatch, "cam") {
			result.Quality = qCAM
			return result
		}

		if hasGroup(sourceMatch, "ts") {
			result.Quality = qTELESYNC
			result.Quality.Resolution = int(resolution)
			return result
		}

		if hasGroup(sourceMatch, "tc") {
			result.Quality = qTELECINE
			return result
		}

		if hasGroup(sourceMatch, "wp") {
			result.Quality = qWORKPRINT
			return result
		}

		if hasGroup(sourceMatch, "regional") {
			result.Quality = qREGIONAL
			return result
		}

		if hasGroup(sourceMatch, "hdtv") {
			if mpeg2Regex.isMatch(normalizedName) {
				result.Quality = qRAWHD
				return result
			}

			switch resolution {
			case Res2160p:
				result.Quality = qHDTV2160p
			case Res1080p:
				result.Quality = qHDTV1080p
			case Res720p:
				result.Quality = qHDTV720p
			default:
				if strings.Contains(name, "[HDTV]") {
					result.Quality = qHDTV720p
				} else {
					result.Quality = qSDTV
				}
			}
			return result
		}

		if hasGroup(sourceMatch, "bdrip") || hasGroup(sourceMatch, "brrip") {
			switch resolution {
			case Res720p:
				result.Quality = qBluray720p
			case Res1080p:
				result.Quality = qBluray1080p
			case Res2160p:
				result.Quality = qBluray2160p
			case Res576p:
				result.Quality = qBluray576p
			default:
				result.Quality = qBluray480p
			}
			return result
		}

		if hasGroup(sourceMatch, "dvdr") {
			result.Quality = qDVDR
			return result
		}

		if hasGroup(sourceMatch, "dvd") {
			result.Quality = qDVD
			return result
		}

		if hasGroup(sourceMatch, "pdtv") || hasGroup(sourceMatch, "sdtv") ||
			hasGroup(sourceMatch, "dsr") || hasGroup(sourceMatch, "tvrip") {
			if resolution == Res1080p || containsFold(normalizedName, "1080p") {
				result.Quality = qHDTV1080p
				return result
			}

			if resolution == Res720p || containsFold(normalizedName, "720p") {
				result.Quality = qHDTV720p
				return result
			}

			if highDefPdtvRegex.isMatch(normalizedName) {
				result.ResolutionDetection = DetectedName
				result.Quality = qHDTV720p
				return result
			}

			result.Quality = qSDTV
			return result
		}
	}

	if sourceMatch == nil && remuxMatch && resolution != ResolutionUnknown {
		result.SourceDetection = DetectedUnknown

		switch resolution {
		case Res480p:
			result.Quality = qBluray480p
			return result
		case Res720p:
			result.Quality = qBluray720p
			return result
		case Res2160p:
			result.Quality = qRemux2160p
			return result
		case Res1080p:
			result.Quality = qRemux1080p
			return result
		}
	}

	// Anime Bluray matching
	if animeBlurayRegex.isMatch(normalizedName) {
		result.SourceDetection = DetectedName

		if resolution == Res360p || resolution == Res480p || resolution == Res540p || resolution == Res576p ||
			containsFold(normalizedName, "480p") {
			result.ResolutionDetection = DetectedName
			result.Quality = qDVD
			return result
		}

		if resolution == Res1080p || containsFold(normalizedName, "1080p") {
			result.ResolutionDetection = DetectedName
			if remuxMatch {
				result.Quality = qRemux1080p
			} else {
				result.Quality = qBluray1080p
			}
			return result
		}

		if resolution == Res2160p || containsFold(normalizedName, "2160p") {
			result.ResolutionDetection = DetectedName
			if remuxMatch {
				result.Quality = qRemux2160p
			} else {
				result.Quality = qBluray2160p
			}
			return result
		}

		// Treat a remux without a source as 1080p, not 720p.
		// 720p remux should fallback as 720p BluRay
		if remuxMatch && resolution != Res720p {
			result.Quality = qRemux1080p
			return result
		}

		result.Quality = qBluray720p
		return result
	}

	if animeWebDlRegex.isMatch(normalizedName) {
		result.SourceDetection = DetectedName

		if resolution == Res360p || resolution == Res480p || resolution == Res540p || resolution == Res576p ||
			containsFold(normalizedName, "480p") {
			result.ResolutionDetection = DetectedName
			result.Quality = qWEBDL480p
			return result
		}

		if resolution == Res1080p || containsFold(normalizedName, "1080p") {
			result.ResolutionDetection = DetectedName
			result.Quality = qWEBDL1080p
			return result
		}

		if resolution == Res2160p || containsFold(normalizedName, "2160p") {
			result.ResolutionDetection = DetectedName
			result.Quality = qWEBDL2160p
			return result
		}

		result.Quality = qWEBDL720p
		return result
	}

	if resolution != ResolutionUnknown {
		source := SourceUnknown
		modifier := ModifierNone

		if remuxMatch {
			result.SourceDetection = DetectedName
			source = SourceBluray
			modifier = ModifierRemux
		} else if q := qualityForExtension(lastDotExtension(name)); q != qUnknown {
			result.SourceDetection = DetectedExtension
			source = q.Source
		}

		find := func(res int, unknown Quality) Quality {
			if source == SourceUnknown {
				return unknown
			}
			return radarrQualities.findBySourceAndResolution(source, res, modifier)
		}

		switch resolution {
		case Res2160p:
			result.ResolutionDetection = DetectedName
			result.Quality = find(2160, qHDTV2160p)
			return result
		case Res1080p:
			result.ResolutionDetection = DetectedName
			result.Quality = find(1080, qHDTV1080p)
			return result
		case Res720p:
			result.ResolutionDetection = DetectedName
			result.Quality = find(720, qHDTV720p)
			return result
		case Res360p, Res480p, Res540p, Res576p:
			result.ResolutionDetection = DetectedName
			result.Quality = find(480, qSDTV)
			return result
		}
	}

	if hasGroup(codec, "x264") {
		result.Quality = qSDTV
		return result
	}

	if containsFold(normalizedName, "848x480") {
		result.ResolutionDetection = DetectedName

		if strings.Contains(normalizedName, "dvd") {
			result.SourceDetection = DetectedName
			result.Quality = qDVD
		} else if containsFold(normalizedName, "bluray") {
			result.SourceDetection = DetectedName
			result.Quality = qBluray480p
		} else {
			result.Quality = qSDTV
		}
		return result
	}

	if containsFold(normalizedName, "1280x720") {
		result.ResolutionDetection = DetectedName

		if containsFold(normalizedName, "bluray") {
			result.SourceDetection = DetectedName
			result.Quality = qBluray720p
		} else {
			result.Quality = qHDTV720p
		}
		return result
	}

	if containsFold(normalizedName, "1920x1080") {
		result.ResolutionDetection = DetectedName

		if containsFold(normalizedName, "bluray") {
			result.SourceDetection = DetectedName
			result.Quality = qBluray1080p
		} else {
			result.Quality = qHDTV1080p
		}
		return result
	}

	for _, c := range []struct {
		token string
		q     Quality
	}{{"bluray720p", qBluray720p}, {"bluray1080p", qBluray1080p}, {"bluray2160p", qBluray2160p}} {
		if containsFold(normalizedName, c.token) {
			result.SourceDetection = DetectedName
			result.ResolutionDetection = DetectedName
			result.Quality = c.q
			return result
		}
	}

	if q := otherSourceMatch(normalizedName); q != qUnknown {
		result.SourceDetection = DetectedName
		result.Quality = q
	}

	return result
}

func parseResolution(name string) Resolution {
	match := resolutionRegex.match(name)
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

func otherSourceMatch(name string) Quality {
	match := otherSourceRegex.match(name)
	if match == nil {
		return qUnknown
	}
	if hasGroup(match, "sdtv") {
		return qSDTV
	}
	if hasGroup(match, "hdtv") {
		return qHDTV720p
	}
	return qUnknown
}

func parseQualityModifiers(name, normalizedName string) QualityModel {
	result := QualityModel{Quality: qUnknown, Revision: Revision{Version: 1}}

	version, versionOK := 0, false
	if m := versionRegex.match(normalizedName); m != nil {
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
