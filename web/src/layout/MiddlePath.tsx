// chrome: layout
import { Code } from '@hyprsh/design'

/** A path as the folder it ends in and the way to it: "/data/media/movies-family" is "/data/media" and "/movies-family". */
export function splitPath(path: string): { head: string; tail: string } {
  const end = path.length > 1 ? path.replace(/\/+$/, '').length : path.length
  const cut = path.lastIndexOf('/', end - 1)
  if (cut <= 0) return { head: '', tail: path }
  return { head: path.slice(0, cut), tail: path.slice(cut) }
}

/**
 * A path that is cut in the middle when the line is too narrow, so the folder it ends in stays readable ("/tmp/kd-c8…/movies-family"):
 * the way to it gives way first, and the full path is the tooltip. `code` sets it in the design Code chip, as a folder in a form reads.
 */
export function MiddlePath({ path, code }: { path: string; code?: boolean }) {
  const { head, tail } = splitPath(path)
  const parts = (
    <>
      {head && <span className="min-w-0 truncate">{head}</span>}
      <span className={head ? 'max-w-[75%] shrink-0 truncate' : 'min-w-0 truncate'}>{tail}</span>
    </>
  )
  if (code)
    return (
      <Code title={path} className="flex min-w-0">
        {parts}
      </Code>
    )
  return (
    <span title={path} className="flex min-w-0">
      {parts}
    </span>
  )
}
