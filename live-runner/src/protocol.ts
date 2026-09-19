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
const SEAT_ID_SET: ReadonlySet<string> = new Set(SEAT_IDS)
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

export const PLAY_ACTIONS = [
  'plan',
  'confirm',
  'replace',
  'pass',
  'keep',
  'mulligan',
  'topdeck',
  'advance',
  'act',
] as const
export type PlayAction = (typeof PLAY_ACTIONS)[number]

import {
  TOPDECK_DESTINATIONS,
  type TopdeckDestination,
} from '../../shared/liveTypes'

export { TOPDECK_DESTINATIONS, type TopdeckDestination }
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
  | { type: 'keep'; cards?: string[]; cheat?: boolean }
  | { type: 'mulligan' }
  | {
      type: 'topdeck'
      choices: Array<{ card: string; destination: TopdeckDestination }>
    }
  | { type: 'advance' }
  | {
      type: 'act'
      kind: 'playLand' | 'tapForMana' | 'castSpell' | 'activateAbility' | 'declareAttackers'
      objectId?: string
      targetObjectId?: string
      targetPlayerId?: string
      targetObjectIds?: string[]
      abilityId?: string
      text?: string
      mana?: 'W' | 'U' | 'B' | 'R' | 'G' | 'C'
      x?: number
      attackers?: Array<{ objectId: string; defenderId: string }>
    }
  | { type: 'priority-mode'; always: boolean }
  | { type: 'hold'; until: 'my-turn' | 'off' }
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
  SEAT_ID_SET.has(value)

export const parseInbox = (raw: string): InboxMessage | null => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || !('type' in value)) return null
  const message = value as InboxMessage & {
    text?: string
    name?: string
    deck?: string
    with?: string
    cards?: unknown
    cheat?: unknown
    always?: unknown
    until?: unknown
    kind?: unknown
    objectId?: unknown
    targetObjectId?: unknown
    targetPlayerId?: unknown
    targetObjectIds?: unknown
    abilityId?: unknown
    mana?: unknown
    attackers?: unknown
    x?: unknown
  }
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
    case 'mulligan':
      return parsed({ type: 'mulligan' })
    case 'advance':
      return parsed({ type: 'advance' })
    case 'act': {
      const kind = message.kind
      const objectId = message.objectId
      const targetObjectId = message.targetObjectId
      const targetPlayerId = message.targetPlayerId
      const targetObjectIds = message.targetObjectIds
      const mana = message.mana
      const abilityId = message.abilityId
      const text = message.text
      const attackers = message.attackers
      const x = message.x
      if (kind === 'declareAttackers') {
        if (
          !Array.isArray(attackers)
          || !attackers.every((attacker) =>
            attacker
            && typeof attacker === 'object'
            && 'objectId' in attacker
            && typeof attacker.objectId === 'string'
            && attacker.objectId
            && 'defenderId' in attacker
            && typeof attacker.defenderId === 'string'
            && attacker.defenderId)
        ) {
          return null
        }
        return parsed({
          type: 'act',
          kind: 'declareAttackers',
          attackers: attackers.map(({ objectId, defenderId }) => ({ objectId, defenderId })),
        })
      }
      if (
        !['playLand', 'tapForMana', 'castSpell', 'activateAbility'].includes(kind as string)
        || typeof objectId !== 'string'
        || !objectId
      ) {
        return null
      }
      return parsed({
        type: 'act',
        kind: kind as 'playLand' | 'tapForMana' | 'castSpell' | 'activateAbility',
        objectId,
        ...(typeof targetObjectId === 'string' ? { targetObjectId } : {}),
        ...(typeof targetPlayerId === 'string' ? { targetPlayerId } : {}),
        ...(Array.isArray(targetObjectIds) && targetObjectIds.every(
          (target): target is string => typeof target === 'string' && Boolean(target),
        ) ? { targetObjectIds } : {}),
        ...(typeof abilityId === 'string' ? { abilityId } : {}),
        ...(typeof text === 'string' ? { text } : {}),
        ...(typeof mana === 'string' && ['W', 'U', 'B', 'R', 'G', 'C'].includes(mana)
          ? { mana: mana as 'W' | 'U' | 'B' | 'R' | 'G' | 'C' }
          : {}),
        ...(typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? { x } : {}),
      })
    }
    case 'priority-mode':
      return typeof message.always === 'boolean'
        ? { type: 'priority-mode', always: message.always }
        : null
    case 'hold':
      return message.until === 'my-turn' || message.until === 'off'
        ? { type: 'hold', until: message.until }
        : null
    case 'topdeck': {
      if (
        !Array.isArray(message.choices)
        || !message.choices.every(
          (choice) =>
            choice
            && typeof choice === 'object'
            && typeof choice.card === 'string'
            && (TOPDECK_DESTINATIONS as readonly string[]).includes(choice.destination),
        )
      ) {
        return null
      }
      return parsed({
        type: 'topdeck',
        choices: message.choices.map(({ card, destination }) => ({
          card,
          destination,
        })),
      })
    }
    case 'keep': {
      const cards = Array.isArray(message.cards)
        ? message.cards
        : undefined
      if (cards && !cards.every((card) => typeof card === 'string')) return null
      return parsed({
        type: 'keep',
        ...(cards ? { cards } : {}),
        ...(message.cheat === true ? { cheat: true } : {}),
      })
    }
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
