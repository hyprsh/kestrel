import { describe, expect, it } from 'vitest'
import { checkSource } from './chromeCheck'

const card = `export const Card = () => <div className="flex gap-2 rounded-lg p-4" />\n`

describe('the chrome check', () => {
  it('fails chrome in an unmarked file, naming the file, line and class', () => {
    const [v, ...rest] = checkSource('src/log/Log.tsx', `import x from 'y'\n\n${card}`)
    expect(rest).toEqual([])
    expect(v.message).toContain('src/log/Log.tsx:3')
    expect(v.message).toContain('rounded-lg')
    expect(v.message).toMatch(/layout module|design component/)
  })

  it('finds every chrome family, with variants, and ignores layout utilities, prose and comments', () => {
    const classes = (s: string) => checkSource('src/a.tsx', `const c = "${s}"\n`).map((v) => v.class)
    expect(classes('border-b border-gray-alpha-400')).toEqual(['border-b', 'border-gray-alpha-400'])
    expect(classes('hover:bg-gray-alpha-100 max-sm:shadow-menu ring-4 rounded')).toEqual(['hover:bg-gray-alpha-100', 'max-sm:shadow-menu', 'ring-4', 'rounded'])
    expect(classes('divide-y divide-gray-alpha-400')).toEqual(['divide-y', 'divide-gray-alpha-400'])
    expect(classes('max-sm:!bottom-4 !w-full')).toEqual(['max-sm:!bottom-4', '!w-full'])
    expect(classes('[&_.hy-querybar\\_\\_row]:flex-wrap')).toEqual(['[&_.hy-querybar\\_\\_row]:flex-wrap'])
    expect(classes('flex items-center gap-2 px-4 max-sm:ml-0 text-gray-900 [&>*]:flex-1 w-full')).toEqual([])
    expect(checkSource('src/a.tsx', `// a border and a !bang\nconst a = 'Done!'\n/* rounded-lg */\n`)).toEqual([])
    expect(checkSource('src/a.tsx', 'const a = `flex ${x} rounded-md`\n').map((v) => v.class)).toEqual(['rounded-md'])
  })

  it('passes the same chrome in a layout file or a domain-visual file', () => {
    expect(checkSource('src/layout/Card.tsx', `// chrome: layout\n${card}`)).toEqual([])
    expect(checkSource('src/poster.tsx', `// A poster.\n// chrome: domain-visual\n\n${card}`)).toEqual([])
  })

  it('accepts a waiting marker only with an issue reference', () => {
    expect(checkSource('src/App.tsx', `// chrome: waiting hyprsh/design#26\n${card}`)).toEqual([])
    const [v] = checkSource('src/App.tsx', `// chrome: waiting\n${card}`)
    expect(v.message).toContain('src/App.tsx:1')
    expect(v.message).toContain('hyprsh/design#N')
  })

  it('rejects the layout marker outside the layout module', () => {
    const [v] = checkSource('src/log/Log.tsx', `// chrome: layout\n${card}`)
    expect(v.message).toContain('src/log/Log.tsx:1')
    expect(v.message).toContain('src/layout/')
  })

  it('rejects an unknown marker and ignores a marker below the code', () => {
    expect(checkSource('src/a.tsx', `// chrome: whatever\n${card}`)[0].message).toContain('unknown')
    expect(checkSource('src/a.tsx', `${card}// chrome: pending\n`)).toHaveLength(1)
  })

  it('lets a pending file keep its chrome, and fails a pending file with none', () => {
    expect(checkSource('src/log/Log.tsx', `// chrome: pending\n${card}`)).toEqual([])
    const [v] = checkSource('src/log/Log.tsx', `// chrome: pending\nexport const a = 1\n`)
    expect(v.message).toContain('src/log/Log.tsx:1')
    expect(v.message).toContain('stale')
  })

  it('fails an unmarked file in the layout module that has chrome', () => {
    expect(checkSource('src/layout/Card.tsx', card)).toHaveLength(1)
  })
})
