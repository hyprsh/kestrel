// `node scripts/docs-anchors.ts <built site dir> <base path>`: fails on a broken internal link or anchor.
import { checkLinks, readPages } from './docsAnchors.ts'

const [dir, base = '/'] = process.argv.slice(2)
if (!dir) {
  console.error('usage: docs-anchors.ts <built site dir> <base path>')
  process.exit(2)
}
const pages = readPages(dir)
const problems = checkLinks(dir, base, pages)
for (const p of problems) console.error(p)
if (problems.length > 0) {
  console.error(`\ndocs links: ${problems.length} broken link(s) or anchor(s) in ${pages.length} pages`)
  process.exit(1)
}
console.log(`docs links: ${pages.length} pages, every internal link and anchor resolves`)
