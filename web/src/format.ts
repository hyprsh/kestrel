// Small number-to-words helpers the screens share.

/** "1 Grab", "3 Grabs"; `many` for a plural that is not one plus "s". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** How much of `total` bytes is done with `left` to go, 0–100; null when the total is not known yet. */
export const percent = (total: number, left: number) => (total > 0 ? Math.min(100, Math.max(0, Math.round(((total - left) / total) * 100))) : null)
