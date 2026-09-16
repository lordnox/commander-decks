import type { GameObject, Plugin, TargetRef } from '../types'
import { activateEffect, runInstructions } from './effects'
import { effectsOf } from './cardRules'

const MAIN_PHASES = new Set(['precombatMain', 'postcombatMain'])

const loyaltyEffect = (source: GameObject | undefined, abilityId: string) => {
  if (!source) return
  const effect = activateEffect(effectsOf(source), abilityId)
  return effect?.costs.loyalty !== undefined || effect?.costs.loyaltyX
    ? effect
    : undefined
}

const legalAnyTarget = (
  state: Parameters<NonNullable<Plugin['legal']>>[0]['state'],
  target: TargetRef,
) => {
  if (target.kind === 'player') {
    return Boolean(state.players[target.player] && !state.players[target.player].lost)
  }
  const object = state.objects[target.objectId]
  return Boolean(
    object
    && object.zone === 'battlefield'
    && (
      object.types.includes('Creature')
      || object.types.includes('Planeswalker')
      || object.types.includes('Battle')
    ),
  )
}

const loyaltyChange = (
  effect: NonNullable<ReturnType<typeof loyaltyEffect>>,
  x: number | undefined,
) => effect.costs.loyaltyX ? -(x ?? 0) : effect.costs.loyalty ?? 0

export const planeswalker: Plugin = {
  id: 'planeswalker',
  legal: ({ state, event }) => {
    if (event.type !== 'activateAbility') return
    const source = state.objects[event.objectId]
    const effect = loyaltyEffect(source, event.abilityId)
    if (!effect || !source) return
    if (source.zone !== 'battlefield') return `${source.name} is not on the battlefield`
    if (source.controller !== event.seat) return `${event.seat} does not control ${source.name}`
    if (
      state.active !== event.seat
      || !MAIN_PHASES.has(state.step)
      || state.stack.length > 0
    ) {
      return 'loyalty abilities can be activated only as a sorcery'
    }
    if (source.loyaltyActivatedTurn === state.turn) {
      return `${source.name} already activated a loyalty ability this turn`
    }
    if (
      effect.costs.loyaltyX
      && (!Number.isSafeInteger(event.x) || (event.x ?? -1) < 0)
    ) {
      return 'choose a nonnegative integer for X'
    }
    const change = loyaltyChange(effect, event.x)
    if (change < 0 && (source.counters.loyalty ?? 0) < -change) {
      return `${source.name} does not have enough loyalty`
    }
    const targets = event.targets ?? []
    if (effect.targets === 'any') {
      if (targets.length !== 1 || !legalAnyTarget(state, targets[0])) {
        return `${source.name} needs one legal target`
      }
    } else if (targets.length > 0) {
      return `${source.name} does not have a targeted ability`
    }
    if ((event.choices?.length ?? 0) > 0) {
      return `${source.name} does not choose cards while activating this ability`
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'move') {
      const before = state.objects[event.objectId]
      const object = draft.object(event.objectId)
      if (!before || !object || !object.types.includes('Planeswalker')) return
      if (before.zone !== 'battlefield' && event.to === 'battlefield') {
        if (object.printedLoyalty !== null) object.counters.loyalty = object.printedLoyalty
      }
      if (before.zone === 'battlefield' && event.to !== 'battlefield') {
        delete object.counters.loyalty
        object.loyaltyActivatedTurn = null
      }
      return
    }
    if (event.type === 'activateAbility') {
      const source = draft.object(event.objectId)
      const effect = loyaltyEffect(source, event.abilityId)
      if (!source || !effect) return
      source.counters.loyalty = (source.counters.loyalty ?? 0)
        + loyaltyChange(effect, event.x)
      source.loyaltyActivatedTurn = state.turn
      draft.stack.unshift({
        id: draft.allocId('s'),
        kind: 'ability',
        objectId: source.id,
        controller: event.seat,
        name: `${source.name} — ${event.abilityId}`,
        targets: event.targets ?? [],
        abilityId: event.abilityId,
        ...(event.x !== undefined ? { x: event.x } : {}),
      })
      draft.passedInRow = []
      draft.priority = event.seat
      draft.note(`${event.seat} activates ${source.name}`)
      return
    }
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (item?.kind !== 'ability' || !item.abilityId) return
    const source = draft.object(item.objectId)
    const effect = loyaltyEffect(source, item.abilityId)
    if (source && effect) runInstructions(draft, source, effect.do, item)
  },
}
