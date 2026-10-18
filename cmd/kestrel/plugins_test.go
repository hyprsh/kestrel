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
	if _, c, ok := r.Lookup("newznab"); !ok || c.ID != "indexer.v1" || c.MaxEnabled != 0 {
		t.Fatalf("newznab not registered as an uncapped indexer: %+v %v", c, ok)
	}
	for _, id := range []string{"silo", "jellyfin", "plex"} {
		if _, c, ok := r.Lookup(id); !ok || c.ID != "media_server.v1" || c.MaxEnabled != 0 {
			t.Fatalf("%s not registered as an uncapped media server: %+v %v", id, c, ok)
		}
	}
}
