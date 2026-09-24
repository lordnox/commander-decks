import {
  revealBeforeDraw,
  syncRevealedLibraryTop,
} from '../cardPlugins/libraryTopKnowledge'
import type Draft from '../draft'
import type { GameEvent, PlayerId, PlayerState, Plugin, StackItem } from '../types'

export const CARDS_DRAWN_THIS_TURN = 'draw.cardsThisTurn'

export const cardsDrawnThisTurn = (player: Pick<PlayerState, 'data'>) => {
  const value = player.data[CARDS_DRAWN_THIS_TURN]
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0
}

/** Parameters stored on a draw action stack item (`payload`). */
type DrawPayload = {
  seat: PlayerId
  remaining: number
}

const drawPayload = (item: StackItem): DrawPayload | undefined => {
  const payload = item.payload
  if (!payload || typeof payload.seat !== 'string' || typeof payload.remaining !== 'number') {
    return
  }
  return payload as DrawPayload
}

const drawCount = (event: Extract<GameEvent, { type: 'draw' }>) => event.count ?? 1

/**
 * Push a draw action onto the stack when a spell or ability needs a stack object
 * for a draw (for example a waiting discard paired with a draw).
 * Normal “draw N” during 608.2 uses `{ type: 'draw', count: N }` events instead.
 */
export const initiateDraw = (
  draft: Draft,
  args: {
    seat: PlayerId
    remaining: number
    sourceId?: string
    name?: string
  },
): StackItem =>
  draft.addToStack({
    kind: 'action',
    actionId: 'draw',
    objectId: args.sourceId ?? '',
    controller: args.seat,
    name: args.name ?? 'Draw',
    targets: [],
    payload: {
      seat: args.seat,
      remaining: args.remaining,
    },
  })

/**
 * Resolve a draw action at the top of the stack during `resolveTop`.
 * Each resolution enqueues one draw event; further draws stay on the stack as actions.
 */
export const resolveDrawAction = (draft: Draft, item: StackItem) => {
  if (item.actionId !== 'draw') return

  const payload = drawPayload(item)
  if (!payload) return

  const { seat, remaining } = payload
  if (draft.stack[0]?.id !== item.id) return

  draft.stack.shift()
  draft.enqueue({ type: 'draw', seat, count: 1 })

  if (remaining > 1) {
    initiateDraw(draft, {
      seat,
      remaining: remaining - 1,
      sourceId: item.objectId,
      name: item.name,
    })
  }

  draft.passedInRow = []
  draft.priority = draft.active
}

const authoritativeApply = (draft: Draft, seat: PlayerId) => {
  revealBeforeDraw(draft, seat)
  const objectId = draft.zoneOrder[seat].library[0]
  if (!objectId) {
    draft.players[seat].lost = true
    draft.note(`${seat} draws from an empty library`)
    return
  }
  const object = draft.move(objectId, 'hand')
  if (object) {
    const player = draft.players[seat]
    player.data[CARDS_DRAWN_THIS_TURN] = cardsDrawnThisTurn(player) + 1
    draft.note(`${seat} draws a card`)
  }
  syncRevealedLibraryTop(draft, [seat])
}

/**
 * Builtin game rule for drawing (CR 121.2).
 * - `draw` event: one card from library to hand (121.2a–c).
 * - `count > 1` is replaced one card at a time. Each successful draw queues the
 *   rest, allowing a replacement choice to pause before the next card without
 *   introducing priority between draws (CR 117.3a / 121.2 / 608 / 704).
 * - `draw` stack actions are only for cases that genuinely need a stack object.
 */
export const draw: Plugin = {
  id: 'draw',
  replace: ({ event }) => {
    if (event.type !== 'draw') return
    const count = drawCount(event)
    if (count <= 1) return
    return {
      type: 'draw' as const,
      seat: event.seat,
      count: 1,
      remainingAfter: count - 1,
      ...(event.replacedBy ? { replacedBy: event.replacedBy } : {}),
    }
  },
  legal: ({ state, event }) => {
    if (event.type !== 'draw') return
    if (!state.players[event.seat]) return 'player is not in the game'
    const count = drawCount(event)
    if (!Number.isInteger(count) || count < 1) return 'draw count must be a positive integer'
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'draw') return
    if (draft.knowledge.mode !== 'authoritative') return
    authoritativeApply(draft, event.seat)
    if (event.remainingAfter && !draft.players[event.seat].lost) {
      draft.enqueue({
        type: 'draw',
        seat: event.seat,
        count: event.remainingAfter,
        ...(event.replacedBy ? { replacedBy: event.replacedBy } : {}),
      })
    }
  },
}
