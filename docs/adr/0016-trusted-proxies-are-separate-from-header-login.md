# Trusted proxies are separate from header login

Behind a reverse proxy every request reaches Kestrel from the proxy's address, and the login and API key throttle is keyed on the client address. Until now Kestrel read `X-Forwarded-For` only while `reverse_proxy.enabled` was on, and that same switch made it log in anyone whose request from a trusted address carried `Remote-User`. A deployment with no SSO could not get per-client throttling without opening a login bypass on every vhost that forgets to strip the header, so it left the switch off. Every client then shared the proxy's address: five bad passwords from a stranger locked out the admin and the Silo plugin, and the plugin's successes kept resetting the counter a guesser built up.

So `trusted_proxies` now decides on its own whose `X-Forwarded-For` and `X-Forwarded-Proto` Kestrel believes, whether or not `enabled` is on. From a trusted socket address the client is the right-most `X-Forwarded-For` hop that is not itself a trusted proxy; from any other address both headers are ignored and the socket address is the client. `enabled` only switches header login (`Remote-User` or the configured `header`) from trusted addresses, and still needs at least one trusted proxy. `trusted_proxies` has no default: it stays explicit, with no loopback default.

## Considered Options

- **Keep one switch.** Rejected because it forces a deployment without SSO to choose between a shared throttle and a login bypass risk.
- **Trust loopback by default.** Rejected because a default trust is an implicit one, and a proxy on the same host is not the only thing that can connect from 127.0.0.1.
- **Believe `X-Forwarded-Proto` from anyone.** Rejected because an untrusted client could then set the cookie's `Secure` flag. It is believed only from trusted proxies, like `X-Forwarded-For`.

## Consequences

- With `trusted_proxies` empty nothing changes: the socket address is the client address.
- A deployment that sets `trusted_proxies` and relied on `X-Forwarded-Proto` from an address it did not list must now list it, or the session cookie loses `Secure`.
- Untrusted-header sightings are still recorded and warned about only while `enabled` is on, since only then does the header matter.
