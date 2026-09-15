import type Draft from '../draft'
import type { GameState, PlayerId, Plugin } from '../types'
import { enteringObjectId } from './entersTapped'

export const HOMER_PENDING = 'homer.pending'
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

export type PendingHomer = {
  sourceId: string
  controller: PlayerId
}

const pendingList = (state: GameState, seat: PlayerId): PendingHomer[] => {
  const value = state.players[seat]?.data[HOMER_PENDING]
  if (!Array.isArray(value)) return []
  return value.filter((pending): pending is PendingHomer =>
    pending
    && typeof pending === 'object'
    && typeof pending.sourceId === 'string'
    && typeof pending.controller === 'string')
}

export const pendingHomer = (state: GameState) => {
  for (const seat of state.playerOrder) {
    const pending = pendingList(state, seat)[0]
    if (pending) return pending
  }
}

const queueTrigger = (draft: Draft, sourceId: string, controller: PlayerId) => {
  const pending = pendingList(draft, controller)
  draft.players[controller].data[HOMER_PENDING] = [
    ...pending,
    { sourceId, controller },
  ]
  draft.note(`${HOMER_NAME} triggers`)
}

const mill = (draft: Draft, seat: PlayerId, count: number) => {
  for (const objectId of draft.zoneOrder[seat].library.slice(0, count)) {
    draft.enqueue({ type: 'move', objectId, to: 'graveyard' })
  }
}

const chosenTargets = (payload: Record<string, unknown> | undefined) => {
  const targets = payload?.targets
  return Array.isArray(targets) && targets.every((target) => typeof target === 'string')
    ? targets
    : undefined
}

export const homer: Plugin = {
  id: 'homer',
  legal: ({ state, event }) => {
    const pending = pendingHomer(state)
    if (event.type === 'passPriority' && pending) {
      return `${pending.controller} must choose targets for ${HOMER_NAME}`
    }
    if (event.type !== 'custom' || event.name !== HOMER_CHOSEN) return
    if (!event.seat || !pending || event.seat !== pending.controller) {
      return `${HOMER_NAME} has no target choice for that seat`
    }
    const targets = chosenTargets(event.payload)
    if (!targets) return `${HOMER_NAME} targets must be a player list`
    if (new Set(targets).size !== targets.length) {
      return `${HOMER_NAME} cannot target one player twice`
    }
    const invalid = targets.find((target) =>
      !state.players[target] || state.players[target].lost)
    if (invalid) return `${invalid} is not a legal player target`
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
    const objectId = enteringObjectId(event)
    if (objectId) {
      const land = draft.object(objectId)
      if (land?.zone === 'battlefield' && land.types.includes('Land')) {
        for (const source of draft.zoneOf('battlefield', land.controller)) {
          if (source.name === HOMER_NAME) {
            queueTrigger(draft, source.id, source.controller)
          }
        }
      }
    }

    if (event.type !== 'custom' || !event.seat) return
    if (event.name === HOMER_CHOSEN) {
      const pending = pendingList(state, event.seat)
      if (pending.length === 0) return
      const remaining = pending.slice(1)
      if (remaining.length > 0) {
        draft.players[event.seat].data[HOMER_PENDING] = remaining
      } else {
        delete draft.players[event.seat].data[HOMER_PENDING]
      }
      draft.stack.unshift({
        id: draft.allocId('stack'),
        kind: 'ability',
        objectId: pending[0].sourceId,
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
      object.types.includes('Creature')
      && object.subtypes.some((subtype) => SEA_CREATURE_TYPES.has(subtype)))
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
