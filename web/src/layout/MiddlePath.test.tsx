import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MiddlePath, splitPath } from './MiddlePath'

describe('splitPath', () => {
  it('keeps the last folder apart from the way to it', () => {
    expect(splitPath('/data/media/movies-family')).toEqual({ head: '/data/media', tail: '/movies-family' })
    expect(splitPath('/data/media/tv/')).toEqual({ head: '/data/media', tail: '/tv/' })
  })

  it('has no way to a folder at the root, or a name with no slash', () => {
    expect(splitPath('/data')).toEqual({ head: '', tail: '/data' })
    expect(splitPath('/')).toEqual({ head: '', tail: '/' })
    expect(splitPath('movies')).toEqual({ head: '', tail: 'movies' })
  })
})

describe('MiddlePath', () => {
  it('keeps the whole path as text and tooltip, so two folders with one prefix stay apart', () => {
    render(
      <>
        <MiddlePath path="/tmp/kd-c809d6d0/data/media/movies" />
        <MiddlePath path="/tmp/kd-c809d6d0/data/media/movies-family" code />
      </>,
    )
    expect(screen.getByTitle('/tmp/kd-c809d6d0/data/media/movies')).toHaveTextContent('/tmp/kd-c809d6d0/data/media/movies')
    expect(screen.getByTitle('/tmp/kd-c809d6d0/data/media/movies-family')).toHaveTextContent('/tmp/kd-c809d6d0/data/media/movies-family')
    expect(screen.getByText('/movies-family')).toBeInTheDocument()
  })
})
