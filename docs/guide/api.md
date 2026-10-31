# The API

The REST API is defined by [`api/openapi.yaml`](../../api/openapi.yaml) ([ADR 0009](../adr/0009-spec-first-openapi.md)). The [API reference](/api/reference/) renders every operation in it, so you can read it before you install Kestrel. A running instance serves the spec at `{base}/api/v1/openapi.json`, and the same interactive reference (Scalar, loaded from a CDN) at `{base}/api/docs`.

## Authentication

Scripts authenticate with the single full-access key from Settings > Security (or `KESTREL_API_KEY`, see [Configuration](configuration.md#kestrel_api_key)), sent as `X-Api-Key: kst_...`. Only the header works. Bad keys are throttled like failed logins.

```sh
curl -H "X-Api-Key: kst_..." http://localhost:7676/api/v1/system/status
```

Behind a reverse proxy, or with `KESTREL_BASE_URL` set, the API root moves with the base: `https://example.com/kestrel/api/v1/system/status`. See [KESTREL_BASE_URL](configuration.md#kestrel_base_url).
