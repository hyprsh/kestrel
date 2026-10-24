// chrome: domain-visual
// Kestrel's own mark, a brand asset that follows the design Logo's rules (currentColor, 20-24px, never
// recoloured), and the `cx` class joiner.

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function KestrelLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('size-5', className)} fill="currentColor" aria-label="Kestrel">
      <path d="M2 17 L12 4 L22 17 L15 13 L12 20 L9 13 Z" />
    </svg>
  )
}
