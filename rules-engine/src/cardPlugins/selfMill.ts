import {
  applyAbility,
  asManaAbility,
  controlledByActivator,
  sourceCanTap,
  sourceNamed,
  sourceOnBattlefield,
  whenAbility,
} from '../plugins/activateAbility'
import type { AbilityCheck } from '../plugins/activateAbility'
import type { Plugin } from '../types'

export const SKULL_PROPHET_MILL = 'selfMill.skullProphet'
export const MILLIKIN_MANA = 'selfMill.millikin'

const libraryHas = (count: number): AbilityCheck => ({ state, event }) => {
  if (state.zoneCounts[event.seat].library < count) {
    return `${event.seat} cannot mill ${count} card(s)`
  }
}

const enqueueMill = (
  ids: string[],
  enqueue: (event: { type: 'move'; objectId: string; to: 'graveyard' }) => void,
) => {
  for (const objectId of ids) enqueue({ type: 'move', objectId, to: 'graveyard' })
}

/** Exact activated self-mill abilities used by Homer's early mana creatures. */
export const selfMill: Plugin = {
  id: 'selfMill',
  legal: (ctx) => {
    const skullError = whenAbility(
      SKULL_PROPHET_MILL,
      sourceNamed('Skull Prophet'),
      sourceOnBattlefield(),
      controlledByActivator(),
      sourceCanTap(),
      libraryHas(2),
    )?.(ctx)
    if (skullError) return skullError
    return whenAbility(
      MILLIKIN_MANA,
      sourceNamed('Millikin'),
      sourceOnBattlefield(),
      controlledByActivator(),
      sourceCanTap(),
      libraryHas(1),
      asManaAbility(),
    )?.(ctx)
  },
  apply: (ctx) => {
    applyAbility(SKULL_PROPHET_MILL, ({ event, draft }) => {
      draft.enqueue({ type: 'tap', objectId: event.objectId })
      enqueueMill(
        draft.zoneOrder[event.seat].library.slice(0, 2),
        draft.enqueue,
      )
      draft.note(`${event.seat} mills two cards with Skull Prophet`)
    })?.(ctx)

    applyAbility(MILLIKIN_MANA, ({ event, draft }) => {
      draft.enqueue({ type: 'tap', objectId: event.objectId })
      enqueueMill(
        draft.zoneOrder[event.seat].library.slice(0, 1),
        draft.enqueue,
      )
      draft.enqueue({ type: 'addMana', seat: event.seat, mana: { C: 1 } })
      draft.note(`${event.seat} mills a card for Millikin mana`)
    })?.(ctx)
  },
}
