// PROTOTYPE, throwaway. Floating variant switcher; ← / → cycle variants, D toggles dark mode.
import { useEffect } from 'react'
import { navigate } from './nav'

export function PrototypeSwitcher({ variants, current }: { variants: { key: string; name: string }[]; current: string }) {
  const i = Math.max(0, variants.findIndex((v) => v.key === current))
  const cycle = (d: number) => {
    const next = variants[(i + d + variants.length) % variants.length].key
    navigate({ variant: next }, true)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft') cycle(-1)
      if (e.key === 'ArrowRight') cycle(1)
      if (e.key === 'd' || e.key === 'D') document.documentElement.classList.toggle('dark')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (import.meta.env.PROD) return null
  return (
    <div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, display: 'flex', alignItems: 'center', gap: 4, padding: 4, borderRadius: 999, background: '#ff2d75', color: '#fff', boxShadow: '0 8px 30px rgba(0,0,0,.35)', font: '600 12px/1 ui-monospace, monospace' }}>
      <button onClick={() => cycle(-1)} style={btn}>←</button>
      <span style={{ padding: '0 10px', whiteSpace: 'nowrap' }}>PROTOTYPE · {variants[i].key} ({variants[i].name})</span>
      <button onClick={() => cycle(1)} style={btn}>→</button>
      <button onClick={() => document.documentElement.classList.toggle('dark')} style={{ ...btn, width: 'auto', padding: '0 10px' }} title="Toggle dark mode (D)">◐</button>
    </div>
  )
}
const btn: React.CSSProperties = { width: 28, height: 28, borderRadius: 999, border: 0, background: 'rgba(255,255,255,.18)', color: '#fff', cursor: 'pointer', font: 'inherit' }
