# Standalone server binaries

Kestrel ships as a container image only. GitHub releases carry the `kestrel-silo` plugin binaries, but no standalone `kestrel` server binary and no native-install guide (systemd unit, host `ffmpeg`, and so on).

## Why this is out of scope

The packaging decision in [#19](https://github.com/hyprsh/kestrel/issues/19) was "Docker only… GitHub releases carry no standalone server binaries", and it stands. The image is more than a wrapper around the binary. It is where Kestrel's runtime contract lives:

- the SPA is built into `web/dist` and embedded before `go build`, which only the Dockerfile does today;
- the TMDB and TheTVDB keys are embedded with `-ldflags -X …embeddedTMDBKey/embeddedTVDBKey`, so a fresh install has metadata before a key is entered;
- `ffprobe` and `tzdata` come in the image, at versions the release was tested with;
- the entrypoint applies `PUID`/`PGID` and owns the config dir, which is what the README's permission advice assumes.

A native binary would make each of those the host's job, and every release would need two install paths documented, supported and debugged. The platform where a native install would matter, Docker-less Proxmox LXCs (hyprsh/net ADR 0002), isn't where Kestrel runs: the media Services run as one Compose stack in a VM (hyprsh/net ADR 0003), from the image.

## If this comes back

Reopen it only for a deployment that can't run the image. The work is mostly release plumbing, listed in #233: build the SPA in GoReleaser's `before` hooks, pass the same ldflags and key secrets, attach `kestrel-linux-amd64`/`-arm64` to `checksums.txt`, add a "Run it without Docker" README section with a systemd unit, make the startup error name `ffprobe` when it's missing, and amend the #19 decision so the image stays the primary path.

## Prior requests

- #233: "Release standalone server binaries for running Kestrel without Docker"
