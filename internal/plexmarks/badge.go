package plexmarks

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png" // posters come as JPEG or PNG
	"math"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// The badge is a pill in the top-left corner that says REQUESTED in Go Bold, in Plex's
// amber with near-black letters. It scales with the poster, covers about two thirds of
// its width so the word stays readable at thumbnail size, and names no one.
const (
	badgeText = "REQUESTED"
	// Shares of the poster's width.
	badgeInset = 0.045 // from the top and left edges
	badgeWidth = 0.64
	// textShare is the share of the pill's width the word fills.
	textShare   = 0.80
	badgeQ      = 92 // JPEG quality of the stamped poster
	minPosterPx = 40 // narrower than this is not a poster
)

var (
	badgeFill = color.NRGBA{R: 0xE5, G: 0xA0, B: 0x0D, A: 0xFF}
	badgeInk  = color.NRGBA{R: 0x1B, G: 0x1B, B: 0x1B, A: 0xFF}
)

// StampJPEG decodes a poster (JPEG or PNG), stamps the badge on it and encodes
// the result as JPEG.
func StampJPEG(poster []byte) ([]byte, error) {
	src, _, err := image.Decode(bytes.NewReader(poster))
	if err != nil {
		return nil, fmt.Errorf("plexmarks: cannot read the poster: %w", err)
	}
	out, err := Stamp(src)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: badgeQ}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Stamp returns a copy of the poster with the badge on it.
func Stamp(src image.Image) (*image.RGBA, error) {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w < minPosterPx || h < minPosterPx {
		return nil, fmt.Errorf("plexmarks: the poster is only %dx%d pixels", w, h)
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(dst, dst.Bounds(), src, b.Min, draw.Src)

	f, err := opentype.Parse(gobold.TTF)
	if err != nil {
		return nil, err
	}
	pillW := math.Round(float64(w) * badgeWidth)
	face, err := faceFor(f, pillW*textShare)
	if err != nil {
		return nil, err
	}
	defer face.Close()

	// Size the pill around the word's ink, so the letters sit in its middle.
	ink, _ := font.BoundString(face, badgeText)
	// The vertical middle is the capitals' (the Q's tail hangs below them).
	caps, _ := font.BoundString(face, "E")
	inkW, inkH := fix(ink.Max.X-ink.Min.X), fix(caps.Max.Y-caps.Min.Y)
	pad := inkH * 0.78
	pillH := math.Round(inkH + 2*pad)
	x0, y0 := math.Round(float64(w)*badgeInset), math.Round(float64(w)*badgeInset)

	shadow(dst, x0, y0+math.Max(1, pillH*0.07), pillW, pillH)
	roundRect(dst, x0, y0, pillW, pillH, pillH/2, badgeFill, 1)

	// Centre the ink, not the advance, in the pill.
	cx := x0 + pillW/2 - inkW/2 - fix(ink.Min.X)
	cy := y0 + pillH/2 + inkH/2 - fix(caps.Max.Y)
	d := font.Drawer{Dst: dst, Src: image.NewUniform(badgeInk), Face: face,
		Dot: fixed.Point26_6{X: fixed.Int26_6(math.Round(cx * 64)), Y: fixed.Int26_6(math.Round(cy * 64))}}
	d.DrawString(badgeText)
	return dst, nil
}

func fix(v fixed.Int26_6) float64 { return float64(v) / 64 }

// faceFor finds the size at which the word is about width pixels wide.
func faceFor(f *opentype.Font, width float64) (font.Face, error) {
	probe, err := opentype.NewFace(f, &opentype.FaceOptions{Size: 100, DPI: 72, Hinting: font.HintingNone})
	if err != nil {
		return nil, err
	}
	_, adv := font.BoundString(probe, badgeText)
	probe.Close()
	size := 100 * width / fix(adv)
	return opentype.NewFace(f, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingNone})
}

// roundRect blends a rounded rectangle of colour c, at opacity a, over dst,
// anti-aliased by the distance of each pixel's centre to the shape's edge.
func roundRect(dst *image.RGBA, x, y, w, h, r float64, c color.NRGBA, a float64) {
	b := dst.Bounds()
	for py := max(b.Min.Y, int(math.Floor(y))); py < min(b.Max.Y, int(math.Ceil(y+h))); py++ {
		for px := max(b.Min.X, int(math.Floor(x))); px < min(b.Max.X, int(math.Ceil(x+w))); px++ {
			cov := clamp01(0.5-sdRoundRect(float64(px)+0.5-(x+w/2), float64(py)+0.5-(y+h/2), w/2, h/2, r)) * a
			if cov > 0 {
				blend(dst, px, py, c, cov)
			}
		}
	}
}

// shadow is a soft dark halo under the pill, so it holds against a pale poster.
func shadow(dst *image.RGBA, x, y, w, h float64) {
	for i, a := range []float64{0.10, 0.12, 0.14} {
		g := float64(3-i) * 0.9
		roundRect(dst, x-g, y-g, w+2*g, h+2*g, (h+2*g)/2, color.NRGBA{A: 0xFF}, a)
	}
}

func sdRoundRect(px, py, hw, hh, r float64) float64 {
	qx, qy := math.Abs(px)-(hw-r), math.Abs(py)-(hh-r)
	return math.Hypot(math.Max(qx, 0), math.Max(qy, 0)) + math.Min(math.Max(qx, qy), 0) - r
}

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }

func blend(dst *image.RGBA, x, y int, c color.NRGBA, cov float64) {
	o := dst.PixOffset(x, y)
	p := dst.Pix[o : o+4 : o+4]
	for i, v := range [3]uint8{c.R, c.G, c.B} {
		p[i] = uint8(math.Round(float64(p[i])*(1-cov) + float64(v)*cov))
	}
	p[3] = 0xFF
}
