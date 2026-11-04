import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReleaseFacts, type Facts } from './ReleaseFacts'

const facts: Facts = {
  size: '8 GB',
  quality: 'Bluray-1080p',
  video_codec: 'H.265',
  hdr: null,
  audio_codec: 'DD',
  audio_channels: '5.1',
  languages: ['English'],
  indexer: 'Alpha',
  group: 'GRP',
  score: 1550,
  formats: [
    { name: 'WEB Tier 01', points: 1700 },
    { name: 'x265', points: -150 },
  ],
}

describe('ReleaseFacts', () => {
  it('lays the facts out label beside value, in order, leaving out what is not known', () => {
    render(<ReleaseFacts facts={{ size: '1 GB', score: null }} layout="narrow" />)
    expect(screen.getByText('Size').nextElementSibling).toHaveTextContent('1 GB')
    expect(screen.queryByText('Quality')).not.toBeInTheDocument()
    expect(screen.queryByText('Video')).not.toBeInTheDocument()
    expect(screen.queryByText('Score')).not.toBeInTheDocument()
  })

  it('narrow: one column with the Score as a number followed by gray badges, a real minus for negative points', () => {
    const { container } = render(<ReleaseFacts facts={facts} layout="narrow" />)
    expect([...container.querySelectorAll('dt')].map((e) => e.textContent)).toEqual(['Quality', 'Video', 'Audio', 'Size', 'Indexer', 'Group', 'Score'])
    expect(screen.getByText('Video').nextElementSibling).toHaveTextContent('H.265 · SDR')
    const score = screen.getByText('Score').nextElementSibling as HTMLElement
    expect(score).toHaveTextContent(/^1,550/)
    expect(
      within(within(score).getByRole('list', { name: 'Custom Formats' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['WEB Tier 01 +1,700', 'x265 −150'])
    expect(screen.queryByText('Why it scores 1,550')).not.toBeInTheDocument()
  })

  it('wide: the facts and a "Why it scores" table side by side, with the Profile remainder', () => {
    render(<ReleaseFacts facts={{ ...facts, score: 1600 }} layout="wide" />)
    const why = screen.getByText('Why it scores 1,600').parentElement as HTMLElement
    expect(within(why).getByText('WEB Tier 01').nextSibling).toHaveTextContent('+1,700')
    expect(within(why).getByText('x265').nextSibling).toHaveTextContent('−150')
    expect(within(why).getByText('Profile and quality').nextSibling).toHaveTextContent('+50')
    expect(within(why).getByText('Score').nextSibling).toHaveTextContent('1,600')
    expect(screen.getByText('Quality').closest('dl')).not.toBe(why.querySelector('dl'))
    expect(screen.queryByRole('list', { name: 'Custom Formats' })).not.toBeInTheDocument()
  })

  it('shows the held Score and the difference when the Release replaces files', () => {
    const replaces = [{ state: 'filled' as const, file_score: 1000 }]
    render(<ReleaseFacts facts={facts} layout="wide" replaces={replaces} />)
    expect(screen.getByText('Held file').nextSibling).toHaveTextContent('1,000')
    expect(screen.getByText('Difference').nextSibling).toHaveTextContent('+550')
  })

  it('shows the Custom Formats alone when there is no Score', () => {
    render(<ReleaseFacts facts={{ ...facts, score: undefined }} layout="wide" />)
    expect(screen.getByText('Custom Formats')).toBeInTheDocument()
    expect(screen.getByText('WEB Tier 01').nextSibling).toHaveTextContent('+1,700')
    expect(screen.queryByText('Score')).not.toBeInTheDocument()
  })
})
