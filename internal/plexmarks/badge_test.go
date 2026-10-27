package plexmarks_test

import (
	"bytes"
	"flag"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/hyprsh/kestrel/internal/plexmarks"
)

var update = flag.Bool("update", false, "rewrite the golden badge images")

// poster is a stand-in poster: a dark blue to teal gradient with a pale band
// in the top-left, where the badge goes, to prove it holds on a light ground.
func poster(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			c := color.RGBA{R: uint8(20 + 40*x/w), G: uint8(40 + 120*y/h), B: uint8(110 + 60*y/h), A: 255}
			if y < h/12 {
				c = color.RGBA{R: 235, G: 235, B: 225, A: 255}
			}
			img.SetRGBA(x, y, c)
		}
	}
	return img
}

func golden(t *testing.T, name string, got image.Image) {
	t.Helper()
	path := filepath.Join("testdata", name)
	var buf bytes.Buffer
	if err := png.Encode(&buf, got); err != nil {
		t.Fatal(err)
	}
	if *update {
		if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(want, buf.Bytes()) {
		t.Fatalf("%s differs from the golden image; run go test ./internal/plexmarks -update and look at it", name)
	}
}

func TestTheBadgeOnAFullSizePoster(t *testing.T) {
	out, err := plexmarks.Stamp(poster(1000, 1500))
	if err != nil {
		t.Fatal(err)
	}
	golden(t, "badge_1000x1500.png", out)
}

func TestTheBadgeOnAThumbnail(t *testing.T) {
	out, err := plexmarks.Stamp(poster(150, 225))
	if err != nil {
		t.Fatal(err)
	}
	golden(t, "badge_150x225.png", out)
}

func TestTheBadgeLeavesTheRestOfThePosterAlone(t *testing.T) {
	src := poster(300, 450)
	out, err := plexmarks.Stamp(src)
	if err != nil {
		t.Fatal(err)
	}
	if out.Bounds() != src.Bounds() {
		t.Fatalf("size %v", out.Bounds())
	}
	if out.At(150, 400) != src.At(150, 400) || out.At(299, 449) != src.At(299, 449) {
		t.Fatal("the badge reached the lower poster")
	}
	if out.At(60, 30) == src.At(60, 30) {
		t.Fatal("the badge is not in the top-left corner")
	}
}

func TestStampJPEGTakesAPNGAndAnswersAJPEGOfTheSameSize(t *testing.T) {
	var in bytes.Buffer
	if err := png.Encode(&in, poster(200, 300)); err != nil {
		t.Fatal(err)
	}
	raw, err := plexmarks.StampJPEG(in.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	img, err := jpeg.Decode(bytes.NewReader(raw))
	if err != nil || img.Bounds().Dx() != 200 || img.Bounds().Dy() != 300 {
		t.Fatalf("%v %v", img, err)
	}
}

func TestSomethingThatIsNotAPosterIsAnError(t *testing.T) {
	if _, err := plexmarks.StampJPEG([]byte("not an image")); err == nil {
		t.Fatal("want an error")
	}
	if _, err := plexmarks.Stamp(poster(10, 10)); err == nil {
		t.Fatal("want an error for a tiny image")
	}
}
