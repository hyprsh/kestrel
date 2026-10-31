import { existsSync, globSync, readdirSync, readFileSync } from 'node:fs'
import { posix, relative, resolve, sep } from 'node:path'
import { defineConfig, type MarkdownRenderer } from 'vitepress'
import type { Plugin } from 'vite'
import { apiReferenceDev, writeExtraFiles } from './apiReference.ts'
import { rewrite } from './rewrites.ts'

const repoRoot = resolve(import.meta.dirname, '../../..')
const repoUrl = 'https://github.com/hyprsh/kestrel'
// GitHub Pages serves a project site under /<repo>/.
const base = '/kestrel/'

// Every Markdown file in the repo that is not a site source (README.md, CLAUDE.md, docs/agents/, docs/research/,
// the SPA's and the Go packages' own files). srcExclude takes no negated globs, so the list is built here.
const notSite = globSync('**/*.md', { cwd: repoRoot, exclude: (name) => ['node_modules', '.git', 'dist'].includes(name) }).filter((f) => !rewrite(f))

// docs/adr/*.md, listed from the directory, so a new ADR needs no edit here.
const adrs = readdirSync(resolve(repoRoot, 'docs/adr'))
  .filter((f) => /^\d{4}-.*\.md$/.test(f))
  .sort()
  .map((f) => {
    const title = /^# (.+)$/m.exec(readFileSync(resolve(repoRoot, 'docs/adr', f), 'utf8'))?.[1] ?? f
    return { text: `${f.slice(0, 4)} ${title}`, link: `/adr/${f.replace(/\.md$/, '')}` }
  })

/** The path of the Markdown file being rendered, relative to the repo root (env.relativePath is the rewritten one). */
function sourceOf(env: { realPath?: string }): string | undefined {
  return env.realPath ? posix.normalize(relative(repoRoot, env.realPath).split(sep).join('/')) : undefined
}

// A relative link in a source file that points at a repo file the site does not render (CLAUDE.md,
// api/openapi.yaml, a workflow) goes to that file on GitHub, so the sources stay readable on GitHub
// and on the site without edits.
function repoLinks(md: MarkdownRenderer) {
  const open = md.renderer.rules.link_open
  md.renderer.rules.link_open = (tokens, i, options, env, self) => {
    const href = tokens[i].attrGet('href')
    if (href && !/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(href) && sourceOf(env)) {
      const [path, hash] = href.split('#')
      const target = posix.normalize(posix.join(posix.dirname(sourceOf(env)!), path))
      const page = target.endsWith('.md') ? rewrite(target) : undefined
      if (page) {
        // A page of the site: link to where it is rendered, whatever the source's relative path was.
        tokens[i].attrSet('href', `/${page.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')}${hash ? `#${hash}` : ''}`)
      } else if (target === 'docs/adr/') {
        tokens[i].attrSet('href', `/adr/${hash ? `#${hash}` : ''}`)
      } else if (existsSync(resolve(repoRoot, target)) && !target.startsWith('..')) {
        const kind = path.endsWith('/') ? 'tree' : 'blob'
        tokens[i].attrSet('href', `${repoUrl}/${kind}/main/${target.replace(/\/$/, '')}${hash ? `#${hash}` : ''}`)
      }
    }
    return open ? open(tokens, i, options, env, self) : self.renderToken(tokens, i, options)
  }
}

// Changelog entries, ADRs and the glossary are prose with `<name>` and `{{ }}` as plain text. Show their raw
// HTML as text, and keep Vue away from them, so a stray angle bracket cannot break the build.
function plainProse(md: MarkdownRenderer) {
  md.core.ruler.push('plain-prose', (state) => {
    const source = sourceOf(state.env)
    if (!source || !/^(CHANGELOG\.md|GLOSSARY\.md|docs\/adr\/)/.test(source)) return
    for (const block of state.tokens) {
      if (block.type === 'html_block') block.type = 'code_block'
      for (const t of block.children ?? []) if (t.type === 'html_inline') t.type = 'text'
    }
  })
}

// Raw HTML in a guide (`<picture>` with a dark and a light screenshot) names its images as `images/x.png`.
// GitHub reads that as relative to the page, but Vite reads a bare name as a package, so give it a `./`.
function relativeAssets(md: MarkdownRenderer) {
  md.core.ruler.push('relative-assets', (state) => {
    const fix = (t: { content: string }) => (t.content = t.content.replace(/\b(src|srcset)="(?![./]|[a-z][a-z0-9+.-]*:)/gi, '$1="./'))
    for (const block of state.tokens) {
      if (block.type === 'html_block') fix(block)
      for (const t of block.children ?? []) if (t.type === 'html_inline') fix(t)
    }
  })
}

// The Markdown sources sit above web/, so a bare import in a compiled page (`vue`, `vue/server-renderer`)
// finds no node_modules next to it. Resolve those from web/, where the site's dependencies are installed.
const resolveFromWeb: Plugin = {
  name: 'kestrel-resolve-from-web',
  enforce: 'pre',
  async resolveId(id, importer, options) {
    if (!importer || !/\.md$/.test(importer) || !/^[a-z@][^:]*$/i.test(id)) return null
    return this.resolve(id, resolve(repoRoot, 'web/docs-site/.vitepress/config.ts'), { ...options, skipSelf: true })
  },
}

export default defineConfig({
  title: 'Kestrel',
  description: 'Kestrel finds, downloads and files movies and series, in place of Radarr and Sonarr.',
  lang: 'en-US',
  base,
  // The sources are the repo's own Markdown, in place. Only the files `rewrite` maps reach the site.
  srcDir: '../..',
  srcExclude: notSite,
  rewrites: (id: string) => rewrite(id) ?? id,
  cleanUrls: true,
  head: [['link', { rel: 'icon', href: `${base}favicon.svg` }]],
  // The API reference is written after the build (apiReference.ts), so the checker cannot see it yet.
  ignoreDeadLinks: [/^\/api\/reference\//, /^https?:\/\/localhost/],
  markdown: {
    // Heading ids as GitHub makes them (KESTREL_BASE_URL is #kestrel_base_url), so the sources' own
    // `#anchor` links work on GitHub and on the site.
    anchor: {
      slugify: (text: string) =>
        text
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s_-]/gu, '')
          .replace(/\s/g, '-'),
    },
    config(md) {
      repoLinks(md)
      plainProse(md)
      relativeAssets(md)
    },
  },
  transformPageData(page) {
    if (page.filePath === 'GLOSSARY.md') page.title = 'Glossary'
  },
  vite: { plugins: [resolveFromWeb, apiReferenceDev(base)] },
  buildEnd(site) {
    writeExtraFiles(site.outDir, base)
  },
  themeConfig: {
    nav: [
      { text: 'Getting started', link: '/guide/getting-started' },
      { text: 'Configuration', link: '/guide/configuration' },
      { text: 'Concepts', link: '/guide/concepts' },
      { text: 'API', link: '/guide/api' },
      { text: 'Development', link: '/development/contributing' },
      { text: 'Changelog', link: '/changelog' },
    ],
    sidebar: {
      '/adr/': [{ text: 'Decisions', items: [{ text: 'All decisions', link: '/adr/' }, ...adrs] }],
      '/': [
        { text: 'Getting started', items: [{ text: 'Getting started', link: '/guide/getting-started' }] },
        { text: 'Configuration', items: [{ text: 'Configuration', link: '/guide/configuration' }] },
        {
          text: 'Concepts',
          items: [
            { text: 'Concepts in plain words', link: '/guide/concepts' },
            { text: 'Glossary', link: '/glossary' },
          ],
        },
        {
          text: 'Guides',
          items: [
            { text: 'Moving from Radarr and Sonarr', link: '/guide/moving-from-radarr-and-sonarr' },
            { text: 'Troubleshooting and FAQ', link: '/guide/troubleshooting' },
          ],
        },
        {
          text: 'API',
          items: [
            { text: 'Authentication', link: '/guide/api' },
            { text: 'Reference', link: '/api/reference/', target: '_self' },
          ],
        },
        {
          text: 'Development',
          items: [
            { text: 'Contributing', link: '/development/contributing' },
            { text: 'Decisions', link: '/adr/' },
          ],
        },
        { text: 'Changelog', items: [{ text: 'Changelog', link: '/changelog' }] },
      ],
    },
    socialLinks: [{ icon: 'github', link: repoUrl }],
    search: { provider: 'local' },
    editLink: { pattern: `${repoUrl}/edit/main/:path`, text: 'Edit this page on GitHub' },
    outline: { level: [2, 3] },
  },
})
