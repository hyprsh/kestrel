// PROTOTYPE, throwaway. Variant B · Posters: first-run wizard, no app shell, a centred card with one step at a time.
import { useState, type ReactNode } from 'react'
import { Check, CircleCheckBig, LoaderCircle } from 'lucide-react'
import { go, navigate, useParam } from '../../nav'
import { profiles, SLOTS, type Kind, type Slot } from '../../mock'
import { Input, KestrelLogo, Select, Toggle, cx } from '../../ui'
import { Button, Field, Segmented } from './common'

type Lang = 'English' | 'German' | 'French'
const steps = ['Primary Language', 'SABnzbd', 'Indexer', 'Root folders', 'Profiles']

const langInfo: Record<Lang, { native: string; audio: string; dual: string; search: string; country: string; ratings: string }> = {
  English: { native: 'English', audio: 'Primary-Language Profiles require English audio.', dual: 'No Dual-Language label to look for: English releases carry English audio by default.', search: 'Titles are searched by their English names only.', country: 'US', ratings: 'MPA ratings (G, PG, PG-13, R)' },
  German: { native: 'Deutsch', audio: 'Primary-Language Profiles require German audio.', dual: '“DL” in German release names means a Dual-Language Release: German plus the Original Language.', search: 'Titles are also searched by their German names, e.g. “Alles steht Kopf 2”.', country: 'DE', ratings: 'FSK ratings (0, 6, 12, 16, 18)' },
  French: { native: 'Français', audio: 'Primary-Language Profiles require French audio.', dual: '“MULTi” in French release names means a Dual-Language Release: French plus the Original Language.', search: 'Titles are also searched by their French names, e.g. “Vice-versa 2”.', country: 'FR', ratings: 'CNC ratings (Tous publics, -10, -12, -16, -18)' },
}

export function Wizard() {
  const step = Math.min(Number(useParam('step', '0')) || 0, steps.length)
  const setStep = (n: number) => navigate({ step: String(n) })
  const [lang, setLang] = useState<Lang>('English')
  const done = step >= steps.length

  return (
    <div className="flex min-h-full flex-col items-center bg-background-200 px-4 py-14 text-[14px] text-gray-1000">
      <div className="mb-8 flex items-center gap-2">
        <KestrelLogo className="size-6" />
        <span className="text-[15px] font-semibold tracking-tight">Kestrel</span>
      </div>
      <div className="w-full max-w-[600px] overflow-hidden rounded-xl border border-gray-alpha-400 bg-background-100 shadow-sm">
        {done ? (
          <Done lang={lang} />
        ) : (
          <>
            <div className="px-8 pt-7">
              <div className="flex gap-1.5">
                {steps.map((s, i) => (
                  <button key={s} title={s} onClick={() => i < step && setStep(i)} className={cx('h-1 flex-1 rounded-full transition-colors', i <= step ? 'bg-gray-1000' : 'bg-gray-alpha-200', i < step && 'cursor-pointer')} />
                ))}
              </div>
              <div className="mt-5 text-[12px] font-medium text-gray-900">Step {step + 1} of {steps.length}</div>
            </div>
            <div className="px-8 pt-1 pb-8" key={step}>
              {step === 0 && <LanguageStep lang={lang} setLang={setLang} />}
              {step === 1 && <SabStep />}
              {step === 2 && <IndexerStep />}
              {step === 3 && <FoldersStep />}
              {step === 4 && <ProfilesStep lang={lang} />}
            </div>
            <div className="flex items-center justify-between border-t border-gray-alpha-400 bg-background-200 px-8 py-4">
              <Button onClick={() => setStep(step - 1)} disabled={step === 0}>Back</Button>
              <Button variant="primary" onClick={() => setStep(step + 1)}>{step === steps.length - 1 ? 'Finish setup' : 'Continue'}</Button>
            </div>
          </>
        )}
      </div>
      <p className="mt-6 text-[12px] text-gray-900">You can change all of this later in Settings.</p>
    </div>
  )
}

function StepHead({ title, sub }: { title: string; sub: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 text-sm text-gray-900">{sub}</p>
    </div>
  )
}

function LanguageStep({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const info = langInfo[lang]
  return (
    <>
      <StepHead title="What language does your household watch in?" sub="This is the Primary Language. It is chosen once for the whole library." />
      <div className="grid grid-cols-3 gap-3">
        {(Object.keys(langInfo) as Lang[]).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={cx('relative flex flex-col items-start rounded-lg border p-4 text-left transition-colors', lang === l ? 'border-gray-1000 ring-1 ring-gray-1000' : 'border-gray-alpha-400 hover:border-gray-500')}
          >
            <span className={cx('absolute top-3 right-3 flex size-4 items-center justify-center rounded-full border', lang === l ? 'border-gray-1000 bg-gray-1000 text-background-100' : 'border-gray-500')}>
              {lang === l && <Check size={10} strokeWidth={3} />}
            </span>
            <span className="text-base font-semibold tracking-tight">{l}</span>
            <span className="text-[13px] text-gray-900">{langInfo[l].native}</span>
          </button>
        ))}
      </div>
      <div className="mt-5 rounded-lg border border-gray-alpha-400 bg-background-200 p-4">
        <div className="mb-2 text-[13px] font-medium">What {lang} changes</div>
        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-[13px]">
          <dt className="text-gray-900">Required audio</dt><dd>{info.audio}</dd>
          <dt className="text-gray-900">Dual-Language</dt><dd>{info.dual}</dd>
          <dt className="text-gray-900">Title search</dt><dd>{info.search}</dd>
          <dt className="text-gray-900">Release dates</dt><dd>Default release-date country <span className="font-mono">{info.country}</span>, with its {info.ratings}.</dd>
        </dl>
      </div>
    </>
  )
}

function useTest(ok: string) {
  const [state, setState] = useState<'idle' | 'busy' | 'ok'>('idle')
  const run = () => (setState('busy'), setTimeout(() => setState('ok'), 700))
  const result = state === 'busy' ? (
    <span className="flex items-center gap-1.5 text-[13px] text-gray-900"><LoaderCircle size={14} className="animate-spin" /> Testing…</span>
  ) : state === 'ok' ? (
    <span className="flex items-center gap-1.5 text-[13px] text-green-900"><Check size={14} /> {ok}</span>
  ) : null
  return { run, result, busy: state === 'busy' }
}

function SabStep() {
  const t = useTest('Connected · SABnzbd 4.5.3 · 1.8 TB free')
  return (
    <>
      <StepHead title="Connect SABnzbd" sub="Kestrel hands every Grab to SABnzbd and imports what it finishes." />
      <div className="space-y-4">
        <Field label="URL"><Input className="font-mono" defaultValue="http://sabnzbd:8080" /></Field>
        <Field label="API key" hint="SABnzbd → Config → General → Security"><Input className="font-mono" placeholder="32 characters" /></Field>
        <div className="flex items-center gap-3"><Button size="sm" onClick={t.run} disabled={t.busy}>Test connection</Button>{t.result}</div>
      </div>
    </>
  )
}

function IndexerStep() {
  const t = useTest('Connected · 2 500 requests / day · ID search supported')
  return (
    <>
      <StepHead title="Add an indexer" sub="One Newznab indexer is enough to start. Add more later in Settings." />
      <div className="space-y-4">
        <Field label="Name"><Input defaultValue="NZBgeek" /></Field>
        <Field label="Newznab URL"><Input className="font-mono" defaultValue="https://api.nzbgeek.info" /></Field>
        <Field label="API key"><Input className="font-mono" placeholder="Your indexer API key" /></Field>
        <div className="flex items-center gap-3"><Button size="sm" onClick={t.run} disabled={t.busy}>Test</Button>{t.result}</div>
      </div>
    </>
  )
}

function FoldersStep() {
  return (
    <>
      <StepHead title="Where should the library live?" sub="Use the TRaSH /data layout: downloads and media on one mount, so Import is an instant move instead of a copy." />
      <div className="grid grid-cols-2 gap-4">
        <Field label="Movies"><Input className="font-mono" defaultValue="/data/media/movies" /></Field>
        <Field label="Series"><Input className="font-mono" defaultValue="/data/media/tv" /></Field>
      </div>
      <pre className="mt-5 rounded-lg border border-gray-alpha-400 bg-background-200 p-4 font-mono text-[12px] leading-relaxed text-gray-900">{`/data
├── usenet          ← SABnzbd completes here
│   ├── movies
│   └── tv
└── media           ← Kestrel's root folders
    ├── movies
    └── tv`}</pre>
    </>
  )
}

function ProfilesStep({ lang }: { lang: Lang }) {
  const [defaults, setDefaults] = useState<Record<Kind, Record<Slot, string>>>({
    movie: { SD: 'None', HD: 'HD', UHD: 'None' },
    series: { SD: 'None', HD: 'HD', UHD: 'None' },
  })
  const [country, setCountry] = useState(langInfo[lang].country)
  const [kids, setKids] = useState(true)
  const [th, setTh] = useState<'0' | '6' | '12'>('6')
  const opts = (slot: Slot) => ['None', ...profiles.filter((p) => p.slot === slot && !p.kids).map((p) => p.name)]
  return (
    <>
      <StepHead title="Default Profiles" sub="Which Versions a new Title gets. HD is the standard; SD and UHD are opt-in and can be added per Title later." />
      <div className="overflow-hidden rounded-lg border border-gray-alpha-400">
        <div className="grid grid-cols-[80px_1fr_1fr] gap-3 border-b border-gray-alpha-400 bg-background-200 px-4 py-2 text-[12px] font-medium text-gray-900">
          <span>Slot</span><span>New Movies</span><span>New Series</span>
        </div>
        {SLOTS.map((slot) => (
          <div key={slot} className="grid grid-cols-[80px_1fr_1fr] items-center gap-3 border-b border-gray-alpha-400 px-4 py-2.5 last:border-b-0">
            <span className="font-mono text-sm font-semibold">{slot}</span>
            {(['movie', 'series'] as Kind[]).map((k) => (
              <Select key={k} className="h-8 text-[13px]" value={defaults[k][slot]} options={opts(slot)} onChange={(v) => setDefaults((d) => ({ ...d, [k]: { ...d[k], [slot]: v } }))} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4">
        <Field label="Release-date country" hint={`Pre-filled from ${lang}`}>
          <Select value={country} onChange={setCountry} options={['DE', 'AT', 'CH', 'US', 'GB', 'FR']} />
        </Field>
      </div>
      <div className="mt-5 rounded-lg border border-gray-alpha-400 p-4">
        <Toggle on={kids} onChange={setKids} label={<span className="font-medium">Kids rule</span>} />
        <p className="mt-1.5 text-[13px] text-gray-900">Preselect the Kids Profile in the HD Slot for Titles rated at or below:</p>
        <div className={cx('mt-3', !kids && 'pointer-events-none opacity-50')}>
          <Segmented value={th} onChange={setTh} options={(['0', '6', '12'] as const).map((v) => ({ value: v, label: `FSK ${v}` }))} />
        </div>
      </div>
    </>
  )
}

function Done({ lang }: { lang: Lang }) {
  return (
    <div className="flex flex-col items-center px-8 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-green-200 text-green-900">
        <CircleCheckBig size={24} />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">You’re set</h1>
      <p className="mt-2 max-w-sm text-sm text-gray-900">Kestrel is ready. Add your first Title, or let it adopt the files already in your root folders.</p>
      <ul className="mt-6 w-full max-w-sm space-y-2 text-left text-[13px]">
        {[`Primary Language: ${lang}`, 'SABnzbd connected', '1 indexer', 'Root folders /data/media/movies and /data/media/tv', 'New Titles get an HD Version'].map((x) => (
          <li key={x} className="flex items-center gap-2"><Check size={14} className="text-green-900" /> {x}</li>
        ))}
      </ul>
      <div className="mt-8 flex gap-2">
        <Button onClick={() => go('library')}>Adopt existing files</Button>
        <Button variant="primary" onClick={() => go('library')}>Open library</Button>
      </div>
    </div>
  )
}
