// Package plugintest holds the checks every contract's conformance suite shares.
package plugintest

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
	"time"
)

var timeType = reflect.TypeOf(time.Time{})

// RoundTrip proves T is data-only (ADR 0008): it fills every field of a T with
// a non-zero value, marshals it to JSON, unmarshals into a fresh T and requires
// the two to be deeply equal. A type with a pointer, channel, function or
// unexported field fails, because none of them can cross a process boundary.
// Call it once per request and response type of a contract.
func RoundTrip[T any](t *testing.T) {
	t.Helper()
	typ := reflect.TypeFor[T]()
	t.Run("json round-trip "+typ.String(), func(t *testing.T) {
		if err := dataOnly(typ, typ.String()); err != nil {
			t.Fatal(err)
		}
		in := reflect.New(typ).Elem()
		fill(in, 1)
		raw, err := json.Marshal(in.Interface())
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		out := reflect.New(typ)
		if err := json.Unmarshal(raw, out.Interface()); err != nil {
			t.Fatalf("unmarshal %s: %v", raw, err)
		}
		if !reflect.DeepEqual(in.Interface(), out.Elem().Interface()) {
			t.Fatalf("lost data crossing JSON\n in: %#v\nout: %#v\njson: %s", in.Interface(), out.Elem().Interface(), raw)
		}
	})
}

func dataOnly(t reflect.Type, path string) error {
	switch t.Kind() {
	case reflect.String, reflect.Bool, reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Float32, reflect.Float64:
		return nil
	case reflect.Interface:
		if t.NumMethod() == 0 {
			return nil // a JSON value, like a settings entry
		}
		return fmt.Errorf("%s: interface %s carries behaviour, not data", path, t)
	case reflect.Slice, reflect.Array:
		return dataOnly(t.Elem(), path+"[]")
	case reflect.Map:
		if t.Key().Kind() != reflect.String {
			return fmt.Errorf("%s: map keys must be strings", path)
		}
		return dataOnly(t.Elem(), path+"{}")
	case reflect.Struct:
		if t == timeType {
			return nil
		}
		for i := range t.NumField() {
			f := t.Field(i)
			if !f.IsExported() {
				return fmt.Errorf("%s.%s: unexported field does not survive JSON", path, f.Name)
			}
			if f.Tag.Get("json") == "-" {
				return fmt.Errorf("%s.%s: json:\"-\" drops data", path, f.Name)
			}
			if err := dataOnly(f.Type, path+"."+f.Name); err != nil {
				return err
			}
		}
		return nil
	}
	return fmt.Errorf("%s: %s is not data-only", path, t)
}

func fill(v reflect.Value, n int) {
	switch v.Kind() {
	case reflect.String:
		v.SetString(fmt.Sprintf("s%d", n))
	case reflect.Bool:
		v.SetBool(true)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		v.SetInt(int64(n))
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		v.SetUint(uint64(n))
	case reflect.Float32, reflect.Float64:
		v.SetFloat(float64(n) + 0.5)
	case reflect.Interface:
		v.Set(reflect.ValueOf(fmt.Sprintf("v%d", n)))
	case reflect.Slice:
		s := reflect.MakeSlice(v.Type(), 2, 2)
		for i := range 2 {
			fill(s.Index(i), n+i+1)
		}
		v.Set(s)
	case reflect.Array:
		for i := range v.Len() {
			fill(v.Index(i), n+i+1)
		}
	case reflect.Map:
		m := reflect.MakeMap(v.Type())
		k := reflect.New(v.Type().Key()).Elem()
		k.SetString(fmt.Sprintf("k%d", n))
		e := reflect.New(v.Type().Elem()).Elem()
		fill(e, n+1)
		m.SetMapIndex(k, e)
		v.Set(m)
	case reflect.Struct:
		if v.Type() == timeType {
			v.Set(reflect.ValueOf(time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC).Add(time.Duration(n) * time.Hour)))
			return
		}
		for i := range v.NumField() {
			fill(v.Field(i), n+i)
		}
	}
}
