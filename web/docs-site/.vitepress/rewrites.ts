// Where each source Markdown file appears on the site. The sources stay where they are in the repo;
// this maps a path relative to the repo root to a path under the site root. A source with no entry
// here is not part of the site (README.md, CLAUDE.md, docs/agents/, docs/research/ and so on).
export function rewrite(source: string): string | undefined {
  const fixed: Record<string, string> = {
    'docs/index.md': 'index.md',
    'docs/decisions.md': 'adr/index.md',
    'GLOSSARY.md': 'glossary.md',
    'CONTRIBUTING.md': 'development/contributing.md',
    'CHANGELOG.md': 'changelog.md',
  }
  if (fixed[source]) return fixed[source]
  const dir = /^docs\/(guide|adr)\/([^/]+\.md)$/.exec(source)
  return dir ? `${dir[1]}/${dir[2]}` : undefined
}
