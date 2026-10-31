// The API reference: one static Scalar page over api/openapi.yaml, the renderer the app serves at
// {base}/api/docs. It is written into the build output (and served in dev) rather than being a
// Markdown page, so every operation in the spec is on it without a page per endpoint.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Plugin } from 'vite'

const repoRoot = resolve(import.meta.dirname, '../../..')
const scalarVersion = '1.76.4'

function page(base: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>API reference | Kestrel</title>
    <link rel="icon" href="${base}favicon.svg" />
  </head>
  <body>
    <p style="margin: 0; padding: 8px 16px; font: 14px system-ui, sans-serif">
      <a href="${base}">Kestrel documentation</a> · <a href="${base}api/">Authentication</a>
    </p>
    <script id="api-reference" data-url="${base}api/openapi.yaml"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@${scalarVersion}"></script>
  </body>
</html>
`
}

/** Files that are not Markdown pages, as site path (no base) to a function giving the content. */
function extraFiles(base: string): Record<string, () => Buffer | string> {
  return {
    'api/reference/index.html': () => page(base),
    'api/openapi.yaml': () => readFileSync(resolve(repoRoot, 'api/openapi.yaml')),
    'favicon.svg': () => readFileSync(resolve(repoRoot, 'web/public/favicon.svg')),
  }
}

export function writeExtraFiles(outDir: string, base: string): void {
  for (const [path, content] of Object.entries(extraFiles(base))) {
    const to = resolve(outDir, path)
    mkdirSync(dirname(to), { recursive: true })
    writeFileSync(to, content())
  }
}

/** Serves the same files under the base path while `make docs-dev` runs. */
export function apiReferenceDev(base: string): Plugin {
  return {
    name: 'kestrel-api-reference',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (!url.startsWith(base)) return next()
        let path = url.slice(base.length)
        if (path === 'api/reference' || path === 'api/reference/') path = 'api/reference/index.html'
        const file = extraFiles(base)[path]
        if (!file) return next()
        res.setHeader('Content-Type', path.endsWith('.html') ? 'text/html' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/yaml')
        res.end(file())
      })
    },
  }
}
