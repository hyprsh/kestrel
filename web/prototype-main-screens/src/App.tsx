// PROTOTYPE, throwaway (wayfinder ticket #13 "Main screens in Geist style").
// Three structurally different variants of Kestrel's whole UI, switchable via ?variant=A|B|C and the floating bar.
// Each variant owns its layout and every screen; only mock data and small Geist primitives are shared.
import { useParam } from './nav'
import { PrototypeSwitcher } from './PrototypeSwitcher'
import { VariantA } from './variants/A/VariantA'
import { VariantB } from './variants/B/VariantB'
import { VariantC } from './variants/C/VariantC'

const variants = [
  { key: 'A', name: 'Dashboard', C: VariantA },
  { key: 'B', name: 'Posters', C: VariantB },
  { key: 'C', name: 'Command', C: VariantC },
]

export function App() {
  const key = useParam('variant', 'A')
  const V = (variants.find((v) => v.key === key) ?? variants[0]).C
  return (
    <>
      <V />
      <PrototypeSwitcher variants={variants} current={key} />
    </>
  )
}
