// `npm run chrome`: fails when SPA source carries chrome utilities or hand-built markup outside the layout module,
// when a piece is declared under the name of a design component, and when a test asserts classes.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkSource, checkTestSource } from './chromeCheck.ts'

const isTest = (path: string) => /\.test\.tsx?$/.test(path) || path.startsWith('src/test/')

// The design package's exports (components, hooks and helpers), read from its typings: a piece Kestrel declares under one of
// these names is a copy.
const designNames = new Set([...readFileSync('node_modules/@hyprsh/design/dist/index.d.ts', 'utf8').matchAll(/^export declare (?:function|const|class) ([A-Z]\w*)/gm)].map((m) => m[1]))

const files = (readdirSync('src', { recursive: true }) as string[])
  .map((f) => join('src', f))
  .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.gen.ts'))
  .sort()

const violations = files.flatMap((f) => (isTest(f) ? checkTestSource(f, readFileSync(f, 'utf8')) : checkSource(f, readFileSync(f, 'utf8'), designNames)))
for (const v of violations) console.error(v.message)
if (violations.length > 0) {
  console.error(`\nchrome check: ${violations.length} problem(s). Use a design component (chrome belongs in src/layout/); see src/layout/conventions.ts.`)
  process.exit(1)
}
