import { describe, expect, it } from 'vitest'
import { checkSource, checkTestSource } from './chromeCheck'

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

  describe('the element check', () => {
    const messages = (code: string) => checkSource('src/a.tsx', code).map((v) => v.message)

    it('flags a hand-built element, naming it and the component to use', () => {
      const [m, ...rest] = messages(`const a = <button type="button">Go</button>\n`)
      expect(rest).toEqual([])
      expect(m).toContain('src/a.tsx:1')
      expect(m).toContain('<button>')
      expect(m).toContain('Button')
      const tags = ['a', 'input', 'select', 'textarea', 'label', 'table', 'hr', 'dialog', 'progress', 'kbd', 'code', 'pre', 'svg']
      for (const tag of tags) expect(messages(`const a = <${tag} />\n`), tag).toHaveLength(1)
    })

    it('passes design components and the elements it leaves to judgement', () => {
      expect(messages(`const a = <><Button /><Link /><Code /><ul><li>a</li></ul><ol /><img /><nav /><header /><div /><span /></>\n`)).toEqual([])
    })

    it('flags a role on an intrinsic element, not on a design component', () => {
      const [m, ...rest] = messages(`const a = <div role="alert">x</div>\n`)
      expect(rest).toEqual([])
      expect(m).toContain('role="alert"')
      expect(m).toContain('Error')
      expect(messages(`const a = <div role="tablist" />\n`)).toHaveLength(1)
      expect(messages(`const a = <Note role="alert">x</Note>\n`)).toEqual([])
      expect(messages(`const a = <div role="grid" />\n`)).toEqual([])
      expect(messages(`const a = <div role="valueOf" />\n`)).toEqual([])
    })

    it('flags window.confirm, alert and prompt and createPortal', () => {
      expect(messages(`window.confirm('Sure?')\n`)[0]).toContain('DestructiveActionModal')
      expect(messages(`window.alert('x')\nwindow.prompt('y')\n`)).toHaveLength(2)
      expect(messages(`createPortal(<Note />, document.body)\n`)[0]).toContain('Toast, Popover or Sheet')
      expect(messages(`confirm('x')\n`)).toEqual([])
    })

    it('flags a -subtle class, pointing to contrast="low"', () => {
      const [m, ...rest] = messages(`const c = "flex bg-amber-subtle"\nconst d = "text-subtle"\n`)
      expect(m).toContain('contrast="low"')
      expect(rest).toHaveLength(1)
      expect(messages(`const c = "Not subtle at all"\n`)).toEqual([])
    })

    it('leaves a marked file alone', () => {
      expect(checkSource('src/ui.tsx', `// chrome: domain-visual\nconst a = <svg />\n`)).toEqual([])
    })
  })

  describe('the chrome-ok exemption', () => {
    const messages = (code: string) => checkSource('src/a.tsx', code).map((v) => v.message)

    it('exempts the line below it, for a class and for an element', () => {
      expect(messages(`// chrome-ok: a grid cell\nconst c = "rounded-lg"\n`)).toEqual([])
      expect(messages(`const a = (\n  <>\n    {/* chrome-ok: a grid cell */}\n    <button />\n  </>\n)\n`)).toEqual([])
    })

    it('exempts only that line', () => {
      expect(messages(`// chrome-ok: one\nconst a = "rounded"\nconst b = "rounded"\n`)).toEqual([expect.stringContaining('src/a.tsx:3')])
    })

    it('fails an empty reason', () => {
      const m = messages(`// chrome-ok:\nconst c = "rounded-lg"\n`)
      expect(m).toHaveLength(2)
      expect(m.join('\n')).toContain('needs a reason')
      expect(messages(`{/* chrome-ok:   */}\n<button />\n`).join('\n')).toContain('needs a reason')
    })

    it('fails a stale exemption', () => {
      const [m, ...rest] = messages(`// chrome-ok: nothing here\nconst c = "p-4"\n`)
      expect(rest).toEqual([])
      expect(m).toContain('src/a.tsx:1')
      expect(m).toContain('stale')
    })
  })

  describe('the test-file check', () => {
    const messages = (code: string) => checkTestSource('src/a.test.tsx', code).map((v) => v.message)

    it('flags class assertions and class queries', () => {
      const code = [
        `expect(el).toHaveClass('x')`,
        `expect(el.className).toBe('x')`,
        `document.documentElement.classList.add('x')`,
        `document.querySelector('.truncate')`,
        `document.querySelectorAll('[class~="x"]')`,
      ].join('\n')
      const found = messages(code)
      expect(found).toHaveLength(5)
      expect(found[0]).toContain('src/a.test.tsx:1')
      expect(found[0]).toContain('tests assert what the user sees (role, name, text), not classes')
    })

    it('passes queries by role, name, text and attribute', () => {
      expect(messages(`screen.getByRole('button', { name: 'Go' })\ndocument.querySelector('[aria-current="true"]')\n`)).toEqual([])
    })

    it('honours chrome-ok, rejects an empty reason and a stale exemption', () => {
      expect(messages(`// chrome-ok: the theme class is the behaviour\nexpect(html).toHaveClass('dark')\n`)).toEqual([])
      expect(messages(`// chrome-ok:\nexpect(html).toHaveClass('dark')\n`).join('\n')).toContain('needs a reason')
      expect(messages(`// chrome-ok: x\nexpect(1).toBe(1)\n`).join('\n')).toContain('stale')
    })
  })
})
