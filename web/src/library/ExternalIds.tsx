import { MenuItem } from '@hyprsh/design'
import { ExternalLink } from 'lucide-react'
import { titleLinks } from './links'

/** Where each id's link opens, by the start of its label. */
const site = (label: string) => (label.startsWith('TMDB') ? 'TMDB' : label.startsWith('TVDB') ? 'TVDB' : 'IMDb')

/** A Title's TMDB, IMDb and TheTVDB ids as "Open in …" items for the Title menu, each opening the Title on its site in a new tab. */
export function externalIdItems(title: Parameters<typeof titleLinks>[0]) {
  return titleLinks(title).map((l) => (
    <MenuItem
      key={l.href}
      href={l.href}
      target="_blank"
      rel="noopener noreferrer"
      prefix={<ExternalLink aria-hidden className="size-4" />}
      suffix={<span className="label-12-mono text-gray-900">{l.label}</span>}
    >
      {`Open in ${site(l.label)}`}
    </MenuItem>
  ))
}
