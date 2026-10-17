package release

import "strings"

// Ported from Radarr v5.28.0.10274 (54cbbe05d976ac053744012f8b48d44e384e2d41):
// src/NzbDrone.Core/Qualities/Quality.cs and MediaFiles/MediaFileExtensions.cs.
// Radarr is GPL-3.0, like Kestrel.

// The Radarr quality table. IDs are Radarr's; a Series parser (Sonarr) has its
// own table and IDs.
var (
	qUnknown = Quality{0, "Unknown", SourceUnknown, 0, ModifierNone}

	// Pre-release
	qWORKPRINT = Quality{24, "WORKPRINT", SourceWorkprint, 0, ModifierNone}
	qCAM       = Quality{25, "CAM", SourceCAM, 0, ModifierNone}
	qTELESYNC  = Quality{26, "TELESYNC", SourceTelesync, 0, ModifierNone}
	qTELECINE  = Quality{27, "TELECINE", SourceTelecine, 0, ModifierNone}
	qDVDSCR    = Quality{28, "DVDSCR", SourceDVD, 480, ModifierScreener}
	qREGIONAL  = Quality{29, "REGIONAL", SourceDVD, 480, ModifierRegional}

	// SD
	qSDTV = Quality{1, "SDTV", SourceTV, 480, ModifierNone}
	qDVD  = Quality{2, "DVD", SourceDVD, 0, ModifierNone}
	qDVDR = Quality{23, "DVD-R", SourceDVD, 480, ModifierRemux}

	// HDTV
	qHDTV720p  = Quality{4, "HDTV-720p", SourceTV, 720, ModifierNone}
	qHDTV1080p = Quality{9, "HDTV-1080p", SourceTV, 1080, ModifierNone}
	qHDTV2160p = Quality{16, "HDTV-2160p", SourceTV, 2160, ModifierNone}

	// Web-DL
	qWEBDL480p  = Quality{8, "WEBDL-480p", SourceWebDL, 480, ModifierNone}
	qWEBDL720p  = Quality{5, "WEBDL-720p", SourceWebDL, 720, ModifierNone}
	qWEBDL1080p = Quality{3, "WEBDL-1080p", SourceWebDL, 1080, ModifierNone}
	qWEBDL2160p = Quality{18, "WEBDL-2160p", SourceWebDL, 2160, ModifierNone}

	// Bluray
	qBluray480p  = Quality{20, "Bluray-480p", SourceBluray, 480, ModifierNone}
	qBluray576p  = Quality{21, "Bluray-576p", SourceBluray, 576, ModifierNone}
	qBluray720p  = Quality{6, "Bluray-720p", SourceBluray, 720, ModifierNone}
	qBluray1080p = Quality{7, "Bluray-1080p", SourceBluray, 1080, ModifierNone}
	qBluray2160p = Quality{19, "Bluray-2160p", SourceBluray, 2160, ModifierNone}

	qRemux1080p = Quality{30, "Remux-1080p", SourceBluray, 1080, ModifierRemux}
	qRemux2160p = Quality{31, "Remux-2160p", SourceBluray, 2160, ModifierRemux}

	qBRDISK = Quality{22, "BR-DISK", SourceBluray, 1080, ModifierBRDisk}

	// Others
	qRAWHD = Quality{10, "Raw-HD", SourceTV, 1080, ModifierRawHD}

	qWEBRip480p  = Quality{12, "WEBRip-480p", SourceWebRip, 480, ModifierNone}
	qWEBRip720p  = Quality{14, "WEBRip-720p", SourceWebRip, 720, ModifierNone}
	qWEBRip1080p = Quality{15, "WEBRip-1080p", SourceWebRip, 1080, ModifierNone}
	qWEBRip2160p = Quality{17, "WEBRip-2160p", SourceWebRip, 2160, ModifierNone}
)

// radarrQualities lists Quality.All in Radarr's order.
var radarrQualities = qualityTable{
	qUnknown, qWORKPRINT, qCAM, qTELESYNC, qTELECINE, qDVDSCR, qREGIONAL,
	qSDTV, qDVD, qDVDR,
	qHDTV720p, qHDTV1080p, qHDTV2160p,
	qWEBDL480p, qWEBDL720p, qWEBDL1080p, qWEBDL2160p,
	qWEBRip480p, qWEBRip720p, qWEBRip1080p, qWEBRip2160p,
	qBluray480p, qBluray576p, qBluray720p, qBluray1080p, qBluray2160p,
	qRemux1080p, qRemux2160p, qBRDISK, qRAWHD,
}

// radarrFileExtensions maps a media file extension to the quality Radarr
// assumes for it (MediaFileExtensions). Keys are lower-case.
var radarrFileExtensions = map[string]Quality{
	// Unknown
	".webm": qUnknown,

	// SD
	".m4v": qSDTV, ".3gp": qSDTV, ".nsv": qSDTV, ".ty": qSDTV, ".strm": qSDTV,
	".rm": qSDTV, ".rmvb": qSDTV, ".m3u": qSDTV, ".ifo": qSDTV, ".mov": qSDTV,
	".qt": qSDTV, ".divx": qSDTV, ".xvid": qSDTV, ".bivx": qSDTV, ".nrg": qSDTV,
	".pva": qSDTV, ".wmv": qSDTV, ".asf": qSDTV, ".asx": qSDTV, ".ogm": qSDTV,
	".ogv": qSDTV, ".m2v": qSDTV, ".avi": qSDTV, ".bin": qSDTV, ".dat": qSDTV,
	".dvr-ms": qSDTV, ".mpg": qSDTV, ".mpeg": qSDTV, ".mp4": qSDTV, ".avc": qSDTV,
	".vp3": qSDTV, ".svq3": qSDTV, ".nuv": qSDTV, ".viv": qSDTV, ".dv": qSDTV,
	".fli": qSDTV, ".flv": qSDTV, ".wpl": qSDTV,

	// DVD
	".img": qDVD, ".iso": qDVD, ".vob": qDVD,

	// HD
	".mkv": qWEBDL720p, ".mk3d": qWEBDL720p, ".ts": qSDTV, ".wtv": qSDTV,

	// Bluray
	".m2ts": qBluray720p,
}

// qualityForExtension returns the quality for a file extension (with dot),
// Unknown when the extension is not a media file.
func qualityForExtension(ext string) Quality {
	if q, ok := radarrFileExtensions[strings.ToLower(ext)]; ok {
		return q
	}
	return qUnknown
}

// isMediaExtension reports whether ext is a known media file extension.
func isMediaExtension(ext string) bool {
	_, ok := radarrFileExtensions[strings.ToLower(ext)]
	return ok
}
