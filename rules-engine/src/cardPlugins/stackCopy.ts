import { payCost } from '../plugins/spells'
import {
  openPlayerSelection,
  pendingPlayerSelectionFor,
} from '../rules/selectPlayers'
import type { GameObject, GameState, PlayerId, Plugin, StackItem, TargetRef } from '../types'
import { activateEffect } from './effects'
import { effectsOf } from './cardRules'
import { targetedEffectFilter, validTarget, validTargetRef } from './targetedResolve'

export const PENDING_STACK_COPY = 'kernel.pendingStackCopy'
export const STACK_COPY_TRIGGER = 'stackCopy.trigger'
export const KEEP_STACK_TARGETS = 'Copy with current targets'

export type PendingStackCopy = {
  sourceId: string
  source: string
  seat: PlayerId
  stackId: string
  cost: string
  optional: boolean
  chooseOpponentAfterCopy?: boolean
}

const pendingStackCopy = (state: GameState): PendingStackCopy | undefined => {
  for (const seat of state.playerOrder) {
    const pending = state.players[seat].data[PENDING_STACK_COPY]
    if (
      pending
      && typeof pending === 'object'
      && typeof (pending as PendingStackCopy).sourceId === 'string'
      && typeof (pending as PendingStackCopy).stackId === 'string'
    ) {
      return pending as PendingStackCopy
    }
  }
}

export const stackCopyPending = pendingStackCopy

export const openStackCopyChoice = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  pending: PendingStackCopy,
) => {
  draft.players[pending.seat].data[PENDING_STACK_COPY] = pending
  draft.priority = pending.seat
}

const copierSources = (state: GameState, controller: PlayerId) =>
  Object.values(state.objects).filter((object) =>
    object.zone === 'battlefield'
    && object.controller === controller
    && effectsOf(object).some((effect) =>
      effect.op === 'handler' && effect.pluginId === 'stackCopy'))

const legalObjectTarget = (
  state: GameState,
  item: StackItem,
  object: GameObject,
  index: number,
  controller = item.controller,
) => {
  const source = state.objects[item.objectId]
  if (!source) return false
  if (
    object.controller !== controller
    && !object.tapped
    && effectsOf(object).some((effect) =>
      effect.op === 'targetingRequirement'
      && effect.kind === 'hexproof-while-untapped')
  ) {
    return false
  }
  const ability = item.abilityId
    ? activateEffect(effectsOf(source), item.abilityId)
    : undefined
  if (ability?.targets === 'creature') {
    return object.zone === 'battlefield' && object.types.includes('Creature')
  }
  if (ability?.targets === 'land') {
    return object.zone === 'battlefield' && object.types.includes('Land')
  }
  const targeted = effectsOf(source).find((effect) =>
    effect.op === 'targetedResolve' && effect.target === index)
  if (targeted?.op === 'targetedResolve') {
    return validTarget(
      state,
      object,
      targetedEffectFilter(targeted, item.kicked === true),
      controller,
    )
  }
  return object.zone === 'battlefield' || object.zone === 'stack'
}

export const stackCopyTargetCandidates = (
  state: GameState,
  pending: PendingStackCopy,
) => {
  const item = state.stack.find((candidate) => candidate.id === pending.stackId)
  if (!item || item.targets.length !== 1 || item.targets[0]?.kind !== 'object') return []
  return Object.values(state.objects)
    .filter((object) => legalObjectTarget(state, item, object, 0, pending.seat))
}

const targetsError = (
  state: GameState,
  item: StackItem,
  targets: TargetRef[],
  controller: PlayerId,
) => {
  if (targets.length !== item.targets.length) return 'the copy needs the same number of targets'
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]
    if (target.kind === 'player') {
      const original = item.targets[index]
      const source = state.objects[item.objectId]
      const targeted = source && effectsOf(source).find((effect) =>
        effect.op === 'targetedResolve' && effect.target === index)
      const ability = source && item.abilityId
        ? activateEffect(effectsOf(source), item.abilityId)
        : undefined
      if (
        targeted?.op === 'targetedResolve'
        && !validTargetRef(state, target, targeted.filter, controller)
      ) {
        return 'the copy has an illegal player target'
      }
      if (
        targeted?.op !== 'targetedResolve'
        && original?.kind !== 'player'
        && ability?.targets !== 'any'
      ) {
        return 'the copy has an illegal player target'
      }
      if (!state.players[target.player] || state.players[target.player].lost) {
        return 'the copy has an illegal player target'
      }
      continue
    }
    const object = state.objects[target.objectId]
    if (!object || !legalObjectTarget(state, item, object, index, controller)) {
      return 'the copy has an illegal object target'
    }
  }
}

export const stackCopy: Plugin = {
  id: 'stackCopy',
  legal: ({ state, event }) => {
    const pending = pendingStackCopy(state)
    if (event.type === 'passPriority' && pending) {
      return `${pending.seat} is deciding whether to copy ${pending.source}`
    }
    if (event.type !== 'copyStackItem') return
    if (!pending) return 'no stack-copy choice is open'
    if (
      pending.seat !== event.seat
      || pending.sourceId !== event.sourceId
      || pending.stackId !== event.stackId
    ) {
      return 'that stack-copy choice is not open'
    }
    const item = state.stack.find((candidate) => candidate.id === pending.stackId)
    if (!item) return 'the stack item to copy no longer exists'
    if (!event.accept) {
      if (!pending.optional) return 'this stack copy is not optional'
      if (event.targets?.length) return 'a declined copy cannot choose targets'
      return
    }
    if (!payCost(state.players[event.seat].mana, pending.cost)) {
      return `not enough mana to pay ${pending.cost}`
    }
    return targetsError(state, item, event.targets ?? item.targets, event.seat)
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'activateAbility' && !event.manaAbility) {
      const activated = draft.stack[0]
      if (!activated || activated.kind !== 'ability' || activated.abilityId !== event.abilityId) return
      for (const source of copierSources(state, event.seat)) {
        draft.addToStack({
          kind: 'ability',
          objectId: source.id,
          controller: source.controller,
          name: source.name,
          targets: [],
          abilityId: STACK_COPY_TRIGGER,
          payload: { copiedStackId: activated.id },
        })
      }
      return
    }

    if (event.type === 'resolveTop') {
      const trigger = state.stack[0]
      if (trigger?.abilityId !== STACK_COPY_TRIGGER) return
      const stackId = typeof trigger.payload?.copiedStackId === 'string'
        ? trigger.payload.copiedStackId
        : undefined
      const source = state.objects[trigger.objectId]
      if (!stackId || !source || !draft.stack.some((item) => item.id === stackId)) return
      openStackCopyChoice(draft, {
        sourceId: source.id,
        source: source.name,
        seat: trigger.controller,
        stackId,
        cost: '{2}',
        optional: true,
      })
      return
    }

    if (event.type === 'selectPlayers') {
      const selection = pendingPlayerSelectionFor(state, event.seat)
      const opponent = event.players[0]
      if (selection?.action.kind !== 'copyStackItem' || !opponent) return
      openStackCopyChoice(draft, {
        sourceId: selection.sourceId,
        source: selection.source,
        seat: opponent,
        stackId: selection.action.stackId,
        cost: '{0}',
        optional: false,
      })
      return
    }

    if (event.type !== 'copyStackItem') return
    const pending = pendingStackCopy(state)
    if (!pending) return
    delete draft.players[pending.seat].data[PENDING_STACK_COPY]
    if (!event.accept) return
    const item = draft.stack.find((candidate) => candidate.id === pending.stackId)
    if (!item) return
    draft.enqueue({ type: 'payMana', seat: event.seat, cost: pending.cost })
    draft.stack.unshift({
      ...structuredClone(item),
      id: draft.allocId('s'),
      controller: event.seat,
      targets: structuredClone(event.targets ?? item.targets),
      copy: true,
    })
    draft.passedInRow = []
    draft.priority = event.seat
    draft.note(`${pending.source} copies ${item.name}`)
    if (pending.chooseOpponentAfterCopy) {
      const candidates = draft.playerOrder.filter(
        (seat) => seat !== event.seat && !draft.players[seat].lost,
      )
      if (candidates.length > 0) {
        openPlayerSelection(draft, {
          seat: event.seat,
          sourceId: pending.sourceId,
          source: pending.source,
          prompt: `Choose an opponent to copy ${item.name}.`,
          min: 1,
          max: 1,
          candidates,
          action: { kind: 'copyStackItem', stackId: pending.stackId },
        })
      }
    }
  },
}
