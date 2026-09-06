import type {
  BattlefieldCard,
  CardDetails,
  ReplayCombat,
} from './replayTypes'

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
  hand?: string[]
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

const seatOrder = ['p1', 'p2', 'p3', 'p4']

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

export const readLivePayload = (location = window.location) => {
  const query = new URLSearchParams(location.search).get('s')
  if (query) return query

  const hash = location.hash.replace(/^#/, '')
  if (!hash) return null
  if (hash.startsWith('s=')) return decodeURIComponent(hash.slice(2))
  if (hash.startsWith('v1.')) return hash
  return null
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
  const seats = normalizeSeats(snapshot.seats).map((seat) => {
    const { hand: _hand, ...rest } = seat
    return rest
  })
  return encodeLivePayload({
    ...snapshot,
    you: null,
    seats,
  })
}

export const planStorageKey = (snapshot: LiveSnapshot) =>
  `live-plan:${snapshot.headline}:${snapshot.you ?? 'public'}:${snapshot.turn}`
