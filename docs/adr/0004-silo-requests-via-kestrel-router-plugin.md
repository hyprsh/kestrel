# Silo Requests come through a Kestrel router plugin, not Radarr/Sonarr emulation

Note: ADR-0012 maps Silo's `1080p` tier to the Standard Slot and `2160p` to 4K, and lets Silo routes set the root folder and Profiles.

Silo hands each approved Request to a `request_router.v1` plugin. Kestrel ships its own plugin, a second binary from this repo with the same version, and that plugin calls a native, source-neutral Kestrel Request API. Kestrel does not pretend to be Radarr or Sonarr. We chose this because a Request must carry who asked, and Radarr's API has no field for that. We also want Kestrel to own both sides of the contract, in its own terms (Title, Slot, Profile, Version), rather than track a copy of someone else's API.

## Considered Options

- **Emulate Radarr and Sonarr for the stock `silo.requests.arr` plugin.** This works with stock Silo, but it needs about 14 `/api/v3` endpoints with Radarr/Sonarr resource shapes. It also needs a separate virtual instance per Slot (`/compat/radarr/hd`, `/compat/radarr/uhd`), because the plugin's "already present?" check would otherwise swallow the UHD add. Kestrel would have to call itself "Radarr" and map Sonarr's monitor policies, and it would lose the requester. Rejected for v1. It can come back later as a compatibility layer.
- **Poll Silo's admin API for approved Requests.** Rejected because there's no supported way to report status back to Silo.

## Consequences

- Silo's `1080p` tier maps to the HD Slot and `2160p` to UHD. UHD therefore follows the requester's 4K entitlement in Silo, not their own choice.
- Silo turns away Requests for titles already in its library, so adding UHD to an existing Title happens in Kestrel's UI.
- Silo tracks one Target per tier, so an SD Version added by the plugin's "Also add SD" setting is invisible in Silo's status.
- The plugin has its own release artifacts and a Silo plugin repository manifest, and has to keep up with the Silo plugin SDK.
