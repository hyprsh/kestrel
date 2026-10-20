.DEFAULT_GOAL := help
.PHONY: typecheck release-dry-run dry-run-assets test-go-shard notices build-silo help generate generate-check test test-go test-ffprobe test-web build web-build dev-api dev-web fmt fmt-check vet compose-check commitlint hooks docker check

VERSION ?= dev
# The project's TMDB and TVDB keys are injected at link time; the default build embeds none.
TMDB_API_KEY ?=
TVDB_API_KEY ?=
LDFLAGS := -s -w -X github.com/hyprsh/kestrel/internal/version.Version=$(VERSION) -X github.com/hyprsh/kestrel/internal/metadata.embeddedTMDBKey=$(TMDB_API_KEY) -X github.com/hyprsh/kestrel/internal/metadata.embeddedTVDBKey=$(TVDB_API_KEY)

help: ## List the dev commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-15s %s\n", $$1, $$2}'

# Tools are pinned in go.mod (`tool` directives) and web/package.json, so nothing needs a global install.
generate: ## Regenerate Go (oapi-codegen, sqlc) and TypeScript (openapi-typescript) code from the spec and SQL
	go tool oapi-codegen -config api/oapi-codegen.yaml api/openapi.yaml
	go tool sqlc generate
	npm --prefix web run generate

generate-check: generate ## Fail if generated code differs from what is committed (CI runs this)
	git diff --exit-code -- . ':!web/dist'
	@test -z "$$(git ls-files --others --exclude-standard)" || { echo "untracked files after generate:"; git ls-files --others --exclude-standard; exit 1; }

test: test-go test-web ## Run all tests

test-go: ## Go tests with the race detector
	go test -race -timeout 30m ./...

# CI splits test-go across parallel jobs. The parity suites (thousands of Radarr
# and Sonarr fixtures, in parallel subtests) are the heaviest tests, so they get a
# shard of their own; HEAVY_PKGS are the next heaviest. rest is everything else.
PARITY_TESTS := ^(TestMovieMatchedFormatsEqualRadarrs|TestSeriesMatchedFormatsEqualSonarrs|TestGoldenParityWithRadarr|TestGoldenSeriesParityWithSonarr)$$
HEAVY_PKGS := ./internal/scoring/... ./internal/acquire/... ./internal/release/...

test-go-shard: ## One CI shard of test-go: GO_SHARD=api|parity|domain|rest
	@case "$(GO_SHARD)" in \
	  api) set -- ./internal/api/... ;; \
	  parity) set -- -run '$(PARITY_TESTS)' ./internal/scoring ./internal/release ;; \
	  domain) set -- -skip '$(PARITY_TESTS)' $(HEAVY_PKGS) ;; \
	  rest) set -- $$(go list ./... | grep -v -E '/internal/(api|scoring|acquire|release)(/|$$)') ;; \
	  *) echo "GO_SHARD must be api, parity, domain or rest"; exit 1 ;; \
	esac; \
	go test -race -timeout 30m "$$@"

test-ffprobe: ## Real-ffprobe suite on ffmpeg-generated MKVs (needs ffmpeg and ffprobe on PATH; CI runs it)
	go test -race -tags ffprobe ./internal/probe/

test-web: ## SPA tests (Vitest + MSW)
	npm --prefix web test

web-build: ## Build the SPA into web/dist (embedded by the Go build)
	npm --prefix web run build

build: web-build ## Build bin/kestrel (CGO_ENABLED=0) with the SPA embedded
	CGO_ENABLED=0 go build -trimpath -ldflags '$(LDFLAGS)' -o bin/kestrel ./cmd/kestrel

build-silo: ## Build bin/kestrel-silo, the Silo request_router.v1 plugin (same version as Kestrel)
	CGO_ENABLED=0 go build -trimpath -ldflags '$(LDFLAGS)' -o bin/kestrel-silo ./cmd/kestrel-silo

dev-api: ## Run the Go server on :7676 with a local config dir in .dev/config
	KESTREL_CONFIG_DIR=$(CURDIR)/.dev/config KESTREL_DATA_DIR=$(CURDIR)/.dev/data go run ./cmd/kestrel

dev-web: ## Run the Vite dev server (proxies /api to :7676, so run `make dev-api` too)
	npm --prefix web run dev

fmt: ## Format Go code
	gofmt -w .

fmt-check: ## Fail if Go code is not gofmt-clean
	@test -z "$$(gofmt -l .)" || { echo "gofmt needed:"; gofmt -l .; exit 1; }

vet: ## go vet
	go vet ./...

compose-check: ## Validate the README's reference compose.yaml with `docker compose config`
	@awk '/^```yaml compose.yaml/{f=1;next} /^```/{f=0} f' README.md > $${TMPDIR:-/tmp}/kestrel-compose.yaml
	@test -s $${TMPDIR:-/tmp}/kestrel-compose.yaml || { echo "no compose.yaml block in README.md"; exit 1; }
	docker compose -f $${TMPDIR:-/tmp}/kestrel-compose.yaml config --quiet

commitlint: ## Lint a message: echo "feat: x" | make commitlint
	npx --no-install commitlint

hooks: ## Install the commit-msg hook (commitlint via lefthook)
	npm ci
	npx --no-install lefthook install

docker: ## Build the image as kestrel:dev
	docker build --build-arg VERSION=$(VERSION) --build-arg TMDB_API_KEY=$(TMDB_API_KEY) --build-arg TVDB_API_KEY=$(TVDB_API_KEY) -t kestrel:dev .

# CI installs this version's prebuilt binary and passes GORELEASER_CMD=goreleaser.
GORELEASER ?= github.com/goreleaser/goreleaser/v2@v2.18.3
GORELEASER_CMD ?= go run $(GORELEASER)

release-dry-run: docker dry-run-assets ## Run the release without publishing: the image, Silo plugin binaries, silo-repository.json, checksums (needs Docker)

dry-run-assets: ## The release's Silo plugin binaries, silo-repository.json and checksums, without publishing (CI runs this)
	$(GORELEASER_CMD) release --snapshot --clean --skip=publish,announce,validate
	scripts/check-release-dist.sh dist release-assets

notices: ## Regenerate internal/notices/THIRD_PARTY_NOTICES.md (needs network and `npm --prefix web ci`)
	scripts/gen-notices.sh

typecheck: ## TypeScript typecheck of the SPA (tsc --noEmit)
	npm --prefix web run typecheck

check: fmt-check vet typecheck generate-check test compose-check ## Everything CI runs, minus the image build and commitlint
