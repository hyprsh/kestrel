package release

import (
	"sort"
	"strings"
)

// Ported from Sonarr v4.0.20.3014 (cab419ade8ac7fcab5bf80394ee492abd35d5f5a):
// src/NzbDrone.Core/Qualities/Quality.cs, QualityFinder.cs and
// MediaFiles/MediaFileExtensions.cs. Sonarr is GPL-3.0, like Kestrel.

// The Sonarr quality table. IDs are Sonarr's and differ from Radarr's: the kind
// that parsed a release says which table a Quality.ID belongs to. Sonarr has
// no Modifier; a remux is its own Quality with the Blu-ray raw source.
var (
	sUnknown = Quality{0, "Unknown", SourceUnknown, 0, ModifierNone}

	sSDTV = Quality{1, "SDTV", SourceTV, 480, ModifierNone}
	sDVD  = Quality{2, "DVD", SourceDVD, 480, ModifierNone}

	sWEBDL1080p = Quality{3, "WEBDL-1080p", SourceWebDL, 1080, ModifierNone}
	sHDTV720p   = Quality{4, "HDTV-720p", SourceTV, 720, ModifierNone}
	sWEBDL720p  = Quality{5, "WEBDL-720p", SourceWebDL, 720, ModifierNone}
	sBluray720p = Quality{6, "Bluray-720p", SourceBluray, 720, ModifierNone}

	sBluray1080p = Quality{7, "Bluray-1080p", SourceBluray, 1080, ModifierNone}
	sWEBDL480p   = Quality{8, "WEBDL-480p", SourceWebDL, 480, ModifierNone}
	sHDTV1080p   = Quality{9, "HDTV-1080p", SourceTV, 1080, ModifierNone}
	sRAWHD       = Quality{10, "Raw-HD", SourceTVRaw, 1080, ModifierNone}

	sWEBRip480p  = Quality{12, "WEBRip-480p", SourceWebRip, 480, ModifierNone}
	sBluray480p  = Quality{13, "Bluray-480p", SourceBluray, 480, ModifierNone}
	sWEBRip720p  = Quality{14, "WEBRip-720p", SourceWebRip, 720, ModifierNone}
	sWEBRip1080p = Quality{15, "WEBRip-1080p", SourceWebRip, 1080, ModifierNone}
	sHDTV2160p   = Quality{16, "HDTV-2160p", SourceTV, 2160, ModifierNone}
	sWEBRip2160p = Quality{17, "WEBRip-2160p", SourceWebRip, 2160, ModifierNone}
	sWEBDL2160p  = Quality{18, "WEBDL-2160p", SourceWebDL, 2160, ModifierNone}
	sBluray2160p = Quality{19, "Bluray-2160p", SourceBluray, 2160, ModifierNone}

	sBluray1080pRemux = Quality{20, "Bluray-1080p Remux", SourceBlurayRaw, 1080, ModifierNone}
	sBluray2160pRemux = Quality{21, "Bluray-2160p Remux", SourceBlurayRaw, 2160, ModifierNone}
	sBluray576p       = Quality{22, "Bluray-576p", SourceBluray, 576, ModifierNone}
)

// sonarrQualities lists Quality.All in Sonarr's order.
var sonarrQualities = qualityTable{
	sUnknown, sSDTV, sWEBRip480p, sWEBDL480p, sDVD, sBluray480p, sBluray576p,
	sHDTV720p, sWEBRip720p, sWEBDL720p, sBluray720p,
	sHDTV1080p, sWEBRip1080p, sWEBDL1080p, sBluray1080p, sRAWHD,
	sHDTV2160p, sWEBRip2160p, sWEBDL2160p, sBluray2160p,
	sBluray1080pRemux, sBluray2160pRemux,
}

// sonarrSourceOrder is Sonarr's QualitySource enum order, which QualityFinder
// sorts and compares by (Radarr's Source order differs).
func sonarrSourceOrder(s Source) int {
	switch s {
	case SourceTV:
		return 1
	case SourceTVRaw:
		return 2
	case SourceWebDL:
		return 3
	case SourceWebRip:
		return 4
	case SourceDVD:
		return 5
	case SourceBluray:
		return 6
	case SourceBlurayRaw:
		return 7
	}
	return 0
}

// sonarrFileExtensions maps a media file extension to the quality Sonarr
// assumes for it (MediaFileExtensions). Keys are lower-case.
var sonarrFileExtensions = map[string]Quality{
	".webm": sUnknown,

	".m4v": sSDTV, ".3gp": sSDTV, ".nsv": sSDTV, ".ty": sSDTV, ".strm": sSDTV,
	".rm": sSDTV, ".rmvb": sSDTV, ".m3u": sSDTV, ".ifo": sSDTV, ".mov": sSDTV,
	".qt": sSDTV, ".divx": sSDTV, ".xvid": sSDTV, ".bivx": sSDTV, ".nrg": sSDTV,
	".pva": sSDTV, ".wmv": sSDTV, ".asf": sSDTV, ".asx": sSDTV, ".ogm": sSDTV,
	".ogv": sSDTV, ".m2v": sSDTV, ".avi": sSDTV, ".bin": sSDTV, ".dat": sSDTV,
	".dvr-ms": sSDTV, ".mpg": sSDTV, ".mpeg": sSDTV, ".mp4": sSDTV, ".avc": sSDTV,
	".vp3": sSDTV, ".svq3": sSDTV, ".nuv": sSDTV, ".viv": sSDTV, ".dv": sSDTV,
	".fli": sSDTV, ".flv": sSDTV, ".wpl": sSDTV,

	".img": sDVD, ".iso": sDVD, ".vob": sDVD,

	".mkv": sHDTV720p, ".ts": sHDTV720p, ".wtv": sHDTV720p,

	".m2ts": sBluray720p,
}

func sonarrQualityForExtension(ext string) Quality {
	if q, ok := sonarrFileExtensions[strings.ToLower(ext)]; ok {
		return q
	}
	return sUnknown
}

func isSonarrMediaExtension(ext string) bool {
	_, ok := sonarrFileExtensions[strings.ToLower(ext)]
	return ok
}

// sonarrFindBySourceAndResolution ports QualityFinder.FindBySourceAndResolution.
func sonarrFindBySourceAndResolution(source Source, resolution int) Quality {
	for _, q := range sonarrQualities {
		if q.Source == source && q.Resolution == resolution {
			return q
		}
	}

	// 576p releases with a Television or Web source must not roll up to Bluray 576p.
	if resolution < 720 {
		switch source {
		case SourceTV:
			return sSDTV
		case SourceWebDL:
			return sWEBDL480p
		case SourceWebRip:
			return sWEBRip480p
		}
	}

	var matching []Quality
	for _, q := range sonarrQualities {
		if q.Resolution == resolution {
			matching = append(matching, q)
		}
	}
	sort.SliceStable(matching, func(i, j int) bool {
		return sonarrSourceOrder(matching[i].Source) < sonarrSourceOrder(matching[j].Source)
	})
	for _, q := range matching {
		if sonarrSourceOrder(q.Source) >= sonarrSourceOrder(source) {
			return q
		}
	}
	return sUnknown
}
