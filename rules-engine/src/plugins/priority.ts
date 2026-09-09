import type { Draft } from '../draft'
import { SEAT_IDS, type HookCtx, type Plugin } from '../types'
import { nextLivingSeat } from './turnStructure'

const PERMANENT_TYPES = ['Creature', 'Artifact', 'Enchantment', 'Land', 'Planeswalker', 'Battle']

/**
 * Minimal resolution so a full pass round is playable without the kernel being
 * re-entrant from a plugin. The `spells` plugin owns the explicit `resolveTop`
 * event and the richer resolution it needs.
 */
const resolveTopItem = (draft: Draft) => {
  const item = draft.stack.shift()
  if (!item) return
  const object = draft.object(item.objectId)
  if (object && item.kind === 'spell') {
    const permanent = object.types.some((type) => PERMANENT_TYPES.includes(type))
    draft.move(item.objectId, permanent ? 'battlefield' : 'graveyard')
    if (permanent) object.summoningSickness = object.types.includes('Creature')
  }
  draft.note(`resolve ${item.name}`)
}

const legal = ({ state, event }: HookCtx) => {
  if (event.type !== 'passPriority') return
  if (state.priority !== event.seat) return `${event.seat} does not have priority`
  if (state.players[event.seat].lost) return `${event.seat} has lost the game`
}

const apply = ({ event, draft }: HookCtx) => {
  if (event.type !== 'passPriority') return
  if (!draft.passedInRow.includes(event.seat)) draft.passedInRow.push(event.seat)

  const living = SEAT_IDS.filter((seat) => !draft.players[seat].lost)
  const allPassed = living.every((seat) => draft.passedInRow.includes(seat))
  if (!allPassed) {
    draft.priority = nextLivingSeat(draft, event.seat)
    return
  }

  if (draft.stack.length > 0) {
    resolveTopItem(draft)
    draft.passedInRow = []
    draft.priority = draft.active
    return
  }

  draft.enqueue({ type: 'emptyManaPools' })
  draft.enqueue({ type: 'custom', name: 'advanceStep' })
}

export const priority: Plugin = { id: 'priority', legal, apply }
