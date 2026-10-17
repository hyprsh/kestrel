package main

import "testing"

func TestBuiltinPluginsRegister(t *testing.T) {
	r, err := builtinPlugins()
	if err != nil {
		t.Fatal(err)
	}
	if _, c, ok := r.Lookup("sabnzbd"); !ok || c.ID != "download_client.v1" || c.MaxEnabled != 1 {
		t.Fatalf("sabnzbd not registered as the single download client: %+v %v", c, ok)
	}
}
