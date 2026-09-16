import type Draft from '../draft'
import type { PlayerId, Plugin } from '../types'
import { abilityTokens } from '../keywords'
import { extraTriggerCount } from './effects'
import { enteringObjectId } from './entersTapped'
import {
  chosenTargets,
  illegalTargets,
  pendingPlayerTargets,
  playerTargetsFor,
  queuePlayerTargets,
  takePlayerTargets,
} from './playerTargets'

export const HOMER_CHOSEN = 'homer.chosen'
export const HOMER_RESOLVE = 'homer.resolve'
export const HOMER_NAME = 'Homer, the Hermit'
export const HOMER_STACK_NAME = `${HOMER_NAME} — Landfall`

const SEA_CREATURE_TYPES = new Set([
  'Crab',
  'Lobster',
  'Nautilus',
  'Starfish',
  'Trilobite',
])

const queueTrigger = (draft: Draft, sourceId: string, controller: PlayerId) => {
  queuePlayerTargets(draft, {
    sourceId,
    controller,
    source: HOMER_NAME,
    prompt: 'Choose any number of target players for Homer’s landfall ability.',
    chosenEvent: HOMER_CHOSEN,
  })
  draft.note(`${HOMER_NAME} triggers`)
}

const isSeafood = (object: {
  types: string[]
  subtypes: string[]
  oracleText: string
  controller: string
}, draft: Draft) => {
  if (object.subtypes.some((subtype) => SEA_CREATURE_TYPES.has(subtype))) return true
  if (abilityTokens(object.oracleText).includes('changeling')) return true
  if (!object.types.includes('Creature')) return false
  return Object.values(draft.objects).some((candidate) =>
    candidate.zone === 'battlefield'
    && candidate.controller === object.controller
    && (candidate.effects ?? []).some((effect) =>
      effect.op === 'static' && effect.allCreatureTypes))
}

const mill = (draft: Draft, seat: PlayerId, count: number) => {
  for (const objectId of draft.zoneOrder[seat].library.slice(0, count)) {
    draft.enqueue({ type: 'move', objectId, to: 'graveyard' })
  }
}

export const homer: Plugin = {
  id: 'homer',
  legal: ({ state, event }) => {
    const pending = pendingPlayerTargets(state)
    if (event.type === 'passPriority' && pending) {
      return `${pending.controller} must choose targets for ${pending.source}`
    }
    if (event.type !== 'custom' || event.name !== HOMER_CHOSEN) return
    if (!event.seat || !pending || event.seat !== pending.controller) {
      return `${HOMER_NAME} has no target choice for that seat`
    }
    const targets = chosenTargets(event.payload)
    if (!targets) return `${HOMER_NAME} targets must be a player list`
    return illegalTargets(state, targets, HOMER_NAME)
  },
  replace: ({ state, event }) => {
    const item = state.stack[0]
    if (event.type !== 'resolveTop' || item?.name !== HOMER_STACK_NAME) return
    return {
      type: 'custom',
      name: HOMER_RESOLVE,
      seat: item.controller,
      payload: {
        sourceId: item.objectId,
        targets: item.targets
          .filter((target) => target.kind === 'player')
          .map((target) => target.player),
      },
    }
  },
  apply: ({ state, event, draft }) => {
    const objectId = enteringObjectId(event, state)
    if (objectId) {
      const land = draft.object(objectId)
      if (land?.zone === 'battlefield' && land.types.includes('Land')) {
        for (const source of draft.zoneOf('battlefield', land.controller)) {
          if (source.name !== HOMER_NAME) continue
          const extras = extraTriggerCount(draft, source.controller, 'landfall', source)
          for (let index = 0; index < 1 + extras; index += 1) {
            queueTrigger(draft, source.id, source.controller)
          }
        }
      }
    }

    if (event.type !== 'custom' || !event.seat) return
    if (event.name === HOMER_CHOSEN) {
      if (playerTargetsFor(state, event.seat).length === 0) return
      const pending = takePlayerTargets(draft, event.seat)
      if (!pending) return
      draft.stack.unshift({
        id: draft.allocId('stack'),
        kind: 'ability',
        objectId: pending.sourceId,
        controller: event.seat,
        name: HOMER_STACK_NAME,
        targets: (chosenTargets(event.payload) ?? []).map((player) => ({
          kind: 'player' as const,
          player,
        })),
      })
      draft.passedInRow = []
      draft.priority = draft.active
      draft.note(`${HOMER_NAME} puts its landfall ability on the stack`)
      return
    }

    if (event.name !== HOMER_RESOLVE || state.stack[0]?.name !== HOMER_STACK_NAME) return
    draft.stack.shift()
    const creatures = draft.zoneOf('battlefield', event.seat).filter((object) =>
      isSeafood(object, draft))
    const count = creatures.length * 2
    for (const target of chosenTargets(event.payload) ?? []) {
      mill(draft, target, count)
    }
    draft.note(
      `${HOMER_NAME} mills ${count} card${count === 1 ? '' : 's'} for each chosen player`,
    )
    draft.passedInRow = []
    draft.priority = draft.active
  },
}
