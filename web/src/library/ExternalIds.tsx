import { Link } from '@hyprsh/design'
import { ExternalLink } from 'lucide-react'
import { Fragment } from 'react'
import { titleLinks } from './links'

/** A Title's TMDB, IMDb and TheTVDB ids, each opening the Title on its site in a new tab. */
export function ExternalIds({ title }: { title: Parameters<typeof titleLinks>[0] }) {
  const links = titleLinks(title)
  if (links.length === 0) return null
  return (
    <div className="label-12-mono mt-0.5 text-gray-900">
      {links.map((l, i) => (
        <Fragment key={l.href}>
          {i > 0 && ' · '}
          <Link href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5">
            {l.label}
            <ExternalLink aria-hidden className="size-2.5" />
          </Link>
        </Fragment>
      ))}
    </div>
  )
}
