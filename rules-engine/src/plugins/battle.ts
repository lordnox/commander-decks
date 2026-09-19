import type Draft from '../draft'
import { openPlayerSelection } from '../rules/selectPlayers'
import type { GameObject, Plugin, StackItem } from '../types'
import { applyFace } from './doubleFaced'

export const BATTLE_DEFEATED_ABILITY = 'battle-defeated'
export const CAST_TRANSFORMED_ACTION = 'cast-battle-transformed'

const isSiege = (object: GameObject) =>
  object.types.includes('Battle') && object.subtypes.includes('Siege')

export const battleProtectorCandidates = (draft: Draft, object: GameObject) =>
  isSiege(object)
    ? draft.playerOrder.filter(
        (seat) => seat !== object.controller && !draft.players[seat].lost,
      )
    : [object.controller].filter((seat) => !draft.players[seat].lost)

export const validBattleProtector = (draft: Draft, object: GameObject) =>
  object.protector !== undefined
  && battleProtectorCandidates(draft, object).includes(object.protector)

const chooseProtector = (draft: Draft, object: GameObject) => {
  const candidates = battleProtectorCandidates(draft, object)
  if (candidates.length === 1) {
    object.protector = candidates[0]
    return
  }
  if (candidates.length === 0) {
    draft.enqueue({ type: 'move', objectId: object.id, to: 'graveyard' })
    return
  }

  openPlayerSelection(draft, {
    seat: object.controller,
    sourceId: object.id,
    source: object.name,
    prompt: `Choose an opponent to protect ${object.name}.`,
    min: 1,
    max: 1,
    candidates,
    action: { kind: 'designateBattleProtector' },
  })
}

const enterBattle = (draft: Draft, object: GameObject) => {
  if (!object.types.includes('Battle')) return
  object.counters.defense = Math.max(0, object.printedDefense ?? 0)
  chooseProtector(draft, object)
}

const defeatedItem = (item: StackItem | undefined): item is StackItem =>
  item?.kind === 'ability' && item.abilityId === BATTLE_DEFEATED_ABILITY

const transformedAction = (item: StackItem | undefined): item is StackItem =>
  item?.kind === 'action' && item.actionId === CAST_TRANSFORMED_ACTION

export const battle: Plugin = {
  id: 'battle',
  legal: ({ state, event }) => {
    if (event.type === 'chooseBattleProtector') {
      const object = state.objects[event.objectId]
      if (!object || object.zone !== 'battlefield' || !object.types.includes('Battle')) {
        return 'protector can only be chosen for a battlefield battle'
      }
    }

    if (event.type === 'removeDefenseCounters') {
      const object = state.objects[event.objectId]
      if (!object || object.zone !== 'battlefield' || !object.types.includes('Battle')) {
        return 'defense counters can only be removed from a battlefield battle'
      }
      if (!Number.isSafeInteger(event.amount) || event.amount < 0) {
        return 'defense counter amount must be a nonnegative integer'
      }
    }

    if (event.type === 'continueAction') {
      const item = state.stack.find((candidate) => candidate.id === event.stackId)
      if (!transformedAction(item)) return
      if (state.stack[0]?.id !== item.id) return 'battle casting choice is not on top'
      if (item.controller !== event.seat) return 'only the battle controller may choose'
      if (typeof event.payload.cast !== 'boolean') return 'battle casting choice requires cast'
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'chooseBattleProtector') {
      const object = draft.object(event.objectId)
      if (object) chooseProtector(draft, object)
      return
    }

    if (event.type === 'move') {
      const before = state.objects[event.objectId]
      const object = draft.object(event.objectId)
      if (before?.zone !== 'battlefield' && object?.zone === 'battlefield') {
        enterBattle(draft, object)
      }
      return
    }

    if (event.type === 'resolveTop') {
      const item = state.stack[0]
      if (item?.kind === 'spell') {
        const object = draft.object(item.objectId)
        if (object?.zone === 'battlefield' && state.objects[item.objectId]?.zone === 'stack') {
          enterBattle(draft, object)
        }
        return
      }
      if (!defeatedItem(item)) return

      const object = draft.object(item.objectId)
      if (!object || object.zone !== 'battlefield' || !isSiege(object)) return
      draft.enqueue({ type: 'move', objectId: object.id, to: 'exile' })
      draft.addToStack({
        kind: 'action',
        objectId: object.id,
        controller: item.controller,
        name: `Cast ${object.name} transformed`,
        targets: [],
        actionId: CAST_TRANSFORMED_ACTION,
        waiting: 'choice',
        payload: { chooser: item.controller },
      })
      draft.passedInRow = []
      draft.priority = item.controller
      return
    }

    if (event.type === 'removeDefenseCounters') {
      const object = draft.object(event.objectId)
      if (!object) return
      const before = object.counters.defense ?? 0
      object.counters.defense = Math.max(0, before - event.amount)
      if (before > 0 && object.counters.defense === 0 && isSiege(object)) {
        draft.addTriggeredAbility(object, [], {
          abilityId: BATTLE_DEFEATED_ABILITY,
          name: `${object.name} defeated`,
        })
        draft.passedInRow = []
        draft.priority = draft.active
      }
      return
    }

    if (event.type !== 'continueAction') return
    const item = draft.stack.find((candidate) => candidate.id === event.stackId)
    if (!transformedAction(item)) return
    draft.stack = draft.stack.filter((candidate) => candidate.id !== item.id)

    const object = draft.object(item.objectId)
    if (
      event.payload.cast !== true
      || !object
      || object.zone !== 'exile'
      || !object.backFace
    ) {
      draft.passedInRow = []
      draft.priority = draft.active
      return
    }

    applyFace(object, object.backFace)
    draft.move(object.id, 'stack')
    draft.addToStack({
      kind: 'spell',
      objectId: object.id,
      controller: item.controller,
      name: object.name,
      targets: [],
      castFrom: 'exile',
      castOption: 'transformed-without-paying',
    })
    draft.passedInRow = []
    draft.priority = draft.active
  },
}
