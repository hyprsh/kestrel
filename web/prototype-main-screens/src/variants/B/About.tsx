// PROTOTYPE, throwaway. Variant B · Posters: About as a dialog over the library, with the providers' required attribution.
import { ExternalLink } from 'lucide-react'
import { go } from '../../nav'
import { KestrelLogo } from '../../ui'
import { CloseButton, Dialog } from './common'

export function AboutDialog() {
  const close = () => go('library')
  return (
    <Dialog onClose={close} width={520} label="About Kestrel">
      <div className="flex items-start justify-between p-6 pb-0">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-lg border border-gray-alpha-400 bg-background-200">
            <KestrelLogo className="size-6" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Kestrel</h2>
            <div className="font-mono text-[12px] text-gray-900">v0.1.0 · build 56163ea</div>
          </div>
        </div>
        <CloseButton onClick={close} />
      </div>
      <div className="space-y-5 overflow-y-auto p-6">
        <p className="text-sm text-gray-900">Finds, downloads and files Movies and Series for one household’s library.</p>
        <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-[13px]">
          <dt className="text-gray-900">License</dt>
          <dd><a className="inline-flex items-center gap-1 hover:underline" href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noreferrer">GNU GPLv3 <ExternalLink size={11} /></a></dd>
          <dt className="text-gray-900">Source</dt>
          <dd><a className="inline-flex items-center gap-1 font-mono hover:underline" href="https://github.com/hyprsh/kestrel" target="_blank" rel="noreferrer">github.com/hyprsh/kestrel <ExternalLink size={11} /></a></dd>
        </dl>
        <div className="space-y-3">
          <Attribution mark="TMDB" markClass="bg-teal-100 text-teal-900" href="https://www.themoviedb.org">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </Attribution>
          <Attribution mark="TVDB" markClass="bg-green-200 text-green-900" href="https://thetvdb.com/subscribe">
            Metadata provided by TheTVDB. Please consider adding missing information or subscribing.
          </Attribution>
        </div>
      </div>
    </Dialog>
  )
}

function Attribution({ mark, markClass, href, children }: { mark: string; markClass: string; href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg border border-gray-alpha-400 p-3 hover:bg-gray-alpha-100">
      <span className={`flex h-8 w-14 shrink-0 items-center justify-center rounded-md font-mono text-[12px] font-bold ${markClass}`}>{mark}</span>
      <span className="text-[13px]">{children}</span>
    </a>
  )
}
