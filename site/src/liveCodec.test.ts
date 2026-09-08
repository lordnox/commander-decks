import { describe, expect, test } from 'bun:test'
import {
  conduitPrivateUrl,
  conduitPublicUrl,
  readLiveRequest,
} from './liveCodec'

const host = 'a'.repeat(43)
const seat = 'b'.repeat(43)
const inbox = 'c'.repeat(43)

describe('live request parsing', () => {
  test('reads conduit parameters before a replay game', () => {
    expect(readLiveRequest({
      search: `?game=old-game&host=${host}&you=p2&seat=${seat}&inbox=${inbox}&c=https%3A%2F%2Fexample.test%2F`,
      hash: '',
    })).toEqual({
      kind: 'conduit',
      origin: 'https://example.test',
      host,
      you: 'p2',
      seat,
      inbox,
    })
  })

  test('keeps an offline payload ahead of conduit', () => {
    expect(readLiveRequest({
      search: `?s=v2.payload&host=${host}`,
      hash: '',
    })).toEqual({ kind: 'payload', payload: 'v2.payload' })
  })

  test('rejects an invalid conduit host key', () => {
    expect(() => readLiveRequest({
      search: '?host=too-short',
      hash: '',
    })).toThrow('host key is not valid')
  })
})

describe('conduit links', () => {
  const request = {
    kind: 'conduit' as const,
    origin: 'https://example.test',
    host,
    you: 'p3',
    seat,
    inbox,
  }
  const page = 'https://lordnox.github.io/commander-decks/live/?old=1#state'

  test('private links retain seat credentials', () => {
    const url = new URL(conduitPrivateUrl(request, page))
    expect(url.pathname).toBe('/commander-decks/live/')
    expect(url.searchParams.get('host')).toBe(host)
    expect(url.searchParams.get('you')).toBe('p3')
    expect(url.searchParams.get('seat')).toBe(seat)
    expect(url.searchParams.get('inbox')).toBe(inbox)
    expect(url.searchParams.get('c')).toBe('https://example.test')
  })

  test('public links strip seat and inbox credentials', () => {
    const url = new URL(conduitPublicUrl(request, page))
    expect(url.searchParams.get('host')).toBe(host)
    expect(url.searchParams.has('you')).toBeFalse()
    expect(url.searchParams.has('seat')).toBeFalse()
    expect(url.searchParams.has('inbox')).toBeFalse()
  })
})
