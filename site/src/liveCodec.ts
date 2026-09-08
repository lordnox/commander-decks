import type {
  BattlefieldCard,
  CardDetails,
  ReplayCombat,
  ReplayGame,
} from './replayTypes'
import { compactLiveSnapshot } from './scryfallCache'
import {
  DEFAULT_WAITING,
  compactLiveWire,
  expandLiveWire,
  loadDeckIndexes,
  type DeckIndex,
  type LiveWireV2,
} from './liveCompact'
import { DEFAULT_CONDUIT_ORIGIN, conduitOrigin } from './liveConduit'

export type LiveSeat = {
  id: string
  name: string
  deck?: string
  commanders: string[]
  color: string
  life: number
  poison?: number
  commander_damage?: Record<string, number>
  commander_tax?: number
  library_count: number
  hand_count: number
  hand?: Array<string | number>
  battlefield: BattlefieldCard[]
  graveyard: Array<string | number>
  exile: Array<string | number>
  command: Array<string | number>
  revealed_top?: Array<string | number>
}

export type LiveSnapshot = {
  v: 1
  you?: string | null
  headline: string
  waiting?: string
  talk?: string
  turn: number
  phase: string
  active: string
  stack: Array<{
    name: string | number
    controller?: string
    text?: string
  }>
  combat?: ReplayCombat
  seats: LiveSeat[] | Record<string, LiveSeat>
  catalog: Record<string, CardDetails>
  tokens?: Record<string, CardDetails>
  decks?: string[]
  deckIndexes?: Record<string, DeckIndex>
}

const seatOrder = ['p1', 'p2', 'p3', 'p4'] as const

export type LiveRequest =
  | {
      kind: 'payload'
      payload: string
    }
  | {
      kind: 'conduit'
      origin: string
      host: string
      read: string
      you?: string
      seat?: string
      inbox?: string
    }
  | {
      kind: 'replay'
      game: string
      eventId?: number
      you?: string
      talk: string
      waiting: string
    }

export const normalizeSeats = (seats: LiveSnapshot['seats']) => {
  if (Array.isArray(seats)) {
    const byId = new Map(seats.map((seat) => [seat.id, seat]))
    return seatOrder.map((id) => byId.get(id)).filter(Boolean) as LiveSeat[]
  }
  return seatOrder.map((id) => seats[id]).filter(Boolean)
}

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const base64UrlToBytes = (value: string) => {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const asBlobPart = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

const inflate = async (bytes: Uint8Array) => {
  const stream = new Blob([asBlobPart(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const deflate = async (bytes: Uint8Array) => {
  const stream = new Blob([asBlobPart(bytes)])
    .stream()
    .pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export const readLivePayload = (location: Pick<Location, 'search' | 'hash'> = window.location) => {
  const query = new URLSearchParams(location.search).get('s')
  if (query) return query

  const hash = location.hash.replace(/^#/, '')
  if (!hash) return null
  if (hash.startsWith('s=')) return decodeURIComponent(hash.slice(2))
  if (hash.startsWith('v1.') || hash.startsWith('v2.')) return hash
  return null
}

export const readLiveRequest = (
  location: Pick<Location, 'search' | 'hash'> = window.location,
): LiveRequest | null => {
  const payload = readLivePayload(location)
  if (payload) return { kind: 'payload', payload }

  const query = new URLSearchParams(location.search)
  const conduitKey = query.get('k')
  if (conduitKey !== null) {
    const pipe = conduitKey.indexOf('|')
    const read = pipe < 0 ? conduitKey : conduitKey.slice(0, pipe)
    const inbox = pipe < 0 ? undefined : conduitKey.slice(pipe + 1)
    if (!/^[A-Za-z0-9_-]{40,44}$/.test(read)) {
      throw new Error('This live conduit read key is not valid')
    }
    if (inbox !== undefined && !/^[A-Za-z0-9_-]{40,44}$/.test(inbox)) {
      throw new Error('This live conduit inbox key is not valid')
    }
    return {
      kind: 'conduit',
      origin: conduitOrigin(location),
      host: read,
      read,
      inbox,
    }
  }

  const host = query.get('host')
  if (host) {
    if (!/^[A-Za-z0-9_-]{40,44}$/.test(host)) {
      throw new Error('This live conduit host key is not valid')
    }
    const you = query.get('you') || undefined
    if (you && !seatOrder.includes(you as (typeof seatOrder)[number])) {
      throw new Error('This live viewer seat is not valid')
    }
    return {
      kind: 'conduit',
      origin: conduitOrigin(location),
      host,
      read: you && query.get('seat') ? query.get('seat') as string : host,
      you,
      seat: query.get('seat') || undefined,
      inbox: query.get('inbox') || undefined,
    }
  }

  const game = query.get('game')
  if (!game) return null
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(game)) {
    throw new Error('This live game link is not valid')
  }

  const event = query.get('event')
  if (event !== null && !/^\d+$/.test(event)) {
    throw new Error('This live event id is not valid')
  }

  const you = query.get('you') || undefined
  if (you && !seatOrder.includes(you as (typeof seatOrder)[number])) {
    throw new Error('This live viewer seat is not valid')
  }

  return {
    kind: 'replay',
    game,
    eventId: event === null ? undefined : Number(event),
    you,
    talk: query.get('talk') ?? '',
    waiting: query.get('waiting') ?? DEFAULT_WAITING,
  }
}

type ConduitRequest = Extract<LiveRequest, { kind: 'conduit' }>

const conduitUrl = (
  request: ConduitRequest,
  includePrivate: boolean,
  pageUrl: string | URL = window.location.href,
) => {
  const url = new URL(pageUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  url.search = ''
  url.hash = ''
  const read = includePrivate ? request.read : request.host
  const key = includePrivate && request.inbox
    ? `${read}|${request.inbox}`
    : read
  url.searchParams.set('k', key)
  if (request.origin !== DEFAULT_CONDUIT_ORIGIN) {
    url.searchParams.set('c', request.origin)
  }
  return url.toString()
}

export const conduitPrivateUrl = (
  request: ConduitRequest,
  pageUrl?: string | URL,
) => conduitUrl(request, true, pageUrl)

export const conduitPublicUrl = (
  request: ConduitRequest,
  pageUrl?: string | URL,
) => conduitUrl(request, false, pageUrl)

export const replayToLiveSnapshot = (
  replay: ReplayGame,
  options: {
    eventId?: number
    you?: string
    talk?: string
    waiting?: string
  } = {},
) => {
  if (!Array.isArray(replay.events) || replay.events.length === 0) {
    throw new Error('This replay has no events')
  }

  const event = options.eventId === undefined
    ? replay.events.at(-1)
    : replay.events.find(({ id }) => id === options.eventId)
  if (!event) {
    throw new Error(`This replay has no event with id ${options.eventId}`)
  }
  if (!event.state || typeof event.state.players !== 'object') {
    throw new Error(`Event ${event.id} has no table state`)
  }

  const metadata = new Map(replay.seats.map((seat) => [seat.id, seat]))
  const seats = seatOrder.map((id) => {
    const seat = metadata.get(id)
    const player = event.state.players[id]
    const hand = [...(player?.hand ?? [])]
    const snapshotSeat: LiveSeat = {
      id,
      name: seat?.name || id,
      deck: seat?.deck || '',
      commanders: [...(seat?.commanders ?? [])],
      color: seat?.color || '#888888',
      life: player?.life ?? replay.starting_life ?? 40,
      poison: player?.poison ?? 0,
      commander_damage: { ...(player?.commander_damage ?? {}) },
      commander_tax: player?.commander_tax ?? 0,
      library_count: player?.library_count ?? 0,
      hand_count: player?.hand_count ?? hand.length,
      battlefield: [...(player?.battlefield ?? [])],
      graveyard: [...(player?.graveyard ?? [])],
      exile: [...(player?.exile ?? [])],
      command: [...(player?.command ?? [])],
    }

    if (options.you === id) snapshotSeat.hand = hand
    if (player?.revealed_top !== undefined) {
      snapshotSeat.revealed_top = [...player.revealed_top]
    }
    return snapshotSeat
  })

  const stateWithCombat = event.state as typeof event.state & {
    combat?: ReplayCombat
  }
  const snapshot: LiveSnapshot = {
    v: 1,
    you: options.you ?? null,
    headline: replay.headline,
    waiting: options.waiting ?? DEFAULT_WAITING,
    talk: options.talk ?? '',
    turn: event.state.turn ?? event.turn,
    phase: event.state.phase ?? event.phase,
    active: event.state.active || event.seat || '',
    stack: [...(event.state.stack ?? [])],
    seats,
    catalog: replay.catalog,
    tokens: replay.tokens,
  }

  const combat = event.combat ?? stateWithCombat.combat
  if (combat) snapshot.combat = combat
  snapshot.decks = replay.seats
    .map((seat) => seat.deck?.split('/').filter(Boolean).at(-1) || '')
    .filter(Boolean)
  return snapshot
}

export const isLivePath = (pathname = window.location.pathname) => {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed.endsWith('/live')
}

export const decodeLivePayload = async (payload: string) => {
  const prefix = payload.startsWith('v2.') ? 'v2.' : payload.startsWith('v1.') ? 'v1.' : null
  if (!prefix) {
    throw new Error('Unknown live snapshot version')
  }
  const encoded = payload.slice(prefix.length)
  if (!encoded) throw new Error('Empty live snapshot payload')

  const inflated = await inflate(base64UrlToBytes(encoded))
  const json = new TextDecoder().decode(inflated)
  const snapshot = JSON.parse(json) as LiveSnapshot | LiveWireV2
  if (snapshot.v !== 1 && snapshot.v !== 2) {
    throw new Error('Unsupported live snapshot version')
  }
  if (snapshot.v === 1 && (!snapshot.headline || !snapshot.catalog)) {
    throw new Error('Live snapshot is missing required fields')
  }
  if (snapshot.v === 2 && !snapshot.h) {
    throw new Error('Live snapshot is missing required fields')
  }
  return snapshot
}

export const openLivePayload = async (payload: string, base: string) => {
  const decoded = await decodeLivePayload(payload)
  if (decoded.v === 1) return decoded
  const indexes = await loadDeckIndexes(decoded.d ?? [], base)
  return expandLiveWire(decoded, indexes)
}

export const encodeLivePayload = async (snapshot: LiveSnapshot) => {
  const wire = compactLiveWire(compactLiveSnapshot(snapshot))
  const json = JSON.stringify(wire)
  const compressed = await deflate(new TextEncoder().encode(json))
  return `v2.${bytesToBase64Url(compressed)}`
}

/** Public encode: drop every hand array and clear `you`. Keep hand_count. */
export const encodePublicLivePayload = async (snapshot: LiveSnapshot) => {
  const compact = compactLiveSnapshot(snapshot)
  const seats = normalizeSeats(compact.seats).map((seat) => {
    const { hand: _hand, ...rest } = seat
    return rest
  })
  return encodeLivePayload({
    ...compact,
    you: null,
    seats,
  })
}

export const planStorageKey = (snapshot: LiveSnapshot) =>
  `live-plan:${snapshot.headline}:${snapshot.you ?? 'public'}:${snapshot.turn}`
