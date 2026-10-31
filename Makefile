.DEFAULT_GOAL := help
.PHONY: typecheck release-dry-run dry-run-assets test-go-shard test-go-race test-parity notices build-silo help generate generate-check test test-go test-ffprobe test-web build web-build dev-api dev-web fmt fmt-check vet lint-go lint-web compose-check commit-check hooks docker docs docs-dev docs-shots check

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

test-go: test-go-race test-parity ## Go tests: the race detector on all but the Radarr and Sonarr parity suites

# The Radarr and Sonarr parity suites (every test named after them) replay thousands
# of fixtures through read-only parsing and scoring tables: seconds without the race
# detector, minutes with it. holder_test and gate_test keep the shared scoring
# snapshot under -race.
PARITY_TESTS := Radarr|Sonarr

test-go-race: ## Go tests with the race detector, minus the parity suites
	go test -race -timeout 30m -skip '$(PARITY_TESTS)' ./...

test-parity: ## The Radarr and Sonarr parity suites, without the race detector
	go test -run '$(PARITY_TESTS)' ./...

# CI splits test-go across parallel jobs: api (the largest package), domain (the
# heaviest after it), rest (every other package) and parity.
HEAVY_PKGS := ./internal/scoring/... ./internal/acquire/... ./internal/release/...

test-go-shard: ## One CI shard of test-go: GO_SHARD=api|domain|rest|parity
	@case "$(GO_SHARD)" in \
	  api) set -- -race -skip '$(PARITY_TESTS)' ./internal/api/... ;; \
	  domain) set -- -race -skip '$(PARITY_TESTS)' $(HEAVY_PKGS) ;; \
	  rest) set -- -race -skip '$(PARITY_TESTS)' $$(go list ./... | grep -v -E '/internal/(api|scoring|acquire|release)(/|$$)') ;; \
	  parity) set -- -run '$(PARITY_TESTS)' ./... ;; \
	  *) echo "GO_SHARD must be api, domain, rest or parity"; exit 1 ;; \
	esac; \
	go test -timeout 30m "$$@"

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

fmt: ## Format Go code (gofmt) and the SPA (prettier)
	gofmt -w .
	npm --prefix web run fmt

fmt-check: ## Fail if Go code is not gofmt-clean
	@test -z "$$(gofmt -l .)" || { echo "gofmt needed:"; gofmt -l .; exit 1; }

vet: ## go vet
	go vet ./...

lint-go: ## staticcheck, deadcode (code not even a test reaches) and go.mod drift
	go tool staticcheck ./...
	@out=$$(go tool deadcode -test ./...) || exit 1; test -z "$$out" || { echo "unreachable code:"; echo "$$out"; exit 1; }
	go mod tidy -diff

lint-web: ## prettier check, knip (unused files, exports, dependencies) and the chrome check (no hand-built chrome outside src/layout) in the SPA
	npm --prefix web run fmt:check
	npm --prefix web run knip
	npm --prefix web run chrome

compose-check: ## Validate the README's reference compose.yaml with `docker compose config`
	@awk '/^```yaml compose.yaml/{f=1;next} /^```/{f=0} f' README.md > $${TMPDIR:-/tmp}/kestrel-compose.yaml
	@test -s $${TMPDIR:-/tmp}/kestrel-compose.yaml || { echo "no compose.yaml block in README.md"; exit 1; }
	docker compose -f $${TMPDIR:-/tmp}/kestrel-compose.yaml config --quiet

commit-check: ## Check a commit header or PR title: echo "feat: x" | make commit-check
	@scripts/check-commit-header.sh

# core.hooksPath replaces .git/hooks, so hooks installed there (such as lefthook's) stop running.
hooks: ## Check commit headers on commit (.githooks/commit-msg)
	git config core.hooksPath .githooks

docker: ## Build the image as kestrel:dev
	docker build --build-arg VERSION=$(VERSION) --build-arg TMDB_API_KEY=$(TMDB_API_KEY) --build-arg TVDB_API_KEY=$(TVDB_API_KEY) -t kestrel:dev .

# CI installs this version's prebuilt binary and passes GORELEASER_CMD=goreleaser.
GORELEASER ?= github.com/goreleaser/goreleaser/v2@v2.18.3
GORELEASER_CMD ?= go run $(GORELEASER)

release-dry-run: docker dry-run-assets ## Run the release without publishing: the image, Silo plugin binaries, silo-repository.json, checksums (needs Docker)

dry-run-assets: ## The release's Silo plugin binaries, silo-repository.json and checksums, without publishing (CI runs this)
	$(GORELEASER_CMD) release --snapshot --clean --skip=publish,announce,validate
	scripts/check-release-dist.sh dist release-assets

docs: ## Build the docs site into web/docs-site/.vitepress/dist; fails on a dead link or anchor in any rendered Markdown
	npm --prefix web run docs:build

docs-dev: ## Serve the docs site at http://localhost:5173/kestrel/ with hot reload
	npm --prefix web run docs:dev

docs-shots: ## Regenerate the screenshots in docs/guide/images from the demo fakes, light and dark (needs Chrome, node, python3)
	scripts/demo/docs-shots.sh

notices: ## Regenerate internal/notices/THIRD_PARTY_NOTICES.md (needs network and `npm --prefix web ci`)
	scripts/gen-notices.sh

typecheck: ## TypeScript typecheck of the SPA (tsc --noEmit)
	npm --prefix web run typecheck

check: fmt-check vet lint-go lint-web typecheck generate-check test compose-check docs ## Everything CI runs, minus the image build and the PR-title check
