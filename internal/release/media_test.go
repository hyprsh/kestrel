package release

import "testing"

func TestParseMedia(t *testing.T) {
	tests := []struct {
		name                        string
		video, hdr, audio, channels string
	}{
		{"Breaking.Bad.S01E01.1080p.WEB-DL.DD5.1.H.264-NTb", "H.264", "", "DD", "5.1"},
		{"Movie.2019.1080p.BluRay.x264.DTS-HD.MA.5.1-GRP", "H.264", "", "DTS-HD MA", "5.1"},
		{"Movie.2019.2160p.UHD.BluRay.x265.HDR10.TrueHD.Atmos.7.1-GRP", "H.265", "HDR10", "TrueHD Atmos", "7.1"},
		{"Show.S02E03.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX", "H.265", "Dolby Vision HDR", "DDP Atmos", "5.1"},
		{"Show.S02E03.2160p.WEB-DL.DD+5.1.HEVC-GRP", "H.265", "", "DDP", "5.1"},
		{"Show.S02E03.2160p.WEB-DL.DD+.7.1.DV.HDR10Plus.HEVC-GRP", "H.265", "Dolby Vision HDR10+", "DDP", "7.1"},
		{"Show.S01E01.720p.HDTV.x264.AAC2.0-GRP", "H.264", "", "AAC", "2.0"},
		{"Show S01E01 1080p AMZN WEB-DL EAC3 5.1 AVC", "H.264", "", "DDP", "5.1"},
		{"Movie.1999.1080p.BluRay.REMUX.AVC.DTS-HD.MA.7.1-GRP", "H.264", "", "DTS-HD MA", "7.1"},
		{"Movie.2021.2160p.WEB-DL.DV.H265.OPUS.2.0-GRP", "H.265", "Dolby Vision", "Opus", "2.0"},
		{"Movie.2021.1080p.WEB.AV1.FLAC.2.0-GRP", "AV1", "", "FLAC", "2.0"},
		{"Movie.2010.1080p.HLG.HEVC.AC3.5.1-GRP", "H.265", "HLG", "DD", "5.1"},
		{"Old.Movie.1995.DVDRip.XviD.MP3-GRP", "XviD", "", "MP3", ""},
		{"Movie.2005.1080p.BluRay.VC-1.DTS-X.7.1-GRP", "VC-1", "", "DTS:X", "7.1"},
		{"Movie.2012.480p.DVD.MPEG-2.DD2.0-GRP", "MPEG-2", "", "DD", "2.0"},
		{"Movie.2012.1080p.HDRip.x264-GRP", "H.264", "", "", ""},
		{"Plain.Movie.2012.1080p.WEB-DL-GRP", "", "", "", ""},
		{"Movie.5.1.2012.1080p-GRP", "", "", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v, h, a, c := ParseMedia(tt.name)
			if v != tt.video || h != tt.hdr || a != tt.audio || c != tt.channels {
				t.Errorf("ParseMedia = %q %q %q %q, want %q %q %q %q", v, h, a, c, tt.video, tt.hdr, tt.audio, tt.channels)
			}
		})
	}
}

func TestParseFillsMedia(t *testing.T) {
	p, err := Parse("Breaking.Bad.S01E01.1080p.WEB-DL.DD5.1.H.264-NTb", KindSeries)
	if err != nil {
		t.Fatal(err)
	}
	if p.VideoCodec != "H.264" || p.AudioCodec != "DD" || p.AudioChannels != "5.1" {
		t.Errorf("series parse media = %q %q %q", p.VideoCodec, p.AudioCodec, p.AudioChannels)
	}
	m, err := ParsePath("Movies/Dune (2021)/Dune.2021.2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.H.265-GRP.mkv", KindMovie)
	if err != nil {
		t.Fatal(err)
	}
	if m.VideoCodec != "H.265" || m.HDR != "Dolby Vision HDR10" || m.AudioCodec != "DDP Atmos" || m.AudioChannels != "5.1" {
		t.Errorf("movie path media = %q %q %q %q", m.VideoCodec, m.HDR, m.AudioCodec, m.AudioChannels)
	}
}
