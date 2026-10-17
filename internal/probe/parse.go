package probe

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// Info is what a probe reads from one file.
type Info struct {
	Size       int64
	Duration   time.Duration
	HasVideo   bool
	Width      int
	Height     int
	VideoCodec string
	// HDR is "", "HDR10", "HLG" or "Dolby Vision".
	HDR   string
	Audio []AudioTrack
}

// Class is the resolution class of the probed frame size.
func (i Info) Class() Class {
	return ClassOf(i.Width, i.Height)
}

// ParseJSON reads `ffprobe -v error -show_format -show_streams -of json`
// output. It fails only when the output is not ffprobe JSON; a file without
// a video stream parses with HasVideo false.
func ParseJSON(data []byte) (Info, error) {
	var out ffprobeOutput
	if err := json.Unmarshal(data, &out); err != nil {
		return Info{}, fmt.Errorf("parse ffprobe output: %w", err)
	}

	var info Info
	info.Size, _ = strconv.ParseInt(out.Format.Size, 10, 64)
	if secs, err := strconv.ParseFloat(out.Format.Duration, 64); err == nil {
		info.Duration = time.Duration(math.Round(secs * float64(time.Second)))
	}

	for _, s := range out.Streams {
		switch s.CodecType {
		case "video":
			if info.HasVideo {
				continue
			}
			info.HasVideo = true
			info.Width = s.Width
			info.Height = s.Height
			info.VideoCodec = s.CodecName
			info.HDR = hdrOf(s)
		case "audio":
			info.Audio = append(info.Audio, AudioTrack{
				Index:    s.Index,
				Codec:    s.CodecName,
				Channels: s.Channels,
				Language: NormalizeLanguage(s.Tags["language"]),
				Title:    s.Tags["title"],
				Default:  s.Disposition["default"] == 1,
			})
		}
	}
	return info, nil
}

func hdrOf(s ffprobeStream) string {
	for _, sd := range s.SideDataList {
		if strings.Contains(sd.SideDataType, "DOVI") {
			return "Dolby Vision"
		}
	}
	switch s.ColorTransfer {
	case "smpte2084":
		return "HDR10"
	case "arib-std-b67":
		return "HLG"
	}
	return ""
}

type ffprobeOutput struct {
	Streams []ffprobeStream `json:"streams"`
	Format  struct {
		Duration string `json:"duration"`
		Size     string `json:"size"`
	} `json:"format"`
}

type ffprobeStream struct {
	Index         int               `json:"index"`
	CodecName     string            `json:"codec_name"`
	CodecType     string            `json:"codec_type"`
	Width         int               `json:"width"`
	Height        int               `json:"height"`
	Channels      int               `json:"channels"`
	ColorTransfer string            `json:"color_transfer"`
	Tags          map[string]string `json:"tags"`
	Disposition   map[string]int    `json:"disposition"`
	SideDataList  []ffprobeSideData `json:"side_data_list"`
}

type ffprobeSideData struct {
	SideDataType string `json:"side_data_type"`
}
