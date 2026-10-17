// PROTOTYPE, throwaway. Variant A About: version, license, metadata attribution.
import { ExternalLink } from 'lucide-react'
import { KestrelLogo } from '../../ui'
import { Card, Page, PageHeader } from './shell'

export function AboutScreen() {
  const rows = [
    ['Version', <span className="font-mono">0.1.0-prototype</span>],
    ['Build', <span className="font-mono">56163ea · 2026-10-17</span>],
    ['License', <a className="inline-flex items-center gap-1 hover:underline" href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noreferrer">GNU General Public License v3.0 (GPLv3) <ExternalLink className="size-3" /></a>],
    ['Source', <a className="inline-flex items-center gap-1 font-mono hover:underline" href="https://github.com/hyprsh/kestrel" target="_blank" rel="noreferrer">github.com/hyprsh/kestrel <ExternalLink className="size-3" /></a>],
    ['Data folder', <span className="font-mono">/config</span>],
  ] as const
  return (
    <>
      <PageHeader title="About" />
      <Page className="max-w-[900px]">
        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg border border-gray-alpha-400 bg-background-200">
                <KestrelLogo />
              </div>
              <div>
                <div className="font-semibold tracking-tight">Kestrel</div>
                <div className="text-[13px] text-gray-900">Finds, downloads and files Movies and Series for one household.</div>
              </div>
            </div>
            <dl className="divide-y divide-gray-alpha-400 text-[13px]">
              {rows.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[160px_1fr] py-2">
                  <dt className="text-gray-900">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card title="Metadata attribution">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-gray-alpha-400 p-4">
                <div className="mb-2 inline-flex rounded-md bg-gray-1000 px-2 py-1 text-[13px] font-bold tracking-tight text-background-100">TMDB</div>
                <p className="text-[13px]">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
                <a className="mt-2 inline-flex items-center gap-1 text-[12px] text-gray-900 hover:text-gray-1000" href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
                  themoviedb.org <ExternalLink className="size-3" />
                </a>
              </div>
              <div className="rounded-lg border border-gray-alpha-400 p-4">
                <div className="mb-2 inline-flex rounded-md bg-gray-1000 px-2 py-1 text-[13px] font-bold tracking-tight text-background-100">TheTVDB</div>
                <p className="text-[13px]">
                  Metadata provided by TheTVDB. Please consider adding missing information or{' '}
                  <a className="underline" href="https://thetvdb.com/subscribe" target="_blank" rel="noreferrer">
                    subscribing
                  </a>
                  .
                </p>
                <a className="mt-2 inline-flex items-center gap-1 text-[12px] text-gray-900 hover:text-gray-1000" href="https://thetvdb.com" target="_blank" rel="noreferrer">
                  thetvdb.com <ExternalLink className="size-3" />
                </a>
              </div>
            </div>
            <p className="mt-4 text-[12px] text-gray-900">Movies and Series are found through TMDB. Series episodes, seasons and air dates come from TheTVDB, so a Series must be on TheTVDB to be added.</p>
          </Card>
        </div>
      </Page>
    </>
  )
}
