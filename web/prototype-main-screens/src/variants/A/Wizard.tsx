// PROTOTYPE, throwaway. Variant A first-run wizard: full page, vertical step list left, current step right.
import { useState, type ReactNode } from 'react'
import { Check, CircleCheck, Plus } from 'lucide-react'
import { SLOTS, type Kind, type Slot } from '../../mock'
import { go, navigate, useParam } from '../../nav'
import { Badge, Dot, KestrelLogo, Select, Toggle, cx } from '../../ui'
import { Button, Field, Input, Segmented } from './shell'
import { useStore } from './store'

const STEPS = ['Primary Language', 'SABnzbd', 'Indexer', 'Root folders', 'Profiles']
type Lang = 'English' | 'German' | 'French'
const COUNTRY: Record<Lang, string> = { English: 'US', German: 'DE', French: 'FR' }
const RATING: Record<string, string> = { US: 'MPA (G, PG, PG-13, R)', GB: 'BBFC (U, PG, 12A, 15, 18)', DE: 'FSK (0, 6, 12, 16, 18)', AT: 'FSK (0, 6, 12, 16, 18)', CH: 'FSK (0, 6, 12, 16, 18)', FR: 'CNC (Tous publics, -10, -12, -16, -18)' }
const kidsLabel = (country: string, n: number) => (['DE', 'AT', 'CH'].includes(country) ? `FSK ${n}` : country === 'FR' ? (n === 0 ? 'Tous publics' : n === 6 ? '-10' : '-12') : country === 'GB' ? (n === 0 ? 'U' : n === 6 ? 'PG' : '12A') : n === 0 ? 'G' : n === 6 ? 'PG' : 'PG-13')

export function Wizard() {
  const step = Math.min(5, Math.max(1, Number(useParam('step', '1'))))
  const { profiles } = useStore()
  const [lang, setLang] = useState<Lang>('English')
  const [country, setCountry] = useState('US')
  const [sab, setSab] = useState<'idle' | 'ok'>('idle')
  const [indexers, setIndexers] = useState<string[]>([])
  const [kids, setKids] = useState({ on: true, threshold: 6 })
  const [defaults, setDefaults] = useState<Record<Kind, Record<Slot, string>>>({
    movie: { SD: 'None', HD: 'HD', UHD: 'None' },
    series: { SD: 'None', HD: 'HD', UHD: 'None' },
  })
  const goStep = (n: number) => navigate({ step: String(n) })
  const chooseLang = (l: Lang) => {
    setLang(l)
    setCountry(COUNTRY[l])
  }

  return (
    <div className="flex min-h-full bg-background-200">
      <aside className="flex w-80 shrink-0 flex-col border-r border-gray-alpha-400 bg-background-100 px-8 py-8">
        <div className="mb-10 flex items-center gap-2">
          <KestrelLogo />
          <span className="text-[15px] font-semibold tracking-tight">Kestrel</span>
          <Badge className="ml-1">Setup</Badge>
        </div>
        <ol className="relative flex flex-col gap-1">
          {STEPS.map((s, i) => {
            const n = i + 1
            const done = n < step
            const cur = n === step
            return (
              <li key={s}>
                <button onClick={() => goStep(n)} className={cx('flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-[13px]', cur ? 'bg-gray-alpha-100' : 'hover:bg-gray-alpha-100')}>
                  <span
                    className={cx(
                      'flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]',
                      done ? 'border-transparent bg-gray-1000 text-background-100' : cur ? 'border-gray-1000 text-gray-1000' : 'border-gray-alpha-400 text-gray-900',
                    )}
                  >
                    {done ? <Check className="size-3.5" /> : n}
                  </span>
                  <span className={cx(cur ? 'font-medium text-gray-1000' : done ? 'text-gray-1000' : 'text-gray-900')}>{s}</span>
                </button>
              </li>
            )
          })}
        </ol>
        <div className="mt-auto text-[12px] text-gray-900">
          Everything here can be changed later in Settings.
          <button onClick={() => go('library')} className="mt-2 block text-gray-1000 hover:underline">
            Skip to the Library →
          </button>
        </div>
      </aside>

      <main className="flex flex-1 justify-center px-10 py-12">
        <div className="w-full max-w-2xl">
          <div className="tabular mb-1 font-mono text-[12px] text-gray-900">
            Step {step} of {STEPS.length}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{STEPS[step - 1]}</h1>

          <div className="mt-6 rounded-lg border border-gray-alpha-400 bg-background-100">
            <div className="p-6">
              {step === 1 && <LanguageStep lang={lang} onChange={chooseLang} />}
              {step === 2 && <SabStep status={sab} onTest={() => setSab('ok')} />}
              {step === 3 && <IndexerStep added={indexers} onAdd={(n) => setIndexers([...indexers, n])} />}
              {step === 4 && <FoldersStep />}
              {step === 5 && (
                <ProfilesStep
                  profiles={profiles}
                  defaults={defaults}
                  setDefaults={setDefaults}
                  country={country}
                  setCountry={setCountry}
                  lang={lang}
                  kids={kids}
                  setKids={setKids}
                />
              )}
            </div>
            <div className="flex items-center justify-between rounded-b-lg border-t border-gray-alpha-400 bg-background-200 px-6 py-3">
              <Button size="sm" variant="tertiary" disabled={step === 1} onClick={() => goStep(step - 1)}>
                Back
              </Button>
              {step < 5 ? (
                <Button size="sm" variant="primary" onClick={() => goStep(step + 1)}>
                  Continue
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => go('library')}>
                  Finish setup
                </Button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function Explain({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-4 py-2.5 text-[13px]">
      <div className="text-gray-900">{label}</div>
      <div>{children}</div>
    </div>
  )
}

function LanguageStep({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  const tag = lang === 'German' ? 'DL' : lang === 'French' ? 'MULTi' : null
  const example = lang === 'German' ? 'Alles steht Kopf 2' : lang === 'French' ? 'Vice-versa 2' : 'Inside Out 2'
  return (
    <>
      <p className="text-[13px] text-gray-900">The household’s own language, chosen once for the whole library. Most Profiles require audio in it.</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {(['English', 'German', 'French'] as Lang[]).map((l) => (
          <button
            key={l}
            onClick={() => onChange(l)}
            className={cx('flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm', lang === l ? 'border-gray-1000 ring-1 ring-gray-1000' : 'border-gray-alpha-400 hover:bg-gray-alpha-100')}
          >
            <span className="font-medium">{l}</span>
            {lang === l && <CircleCheck className="size-4" />}
          </button>
        ))}
      </div>
      <div className="mt-6 text-[11px] font-medium uppercase tracking-wide text-gray-700">What this changes</div>
      <div className="mt-1 divide-y divide-gray-alpha-400">
        <Explain label="Required audio">
          Primary-Language Profiles (SD, HD, Kids, UHD) only accept Releases with <b className="font-medium">{lang}</b> audio, checked by probing the file after download. The “Original” Profiles require the Title’s Original Language instead.
        </Explain>
        <Explain label={tag ? `${tag} in release names` : 'Dual-Language Releases'}>
          {tag ? (
            <>
              <span className="font-mono">{tag}</span> marks a Dual-Language Release: {lang} audio plus the Title’s Original Language in one file. Kestrel scores it above {lang}-only Releases.
            </>
          ) : (
            <>For English-original Titles, English and the Original Language are the same, so Dual-Language Releases (DL, MULTi) rarely matter. Foreign-language Titles still prefer English plus original audio.</>
          )}
        </Explain>
        <Explain label="Title search">
          Indexers are searched with the {lang === 'English' ? 'English title' : `${lang} title as well as the English one`}, e.g. <span className="font-mono">{example}</span>. Titles show the {lang} title as a second line.
        </Explain>
        <Explain label="Release dates and ratings">
          Release-date country defaults to <span className="font-mono">{COUNTRY[lang]}</span>, so age ratings are {RATING[COUNTRY[lang]]}. You can change it in the Profiles step.
        </Explain>
      </div>
    </>
  )
}

function SabStep({ status, onTest }: { status: 'idle' | 'ok'; onTest: () => void }) {
  return (
    <>
      <p className="text-[13px] text-gray-900">Kestrel hands every Grab to SABnzbd and imports what it finishes.</p>
      <div className="mt-2 divide-y divide-gray-alpha-400">
        <Field label="URL">
          <Input className="font-mono text-[13px]" defaultValue="http://sabnzbd:8080" />
        </Field>
        <Field label="API key" hint="SABnzbd → Config → General">
          <Input className="font-mono text-[13px]" placeholder="32 characters" />
        </Field>
        <Field label="Category">
          <Input className="w-48 font-mono text-[13px]" defaultValue="kestrel" />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={onTest}>
          Test connection
        </Button>
        {status === 'ok' && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-green-900">
            <Dot tone="green" /> Connected · v4.5.3 · category “kestrel” created
          </span>
        )}
      </div>
    </>
  )
}

function IndexerStep({ added, onAdd }: { added: string[]; onAdd: (n: string) => void }) {
  const [name, setName] = useState('NZBgeek')
  return (
    <>
      <p className="text-[13px] text-gray-900">Add at least one Newznab indexer. More can be added in Settings.</p>
      {added.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-alpha-400 rounded-md border border-gray-alpha-400">
          {added.map((n) => (
            <li key={n} className="flex items-center gap-2 px-3 py-2 text-[13px]">
              <Dot tone="green" /> <span className="font-medium">{n}</span>
              <span className="ml-auto text-[12px] text-gray-900">Test OK · supports ID search</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 divide-y divide-gray-alpha-400">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="URL">
          <Input className="font-mono text-[13px]" defaultValue="https://api.nzbgeek.info" />
        </Field>
        <Field label="API key">
          <Input className="font-mono text-[13px]" placeholder="Indexer API key" />
        </Field>
      </div>
      <Button size="sm" className="mt-3" prefix={<Plus className="size-3.5" />} disabled={!name || added.includes(name)} onClick={() => onAdd(name)}>
        Test and add
      </Button>
    </>
  )
}

function FoldersStep() {
  return (
    <>
      <p className="text-[13px] text-gray-900">Where Movies and Series live. Existing files there are picked up by Adoption after setup.</p>
      <div className="mt-2 divide-y divide-gray-alpha-400">
        <Field label="Movies" hint="1.8 TB free">
          <Input className="font-mono text-[13px]" defaultValue="/data/media/movies" />
        </Field>
        <Field label="Series" hint="1.8 TB free">
          <Input className="font-mono text-[13px]" defaultValue="/data/media/tv" />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-md border border-gray-alpha-400 bg-background-200 px-3 py-2 text-[13px]">
        <Dot tone="green" /> Both folders are writable. <span className="text-gray-900">412 files found for Adoption.</span>
      </div>
    </>
  )
}

function ProfilesStep({
  profiles, defaults, setDefaults, country, setCountry, lang, kids, setKids,
}: {
  profiles: { id: string; name: string; slot: Slot; enabled: boolean; kids?: boolean }[]
  defaults: Record<Kind, Record<Slot, string>>
  setDefaults: (d: Record<Kind, Record<Slot, string>>) => void
  country: string
  setCountry: (c: string) => void
  lang: Lang
  kids: { on: boolean; threshold: number }
  setKids: (k: { on: boolean; threshold: number }) => void
}) {
  const opts = (slot: Slot) => [...(slot === 'HD' ? [] : ['None']), ...profiles.filter((p) => p.slot === slot && p.enabled && !p.kids).map((p) => p.name)]
  return (
    <>
      <p className="text-[13px] text-gray-900">Which Versions a new Title gets. HD is the standard Slot; SD and UHD are opt-in and stay empty unless you pick a default.</p>
      <div className="mt-4 overflow-hidden rounded-lg border border-gray-alpha-400">
        <table className="w-full text-[13px]">
          <thead className="border-b border-gray-alpha-400 bg-background-200">
            <tr>
              <th className="h-9 px-3 text-left text-[12px] font-medium text-gray-900">Slot</th>
              <th className="h-9 px-3 text-left text-[12px] font-medium text-gray-900">New Movies</th>
              <th className="h-9 px-3 text-left text-[12px] font-medium text-gray-900">New Series</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-alpha-400">
            {SLOTS.map((slot) => (
              <tr key={slot}>
                <td className="px-3 py-2 font-mono font-semibold">{slot}</td>
                {(['movie', 'series'] as Kind[]).map((k) => (
                  <td key={k} className="px-3 py-2">
                    <Select
                      className={cx('h-8 w-full text-[13px]', defaults[k][slot] === 'None' && 'text-gray-900')}
                      value={defaults[k][slot]}
                      options={opts(slot)}
                      onChange={(v) => setDefaults({ ...defaults, [k]: { ...defaults[k], [slot]: v } })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 divide-y divide-gray-alpha-400">
        <Field label="Release-date country" hint={`Pre-filled from ${lang}. Sets release dates and age ratings.`}>
          <div className="flex items-center gap-3">
            <Select className="w-32" value={country} options={['DE', 'AT', 'CH', 'US', 'GB', 'FR']} onChange={setCountry} />
            <span className="text-[12px] text-gray-900">{RATING[country]}</span>
          </div>
        </Field>
        <Field label="Kids rule" hint="New Titles rated at or below the threshold get the Kids Profile in the HD Slot.">
          <div className="flex flex-col gap-3 pt-1.5">
            <Toggle on={kids.on} onChange={(on) => setKids({ ...kids, on })} label={kids.on ? 'On' : 'Off'} />
            <div className={cx('flex items-center gap-2', !kids.on && 'pointer-events-none opacity-50')}>
              <span className="text-[13px] text-gray-900">Up to</span>
              <Segmented size="sm" value={String(kids.threshold)} onChange={(v) => setKids({ ...kids, threshold: Number(v) })} options={['0', '6', '12'].map((n) => ({ key: n, label: kidsLabel(country, Number(n)) }))} />
            </div>
            {kids.on && <div className="text-[12px] text-gray-900">e.g. a {kidsLabel(country, kids.threshold)} Movie is added as “HD · Kids ({kidsLabel(country, kids.threshold)})”.</div>}
          </div>
        </Field>
      </div>
    </>
  )
}
