import { describe, expect, test } from 'bun:test'
import {
  conduitPrivateUrl,
  conduitPublicUrl,
  encodePublicLivePayload,
  openLivePayload,
  readLiveRequest,
  type LiveSnapshot,
} from './liveCodec'

const host = 'a'.repeat(43)
const seat = 'b'.repeat(43)
const inbox = 'c'.repeat(43)

describe('live request parsing', () => {
  test('reads a private conduit invite', () => {
    expect(readLiveRequest({
      search: `?k=${seat}%7C${inbox}`,
      hash: '',
    })).toEqual({
      kind: 'conduit',
      origin: 'https://conduit.app.kopelke.online',
      host: seat,
      read: seat,
      inbox,
    })
  })

  test('reads a spectator conduit invite', () => {
    expect(readLiveRequest({
      search: `?k=${host}`,
      hash: '',
    })).toEqual({
      kind: 'conduit',
      origin: 'https://conduit.app.kopelke.online',
      host,
      read: host,
    })
  })

  test('reads conduit parameters before a replay game', () => {
    expect(readLiveRequest({
      search: `?game=old-game&host=${host}&you=p2&seat=${seat}&inbox=${inbox}&c=https%3A%2F%2Fexample.test%2F`,
      hash: '',
    })).toEqual({
      kind: 'conduit',
      origin: 'https://example.test',
      host,
      read: seat,
      you: 'p2',
      seat,
      inbox,
    })
  })

  test('keeps an offline payload ahead of conduit', () => {
    expect(readLiveRequest({
      search: `?s=v2.payload&k=${host}`,
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
    read: seat,
    you: 'p3',
    seat,
    inbox,
  }
  const page = 'https://lordnox.github.io/commander-decks/live/?old=1#state'

  test('private links use one conduit key', () => {
    const url = new URL(conduitPrivateUrl(request, page))
    expect(url.pathname).toBe('/commander-decks/live/')
    expect(url.searchParams.get('k')).toBe(`${seat}|${inbox}`)
    expect(url.searchParams.has('host')).toBeFalse()
    expect(url.searchParams.has('you')).toBeFalse()
    expect(url.searchParams.has('seat')).toBeFalse()
    expect(url.searchParams.has('inbox')).toBeFalse()
    expect(url.searchParams.get('c')).toBe('https://example.test')
  })

  test('public links use the public host read without mailbox credentials', () => {
    const url = new URL(conduitPublicUrl(request, page))
    expect(url.searchParams.get('k')).toBe(host)
    expect(url.searchParams.has('host')).toBeFalse()
    expect(url.searchParams.has('you')).toBeFalse()
    expect(url.searchParams.has('seat')).toBeFalse()
    expect(url.searchParams.has('inbox')).toBeFalse()
  })
})

test('public payload redacts a private draw summary', async () => {
  const snapshot = {
    v: 1,
    you: 'p1',
    headline: 'Test',
    turn: 1,
    phase: 'draw',
    active: 'p1',
    stack: [],
    seats: [{
      id: 'p1',
      name: 'Alpha',
      commanders: [],
      color: '#c45c26',
      life: 40,
      library_count: 90,
      hand_count: 8,
      hand: ['Secret Card'],
      battlefield: [],
      graveyard: [],
      exile: [],
      command: [],
    }],
    events: [{
      id: 1,
      turn: 1,
      phase: 'draw',
      seat: 'p1',
      kind: 'draw',
      summary: 'Alpha draws Secret Card.',
    }],
    catalog: {},
  } satisfies LiveSnapshot

  const payload = await encodePublicLivePayload(snapshot)
  const publicSnapshot = await openLivePayload(payload, '/')
  expect(publicSnapshot.you).toBeNull()
  expect(publicSnapshot.events?.[0].summary).toBe('Alpha draws a card.')
  expect(JSON.stringify(publicSnapshot)).not.toContain('Secret Card')
})
