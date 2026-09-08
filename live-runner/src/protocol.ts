export const BIN_LABELS = [
  'host',
  'p1',
  'p1-inbox',
  'p2',
  'p2-inbox',
  'p3',
  'p3-inbox',
  'p4',
  'p4-inbox',
] as const

export const SEAT_IDS = ['p1', 'p2', 'p3', 'p4'] as const

export type SeatId = (typeof SEAT_IDS)[number]
export type BinLabel = (typeof BIN_LABELS)[number]
export type LobbyPhase =
  | 'gathering'
  | 'seated'
  | 'pregame'
  | 'ready'
  | 'play'
  | 'ended'

export type BinPair = { read: string; write: string }
export type Invite = { read: string; mailbox?: string }

export const PLAY_ACTIONS = ['plan', 'confirm', 'replace', 'pass'] as const
export type PlayAction = (typeof PLAY_ACTIONS)[number]
export type SeatActions = Partial<Record<SeatId, PlayAction[]>>
export type SeatActionIds = Record<SeatId, number>

type InboxPayload =
  | { type: 'plan'; text: string }
  | { type: 'confirm'; text?: string }
  | { type: 'pass' }
  | { type: 'replace'; text: string }
  | { type: 'join'; name: string; deck: string }
  | { type: 'ready' }
  | { type: 'swap'; with: SeatId }
  | { type: 'pregame'; cards: string[] }
  | { type: 'rules'; text: string }
  | { type: 'talk'; text: string }

export type InboxMessage = InboxPayload & { actionId?: number }

export const KEY_RE = /^[A-Za-z0-9_-]{40,44}$/

export const inboxLabel = (seat: SeatId) => `${seat}-inbox` as const

export const formatInvite = (read: string, mailbox?: string) =>
  mailbox ? `${read}|${mailbox}` : read

export const parseInvite = (token: string): Invite => {
  const trimmed = token.trim()
  const pipe = trimmed.indexOf('|')
  if (pipe < 0) return { read: trimmed }
  return {
    read: trimmed.slice(0, pipe),
    mailbox: trimmed.slice(pipe + 1) || undefined,
  }
}

export const seatInviteLacksHostWrite = (
  invite: Invite,
  hostWrite: string,
) => invite.read !== hostWrite && invite.mailbox !== hostWrite

export const isSeatId = (value: string): value is SeatId =>
  SEAT_IDS.includes(value as SeatId)

export const parseInbox = (raw: string): InboxMessage | null => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || !('type' in value)) return null
  const message = value as InboxMessage & { text?: string; name?: string; deck?: string; with?: string; cards?: unknown }
  const actionId = typeof message.actionId === 'number' && Number.isSafeInteger(message.actionId)
    ? message.actionId
    : undefined
  const parsed = <T extends InboxPayload>(payload: T): InboxMessage => ({
    ...payload,
    ...(actionId === undefined ? {} : { actionId }),
  })
  switch (message.type) {
    case 'plan':
    case 'replace':
      return typeof message.text === 'string'
        ? parsed({ type: message.type, text: message.text })
        : null
    case 'confirm':
      return parsed({
        type: 'confirm',
        text: typeof message.text === 'string' ? message.text : undefined,
      })
    case 'pass':
      return parsed({ type: 'pass' })
    case 'join':
      return typeof message.name === 'string' && typeof message.deck === 'string'
        ? { type: 'join', name: message.name, deck: message.deck }
        : null
    case 'ready':
      return { type: 'ready' }
    case 'swap':
      return typeof message.with === 'string' && isSeatId(message.with)
        ? { type: 'swap', with: message.with }
        : null
    case 'pregame':
      return Array.isArray(message.cards) && message.cards.every((card) => typeof card === 'string')
        ? { type: 'pregame', cards: message.cards }
        : null
    case 'rules':
    case 'talk':
      return typeof message.text === 'string' ? { type: message.type, text: message.text } : null
    default:
      return null
  }
}

export const pagesLiveUrl = (
  base: string,
  invite: Invite,
  origin?: string,
  defaultOrigin = 'https://conduit.app.kopelke.online',
) => {
  const url = new URL(base.endsWith('/') ? base : `${base}/`)
  url.search = ''
  url.hash = ''
  url.searchParams.set('k', formatInvite(invite.read, invite.mailbox))
  const selected = origin?.replace(/\/+$/, '')
  if (selected && selected !== defaultOrigin) url.searchParams.set('c', selected)
  return url.toString()
}
