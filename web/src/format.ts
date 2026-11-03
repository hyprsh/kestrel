// Small number-to-words helpers the screens share.

/** "1 Grab", "3 Grabs"; `many` for a plural that is not one plus "s". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "440 GB", "1.2 TB", "107 TB": a size in bytes, 1024-based, in the unit its magnitude picks; one decimal under 10, none above. */
export function bytesText(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let v = n
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  const digits = v < 10 && u > 0 ? 1 : 0
  return `${v.toFixed(digits).replace(/\.0$/, '')} ${units[u]}`
}

/** How much of `total` bytes is done with `left` to go, 0–100; null when the total is not known yet. */
export const percent = (total: number, left: number) => (total > 0 ? Math.min(100, Math.max(0, Math.round(((total - left) / total) * 100))) : null)
