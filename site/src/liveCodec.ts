import type {
  BattlefieldCard,
  CardDetails,
  ReplayCombat,
  ReplayGame,
} from './replayTypes'
import { compactLiveSnapshot } from './scryfallCache'

export type LiveSeat = {
  id: string
  name: string
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
}

const seatOrder = ['p1', 'p2', 'p3', 'p4'] as const

export type LiveRequest =
  | {
      kind: 'payload'
      payload: string
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
  if (hash.startsWith('v1.')) return hash
  return null
}

export const readLiveRequest = (
  location: Pick<Location, 'search' | 'hash'> = window.location,
): LiveRequest | null => {
  const payload = readLivePayload(location)
  if (payload) return { kind: 'payload', payload }

  const query = new URLSearchParams(location.search)
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
    waiting: query.get('waiting') ?? 'What do you do?',
  }
}

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
    waiting: options.waiting ?? 'What do you do?',
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
  return snapshot
}

export const isLivePath = (pathname = window.location.pathname) => {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed.endsWith('/live')
}

export const decodeLivePayload = async (payload: string) => {
  if (!payload.startsWith('v1.')) {
    throw new Error('Unknown live snapshot version')
  }
  const encoded = payload.slice(3)
  if (!encoded) throw new Error('Empty live snapshot payload')

  const inflated = await inflate(base64UrlToBytes(encoded))
  const json = new TextDecoder().decode(inflated)
  const snapshot = JSON.parse(json) as LiveSnapshot
  if (snapshot.v !== 1) throw new Error('Unsupported live snapshot version')
  if (!snapshot.headline || !snapshot.catalog) {
    throw new Error('Live snapshot is missing required fields')
  }
  return snapshot
}

export const encodeLivePayload = async (snapshot: LiveSnapshot) => {
  const json = JSON.stringify(snapshot)
  const compressed = await deflate(new TextEncoder().encode(json))
  return `v1.${bytesToBase64Url(compressed)}`
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
