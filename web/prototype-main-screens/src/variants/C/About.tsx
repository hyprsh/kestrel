// PROTOTYPE, throwaway. Variant C About: version, license, provider attribution, keyboard shortcuts.
import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { KestrelLogo, Kbd } from '../../ui'
import { MOD, Page } from './bits'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-alpha-400">
      <h2 className="border-b border-gray-alpha-400 px-4 py-2.5 text-[13px] font-semibold tracking-tight">{title}</h2>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

const keys: [ReactNode, string][] = [
  [<><Kbd>{MOD}</Kbd><Kbd>K</Kbd></>, 'Command menu: jump to a Title or screen, run an action, add a Title'],
  [<><Kbd>j</Kbd><Kbd>k</Kbd> / <Kbd>↑</Kbd><Kbd>↓</Kbd></>, 'Move through lists'],
  [<Kbd>↵</Kbd>, 'Open the selected row; Grab in manual search'],
  [<Kbd>/</Kbd>, 'Filter the Library or the Log'],
  [<Kbd>esc</Kbd>, 'Close the menu; leave manual search'],
]

export function About() {
  return (
    <Page>
      <div className="mb-6 flex items-center gap-3">
        <KestrelLogo className="size-8" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Kestrel</h1>
          <p className="font-mono text-[12px] text-gray-900">v0.1.0 · build 56163ea · 2026-10-17</p>
        </div>
      </div>
      <div className="grid gap-4">
        <Card title="License">
          <p>
            Kestrel is free software under the{' '}
            <a className="inline-flex items-center gap-0.5 text-blue-900 hover:underline" href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noreferrer">
              GNU General Public License v3.0 <ExternalLink className="size-3" />
            </a>
            . Source:{' '}
            <a className="font-mono text-[12px] text-blue-900 hover:underline" href="https://github.com/hyprsh/kestrel" target="_blank" rel="noreferrer">
              github.com/hyprsh/kestrel
            </a>
          </p>
        </Card>
        <Card title="Metadata">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-16 shrink-0 items-center justify-center rounded-md bg-teal-100 font-mono text-[11px] font-semibold text-teal-900">TMDB</span>
              <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-16 shrink-0 items-center justify-center rounded-md bg-green-200 font-mono text-[11px] font-semibold text-green-900">TheTVDB</span>
              <p>
                Metadata provided by TheTVDB. Please consider adding missing information or{' '}
                <a className="text-blue-900 hover:underline" href="https://thetvdb.com/subscribe" target="_blank" rel="noreferrer">
                  subscribing
                </a>
                .
              </p>
            </div>
          </div>
        </Card>
        <Card title="Keyboard">
          <div className="flex flex-col gap-2">
            {keys.map(([k, v], i) => (
              <div key={i} className="grid grid-cols-[10rem_1fr] items-center gap-3">
                <span className="flex items-center gap-1 text-gray-900">{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Page>
  )
}
