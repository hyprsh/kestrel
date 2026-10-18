# syntax=docker/dockerfile:1

# 1. The SPA. Build stages run on the build host's architecture; the output is architecture-independent.
FROM --platform=$BUILDPLATFORM node:26-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npm run build

# 2. The binary: CGO_ENABLED=0, cross-compiled, with the SPA embedded.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
ARG TMDB_API_KEY=
ARG TVDB_API_KEY=
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X github.com/hyprsh/kestrel/internal/version.Version=${VERSION} -X github.com/hyprsh/kestrel/internal/metadata.embeddedTMDBKey=${TMDB_API_KEY} -X github.com/hyprsh/kestrel/internal/metadata.embeddedTVDBKey=${TVDB_API_KEY}" \
    -o /out/kestrel ./cmd/kestrel

# 3. The image: Alpine with ffmpeg (for ffprobe), tzdata and su-exec.
FROM alpine:3.24
RUN apk add --no-cache ffmpeg tzdata su-exec
COPY --from=build /out/kestrel /usr/local/bin/kestrel
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --from=build /src/internal/notices/THIRD_PARTY_NOTICES.md /usr/share/doc/kestrel/THIRD_PARTY_NOTICES.md

ENV KESTREL_PORT=7676 \
    KESTREL_CONFIG_DIR=/config \
    KESTREL_DATA_DIR=/data \
    UMASK=002 \
    TZ=UTC
EXPOSE 7676

# busybox wget; the shell form expands KESTREL_PORT and KESTREL_BASE_URL at run time.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${KESTREL_PORT}${KESTREL_BASE_URL}/ping" || exit 1

ENTRYPOINT ["entrypoint.sh"]
CMD ["kestrel"]
