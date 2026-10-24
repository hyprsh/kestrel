// `npm run chrome`: fails when SPA source (not tests) carries chrome utilities outside the layout module.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkSource } from './chromeCheck.ts'

const skip = (path: string) => /\.test\.tsx?$/.test(path) || path.startsWith('src/test/') || path.endsWith('.gen.ts')

const files = (readdirSync('src', { recursive: true }) as string[])
  .map((f) => join('src', f))
  .filter((f) => /\.tsx?$/.test(f) && !skip(f))
  .sort()

const violations = files.flatMap((f) => checkSource(f, readFileSync(f, 'utf8')))
for (const v of violations) console.error(v.message)
if (violations.length > 0) {
  console.error(`\nchrome check: ${violations.length} problem(s). Chrome belongs in src/layout/ or a design component; see src/layout/conventions.ts.`)
  process.exit(1)
}
