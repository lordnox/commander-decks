import { deflateSync } from 'node:zlib'
import { describe, expect, test } from 'bun:test'
import {
  conduitPrivateUrl,
  conduitPublicUrl,
  decodeLivePayload,
  encodeLivePayload,
  encodePublicLivePayload,
  openLivePayload,
  readLiveRequest,
  replayToLiveSnapshot,
  type LiveSnapshot,
} from './liveCodec'
import {
  LIVE_SNAPSHOT_PREFIX,
  LIVE_SNAPSHOT_VERSION,
  LIVE_WIRE_PREFIX,
  LIVE_WIRE_VERSION,
  compactLiveWire,
} from './liveCompact'
import type { ReplayGame } from './replayTypes'

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
    v: LIVE_SNAPSHOT_VERSION,
    you: 'p1',
    headline: 'Test',
    turn: 1,
    phase: 'draw',
    active: 'p1',
    stack: [],
    youAct: true,
    actions: ['topdeck'],
    actionId: 3,
    legalActs: [{ kind: 'playLand', objectId: 'secret-o1', name: 'Secret Card' }],
    optionalDrawPreferences: { ability: { label: 'Private source', mode: 'accept' } },
    alwaysStopOnPriority: true,
    opening: { mulligans: 1, bottomRequired: 0 },
    topdeck: {
      kind: 'surveil',
      cards: ['Secret Card'],
      destinations: ['top', 'graveyard'],
    },
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
  expect(publicSnapshot.topdeck).toBeUndefined()
  expect(publicSnapshot.opening).toBeUndefined()
  expect(publicSnapshot.actions).toEqual([])
  expect(publicSnapshot.legalActs).toBeUndefined()
  expect(publicSnapshot.optionalDrawPreferences).toBeUndefined()
  expect(publicSnapshot.alwaysStopOnPriority).toBeUndefined()
  expect(JSON.stringify(publicSnapshot)).not.toContain('Secret Card')
})

test('public payload keeps known opponent hand cards', async () => {
  const snapshot = {
    v: LIVE_SNAPSHOT_VERSION,
    you: 'p1',
    headline: 'Test',
    turn: 1,
    phase: 'main1',
    active: 'p2',
    stack: [],
    seats: [{
      id: 'p2',
      name: 'Beta',
      commanders: [],
      color: '#2f6f64',
      life: 40,
      library_count: 90,
      hand_count: 3,
      known_hand: ['Grizzly Bears'],
      battlefield: [],
      graveyard: [],
      exile: [],
      command: [],
    }],
    catalog: {},
  } satisfies LiveSnapshot

  const payload = await encodePublicLivePayload(snapshot)
  const publicSnapshot = await openLivePayload(payload, '/')
  expect(publicSnapshot.seats[0].known_hand).toEqual(['Grizzly Bears'])
  expect(publicSnapshot.seats[0].hand).toBeUndefined()
  expect(publicSnapshot.seats[0].hand_count).toBe(3)
})

const toBase64Url = (bytes: Buffer) =>
  bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const payloadFor = (body: object, prefix: string) => {
  const compressed = deflateSync(Buffer.from(JSON.stringify(body)))
  return `${prefix}${toBase64Url(compressed)}`
}

const codecSnapshot = () => ({
  v: LIVE_SNAPSHOT_VERSION,
  headline: 'Test',
  turn: 1,
  phase: 'main1',
  active: 'p1',
  stack: [],
  seats: [],
  catalog: {},
})

const replayGame = (schema = 2) => ({
  schema,
  seed: 1,
  starting_life: 40,
  headline: 'Test',
  result: { winner: null, ended: 'truncated', turn: 1, summary: '' },
  seats: [
    { id: 'p1', name: 'Alpha', deck: 'decks/a', commanders: [], plan: '', mulligans: 0, color: '#c45c26' },
    { id: 'p2', name: 'Beta', deck: 'decks/b', commanders: [], plan: '', mulligans: 0, color: '#2f6f64' },
    { id: 'p3', name: 'Gamma', deck: 'decks/c', commanders: [], plan: '', mulligans: 0, color: '#4a5d9e' },
    { id: 'p4', name: 'Delta', deck: 'decks/d', commanders: [], plan: '', mulligans: 0, color: '#8a3d6b' },
  ],
  catalog: {},
  events: [{
    id: 0,
    turn: 1,
    phase: 'main1',
    seat: 'p1',
    kind: 'note',
    summary: 'Hello',
    state: {
      active: 'p1',
      turn: 1,
      phase: 'main1',
      stack: [],
      players: {
        p1: { life: 40, library_count: 99, hand_count: 0, hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
        p2: { life: 40, library_count: 99, hand_count: 0, hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
        p3: { life: 40, library_count: 99, hand_count: 0, hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
        p4: { life: 40, library_count: 99, hand_count: 0, hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
      },
    },
  }],
})

describe('live payload versions', () => {
  test('encode/decode accept the current compact wire', async () => {
    const payload = await encodeLivePayload(codecSnapshot())
    expect(payload.startsWith(LIVE_WIRE_PREFIX)).toBe(true)
    const decoded = await decodeLivePayload(payload)
    expect(decoded.v).toBe(LIVE_WIRE_VERSION)
    const opened = await openLivePayload(payload, '/')
    expect(opened.headline).toBe('Test')
    expect(opened.v).toBe(LIVE_SNAPSHOT_VERSION)
  })

  test('private and public encoders reject missing, v0, and unknown snapshot versions', async () => {
    const { v: _v, ...missing } = codecSnapshot()
    const unsupported = [
      missing,
      { ...codecSnapshot(), v: 0 },
      { ...codecSnapshot(), v: 1 },
      { ...codecSnapshot(), v: 3 },
    ] as LiveSnapshot[]
    for (const snapshot of unsupported) {
      await expect(encodeLivePayload(snapshot))
        .rejects.toThrow(`Unsupported live snapshot version: ${String(snapshot.v)}`)
      await expect(encodePublicLivePayload(snapshot))
        .rejects.toThrow(`Unsupported live snapshot version: ${String(snapshot.v)}`)
    }
  })

  test('an expanded v1 snapshot payload is rejected', async () => {
    const payload = payloadFor({
      v: 1,
      headline: 'Legacy snapshot',
      catalog: {},
    }, LIVE_SNAPSHOT_PREFIX)
    await expect(decodeLivePayload(payload)).rejects.toThrow('Unsupported live snapshot version: 1')
  })

  test('unknown prefixes are rejected', async () => {
    await expect(decodeLivePayload('v0.abc')).rejects.toThrow('Unknown live snapshot version')
    await expect(decodeLivePayload('not-a-version')).rejects.toThrow('Unknown live snapshot version')
  })

  test('missing, v0, and wrong body versions are rejected', async () => {
    const wire = compactLiveWire(codecSnapshot())
    await expect(decodeLivePayload(payloadFor({ ...wire, v: undefined }, LIVE_WIRE_PREFIX)))
      .rejects.toThrow('Unsupported live snapshot version: undefined')
    await expect(decodeLivePayload(payloadFor({ ...wire, v: 0 }, LIVE_WIRE_PREFIX)))
      .rejects.toThrow('Unsupported live snapshot version: 0')
    await expect(decodeLivePayload(payloadFor({ ...wire, v: 2 }, LIVE_WIRE_PREFIX)))
      .rejects.toThrow('Unsupported live snapshot version: 2')
    await expect(decodeLivePayload(payloadFor({ ...wire, v: 4 }, LIVE_WIRE_PREFIX)))
      .rejects.toThrow('Unsupported live snapshot version: 4')
    await expect(decodeLivePayload(payloadFor(wire, LIVE_SNAPSHOT_PREFIX)))
      .rejects.toThrow('Unsupported live snapshot version: 3')
  })
})

describe('replay snapshot versions', () => {
  test('the current replay schema expands to a live snapshot', () => {
    const snapshot = replayToLiveSnapshot(replayGame(2), { you: 'p1' })
    expect(snapshot.headline).toBe('Test')
    expect(snapshot.you).toBe('p1')
  })

  test('missing, v0, and unknown replay schemas are rejected', () => {
    expect(() => replayToLiveSnapshot({ ...replayGame(), schema: undefined } as ReplayGame))
      .toThrow('Unsupported replay schema version: undefined')
    expect(() => replayToLiveSnapshot(replayGame(0)))
      .toThrow('Unsupported replay schema version: 0')
    expect(() => replayToLiveSnapshot(replayGame(3)))
      .toThrow('Unsupported replay schema version: 3')
  })
})
