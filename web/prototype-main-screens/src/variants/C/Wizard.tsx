// PROTOTYPE, throwaway. Variant C first-run wizard: one long page, numbered sections that collapse to a summary once done.
import { useState, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { go } from '../../nav'
import { SLOTS, profiles, type Kind, type Slot } from '../../mock'
import { Button, Input, KestrelLogo, Select, Toggle, cx } from '../../ui'
import { useStore } from './store'
import { Segmented } from './bits'

type Lang = 'English' | 'German' | 'French'
const country: Record<Lang, string> = { English: 'US', German: 'DE', French: 'FR' }
const ratings: Record<string, [string, string, string]> = { DE: ['FSK 0', 'FSK 6', 'FSK 12'], US: ['G', 'PG', 'PG-13'], FR: ['Tous publics', '-10', '-12'], GB: ['U', 'PG', '12A'] }

const explain: Record<Lang, { audio: string; dual: string; search: string; region: string }> = {
  English: {
    audio: 'Primary-Language Profiles require English audio.',
    dual: 'Dual-Language Releases (DL / MULTi) are rare for you and not preferred.',
    search: 'Titles are searched by their English title.',
    region: 'Release dates and age ratings default to the US (MPA: G, PG, PG-13, R).',
  },
  German: {
    audio: 'Primary-Language Profiles require German audio.',
    dual: '"DL" (Dual-Language) Releases carry German plus the Original Language and score highest.',
    search: 'Titles are searched by their German title as well as the English one.',
    region: 'Release dates and age ratings default to Germany (FSK 0, 6, 12, 16, 18).',
  },
  French: {
    audio: 'Primary-Language Profiles require French audio.',
    dual: '"MULTi" Releases carry French plus the Original Language and score highest.',
    search: 'Titles are searched by their French title as well as the English one.',
    region: 'Release dates and age ratings default to France (CNC: Tous publics, -10, -12, -16, -18).',
  },
}

function Section({ n, title, summary, open, done, onOpen, children, onContinue, canContinue = true }: { n: number; title: string; summary: ReactNode; open: boolean; done: boolean; onOpen: () => void; children: ReactNode; onContinue: () => void; canContinue?: boolean }) {
  return (
    <section className={cx('border-b border-gray-alpha-400', open && 'pb-6')}>
      <button onClick={onOpen} disabled={open} className="flex w-full items-center gap-3 py-4 text-left">
        <span className={cx('flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-semibold', done ? 'bg-green-700 text-white' : open ? 'bg-gray-1000 text-background-100' : 'bg-gray-alpha-200 text-gray-900')}>
          {done ? <Check className="size-3.5" /> : n}
        </span>
        <span className={cx('text-[15px] font-semibold tracking-tight', !open && !done && 'text-gray-900')}>{title}</span>
        {!open && done && <span className="ml-2 truncate text-gray-900">{summary}</span>}
        {!open && <ChevronRight className="ml-auto size-4 text-gray-700" />}
      </button>
      {open && (
        <div className="pl-9">
          {children}
          <div className="mt-5">
            <Button size="sm" variant="primary" disabled={!canContinue} onClick={onContinue}>
              Continue
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <div className="mb-1 font-medium">{label}</div>
      {children}
      {help && <div className="mt-1 text-[12px] text-gray-900">{help}</div>}
    </label>
  )
}

export function Wizard() {
  const s = useStore()
  const [open, setOpen] = useState(0)
  const [done, setDone] = useState<boolean[]>([false, false, false, false, false])
  const [lang, setLang] = useState<Lang>('English')
  const [sab, setSab] = useState({ url: 'http://sabnzbd:8080', key: '', category: 'kestrel', tested: false })
  const [ix, setIx] = useState({ name: 'NZBgeek', url: 'https://api.nzbgeek.info', key: '', tested: false })
  const [roots, setRoots] = useState({ movie: '/data/media/movies', series: '/data/media/tv' })
  const [defaults, setDefaults] = useState<Record<Kind, Record<Slot, string>>>({ movie: { SD: 'None', HD: 'HD', UHD: 'None' }, series: { SD: 'None', HD: 'HD', UHD: 'None' } })
  const [rc, setRc] = useState<string | null>(null)
  const [kids, setKids] = useState({ on: true, threshold: 1 })
  const releaseCountry = rc ?? country[lang]
  const r = ratings[releaseCountry] ?? ratings.US

  const complete = (i: number) => {
    setDone((d) => d.map((x, j) => (j === i ? true : x)))
    setOpen(done.findIndex((x, j) => j > i && !x) === -1 ? -1 : done.findIndex((x, j) => j > i && !x))
  }
  const all = done.every(Boolean)
  const ex = explain[lang]

  return (
    <div className="h-full overflow-auto bg-background-200">
      <div className="mx-auto max-w-2xl px-6 py-10 pb-28">
        <div className="mb-8 flex items-center gap-3">
          <KestrelLogo className="size-6" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Set up Kestrel</h1>
            <p className="text-gray-900">Five short sections. You can change all of it later in Settings.</p>
          </div>
          <button onClick={() => go('overview')} className="ml-auto text-[12px] text-gray-900 hover:text-gray-1000 hover:underline">
            Skip to app
          </button>
        </div>

        <div className="rounded-xl border border-gray-alpha-400 bg-background-100 px-5">
          <Section n={1} title="Primary Language" summary={lang} open={open === 0} done={done[0]} onOpen={() => setOpen(0)} onContinue={() => complete(0)}>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {(['English', 'German', 'French'] as Lang[]).map((l) => (
                <button key={l} onClick={() => (setLang(l), setRc(null))} className={cx('rounded-lg border px-3 py-2.5 text-left transition-colors', lang === l ? 'border-gray-1000 ring-1 ring-gray-1000' : 'border-gray-alpha-400 hover:bg-gray-alpha-100')}>
                  <div className="font-medium">{l}</div>
                  <div className="text-[12px] text-gray-900">{country[l]} release dates</div>
                </button>
              ))}
            </div>
            <div className="rounded-lg border border-gray-alpha-400 bg-background-200 p-3">
              <div className="mb-1.5 text-[12px] font-medium text-gray-900">What choosing {lang} changes</div>
              <ul className="flex flex-col gap-1">
                {[
                  ['Required audio', ex.audio],
                  ['DL / MULTi', ex.dual],
                  ['Title search', ex.search],
                  ['Release-date country', ex.region],
                ].map(([k, v]) => (
                  <li key={k} className="grid grid-cols-[9rem_1fr] gap-2">
                    <span className="text-gray-900">{k}</span>
                    <span>{v}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          <Section n={2} title="SABnzbd" summary={`${sab.url} · ${sab.category}`} open={open === 1} done={done[1]} onOpen={() => setOpen(1)} onContinue={() => complete(1)}>
            <Field label="URL">
              <Input className="font-mono text-[12px]" value={sab.url} onChange={(e) => setSab({ ...sab, url: e.target.value, tested: false })} />
            </Field>
            <Field label="API key" help="SABnzbd → Config → General → Security.">
              <Input className="font-mono text-[12px]" value={sab.key} placeholder="32-character key" onChange={(e) => setSab({ ...sab, key: e.target.value, tested: false })} />
            </Field>
            <Field label="Category">
              <Input className="font-mono text-[12px]" value={sab.category} onChange={(e) => setSab({ ...sab, category: e.target.value })} />
            </Field>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setSab({ ...sab, tested: true })}>
                Test connection
              </Button>
              {sab.tested && <span className="text-green-900">Connected · v4.5.3 · category found</span>}
            </div>
          </Section>

          <Section n={3} title="Indexer" summary={`${ix.name} · ${ix.url}`} open={open === 2} done={done[2]} onOpen={() => setOpen(2)} onContinue={() => complete(2)}>
            <Field label="Name">
              <Input value={ix.name} onChange={(e) => setIx({ ...ix, name: e.target.value })} />
            </Field>
            <Field label="Newznab URL">
              <Input className="font-mono text-[12px]" value={ix.url} onChange={(e) => setIx({ ...ix, url: e.target.value, tested: false })} />
            </Field>
            <Field label="API key">
              <Input className="font-mono text-[12px]" value={ix.key} placeholder="from your indexer profile" onChange={(e) => setIx({ ...ix, key: e.target.value, tested: false })} />
            </Field>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setIx({ ...ix, tested: true })}>
                Test
              </Button>
              {ix.tested && <span className="text-green-900">OK · ID search supported · 2 500 API calls / day</span>}
            </div>
            <p className="mt-2 text-[12px] text-gray-900">Add more indexers later in Settings.</p>
          </Section>

          <Section n={4} title="Root folders" summary={`${roots.movie} · ${roots.series}`} open={open === 3} done={done[3]} onOpen={() => setOpen(3)} onContinue={() => complete(3)}>
            <Field label="Movies" help="1.8 TB free">
              <Input className="font-mono text-[12px]" value={roots.movie} onChange={(e) => setRoots({ ...roots, movie: e.target.value })} />
            </Field>
            <Field label="Series" help="1.8 TB free · same disk as Movies, so Imports are instant moves">
              <Input className="font-mono text-[12px]" value={roots.series} onChange={(e) => setRoots({ ...roots, series: e.target.value })} />
            </Field>
          </Section>

          <Section
            n={5}
            title="Profiles"
            summary={`HD for new Titles · ${releaseCountry} release dates · Kids rule ${kids.on ? `≤ ${r[kids.threshold]}` : 'off'}`}
            open={open === 4}
            done={done[4]}
            onOpen={() => setOpen(4)}
            onContinue={() => complete(4)}
          >
            <div className="mb-1 font-medium">Default Profile per Slot</div>
            <p className="mb-2 text-[12px] text-gray-900">New Titles get a Version in each Slot that has a default. HD is the standard; SD and UHD are opt-in.</p>
            <div className="mb-4 overflow-hidden rounded-lg border border-gray-alpha-400">
              <div className="grid grid-cols-[6rem_repeat(3,1fr)] gap-2 border-b border-gray-alpha-400 bg-background-200 px-3 py-1.5 text-[11px] font-medium text-gray-900">
                <span />
                {SLOTS.map((sl) => (
                  <span key={sl} className="font-mono">
                    {sl}
                  </span>
                ))}
              </div>
              {(['movie', 'series'] as Kind[]).map((k) => (
                <div key={k} className="grid grid-cols-[6rem_repeat(3,1fr)] items-center gap-2 border-b border-gray-alpha-400 px-3 py-2 last:border-b-0">
                  <span className="font-medium">{k === 'movie' ? 'Movies' : 'Series'}</span>
                  {SLOTS.map((sl) => (
                    <Select
                      key={sl}
                      className="h-8! text-[13px]!"
                      value={defaults[k][sl]}
                      options={['None', ...profiles.filter((p) => p.slot === sl && !p.kids).map((p) => p.name)]}
                      onChange={(v) => setDefaults({ ...defaults, [k]: { ...defaults[k], [sl]: v } })}
                    />
                  ))}
                </div>
              ))}
            </div>
            <Field label="Release-date country" help={`Pre-filled from the Primary Language (${lang} → ${country[lang]}).`}>
              <Select value={releaseCountry} onChange={setRc} options={['DE', 'AT', 'CH', 'US', 'GB', 'FR']} />
            </Field>
            <div className="mt-4 rounded-lg border border-gray-alpha-400 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Kids rule</div>
                  <div className="text-[12px] text-gray-900">Titles rated at or below the threshold get the Kids Profile in HD.</div>
                </div>
                <Toggle on={kids.on} onChange={(on) => setKids({ ...kids, on })} />
              </div>
              {kids.on && (
                <div className="mt-3">
                  <Segmented value={String(kids.threshold)} onChange={(v) => setKids({ ...kids, threshold: Number(v) })} options={r.map((label, i) => ({ value: String(i), label }))} />
                </div>
              )}
            </div>
          </Section>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <span className="text-gray-900">{done.filter(Boolean).length} of 5 sections done</span>
          <Button
            variant="primary"
            disabled={!all}
            onClick={() => {
              s.toast('Setup finished. Kestrel is running.')
              go('overview')
            }}
          >
            Finish setup
          </Button>
        </div>
      </div>
    </div>
  )
}
