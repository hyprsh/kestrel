package plugintest

import (
	"reflect"
	"testing"
	"time"
)

type good struct {
	Name  string
	At    time.Time
	Wait  time.Duration
	Tags  []string
	Extra map[string]any
	Inner struct{ N int }
}

type hasPointer struct{ P *int }
type hasFunc struct{ F func() }
type hasChan struct{ C chan int }

//lint:ignore U1000 the unexported field is what dataOnly must reject
type hasUnexported struct{ x int }

func TestDataOnlyAcceptsPlainData(t *testing.T) {
	RoundTrip[good](t)
}

func TestDataOnlyRejectsWhatCannotCrossAProcess(t *testing.T) {
	for name, typ := range map[string]reflect.Type{
		"pointer":    reflect.TypeFor[hasPointer](),
		"func":       reflect.TypeFor[hasFunc](),
		"chan":       reflect.TypeFor[hasChan](),
		"unexported": reflect.TypeFor[hasUnexported](),
	} {
		if err := dataOnly(typ, "T"); err == nil {
			t.Errorf("%s should be rejected", name)
		}
	}
}
