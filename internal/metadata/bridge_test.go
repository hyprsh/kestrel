package metadata_test

import (
	"context"
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

func newBridge(t *testing.T) *metadata.Bridge {
	t.Helper()
	tmdb := metadatatest.New(t)
	tvdb := metadatatest.NewTVDB(t)
	return &metadata.Bridge{
		Meta: metadata.NewTMDB(metadata.TMDBOptions{BaseURL: tmdb.APIBase(), ImageBase: tmdb.ImageBase(), Keys: metadata.StaticKey(metadatatest.Key)}),
		TVDB: metadata.NewTVDB(metadata.TVDBOptions{BaseURL: tvdb.APIBase(), Keys: metadata.StaticTVDBKey(metadatatest.TVDBKey)}),
	}
}

func TestTheBridgeFindsATVDBIdFromTMDBsOwnIdsThenFromAnIMDbSearch(t *testing.T) {
	b := newBridge(t)
	ctx := context.Background()

	if id, err := b.TVDBID(ctx, 81189, ""); err != nil || id != 81189 {
		t.Errorf("known id: %d, %v", id, err)
	}
	if id, err := b.TVDBID(ctx, 0, ""); err != nil || id != 0 {
		t.Errorf("no ids at all: %d, %v", id, err)
	}
	d, err := b.Meta.Series(ctx, 7001)
	if err != nil {
		t.Fatal(err)
	}
	if id, err := b.TVDBID(ctx, d.TVDBID, d.IMDbID); err != nil || id != 300001 {
		t.Errorf("IMDb bridge: %d, %v", id, err)
	}
}

func TestLookupBridgesEverySeriesAndGreysOutWhatIsNotOnTVDB(t *testing.T) {
	b := newBridge(t)

	got, err := b.Lookup(context.Background(), []int{1396, 7001, 9001, 424242})
	if err != nil {
		t.Fatal(err)
	}

	if got[1396].ID != 81189 || got[7001].ID != 300001 {
		t.Errorf("bridged = %+v", got)
	}
	if got[9001].ID != 0 || got[9001].Reason != metadata.ReasonNotOnTVDB {
		t.Errorf("orphan = %+v", got[9001])
	}
	if got[424242].Reason != metadata.ReasonNotOnTVDB {
		t.Errorf("a vanished series is not on TheTVDB: %+v", got[424242])
	}
}

type brokenTVDB struct{ metadata.TVDBProvider }

func (brokenTVDB) SeriesByIMDb(context.Context, string) (int, bool, error) {
	return 0, false, errors.New("TheTVDB is down")
}

func TestATVDBOutageGreysAResultOutInsteadOfFailingTheLookup(t *testing.T) {
	b := newBridge(t)
	b.TVDB = brokenTVDB{b.TVDB}

	got, err := b.Lookup(context.Background(), []int{7001})
	if err != nil {
		t.Fatal(err)
	}
	if got[7001].Reason != metadata.ReasonTVDBUnavailable {
		t.Errorf("bridged = %+v", got[7001])
	}
}
