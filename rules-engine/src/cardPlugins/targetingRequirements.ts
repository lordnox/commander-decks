import type { GameObject, GameState, Plugin, TargetRef } from '../types'
import { activateEffect } from './effects'
import { effectsOf } from './cardRules'
import { targetedEffectFilter, validTarget } from './targetedResolve'

const requirement = (
  object: GameObject,
  kind: 'flagbearer' | 'hexproof-while-untapped',
) => effectsOf(object).some((effect) =>
  effect.op === 'targetingRequirement' && effect.kind === kind)

const eventSource = (
  state: GameState,
  event: Extract<
    Parameters<NonNullable<Plugin['legal']>>[0]['event'],
    { type: 'castSpell' | 'activateAbility' }
  >,
) => state.objects[event.objectId]

const canFillObjectTarget = (
  state: GameState,
  source: GameObject,
  event: Extract<
    Parameters<NonNullable<Plugin['legal']>>[0]['event'],
    { type: 'castSpell' | 'activateAbility' }
  >,
  candidate: GameObject,
  index: number,
) => {
  if (event.type === 'castSpell') {
    const effect = effectsOf(source).find((entry) =>
      entry.op === 'targetedResolve' && entry.target === index)
    return effect?.op === 'targetedResolve'
      ? validTarget(
          state,
          candidate,
          targetedEffectFilter(effect, (event.timesKicked ?? (event.kicked ? 1 : 0)) > 0),
          event.seat,
        )
      : false
  }
  const effect = activateEffect(effectsOf(source), event.abilityId)
  if (effect?.targets === 'creature') {
    return candidate.zone === 'battlefield' && candidate.types.includes('Creature')
  }
  if (effect?.targets === 'land') {
    return candidate.zone === 'battlefield' && candidate.types.includes('Land')
  }
  if (effect?.targets === 'any') return candidate.zone === 'battlefield'
  return false
}

const targetedObjectIds = (targets: TargetRef[] | undefined) =>
  new Set((targets ?? []).flatMap((target) =>
    target.kind === 'object' ? [target.objectId] : []))

export const targetingRequirements: Plugin = {
  id: 'targetingRequirements',
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell' && event.type !== 'activateAbility') return
    const source = eventSource(state, event)
    if (!source) return
    const targets = event.targets ?? []
    const objectIds = targetedObjectIds(targets)

    for (const objectId of objectIds) {
      const target = state.objects[objectId]
      if (
        target
        && target.controller !== event.seat
        && !target.tapped
        && requirement(target, 'hexproof-while-untapped')
      ) {
        return `${target.name} has hexproof while untapped`
      }
    }

    const allFlagbearers = Object.values(state.objects).filter((object) =>
      object.zone === 'battlefield'
      && requirement(object, 'flagbearer'))
    const imposed = allFlagbearers.some((object) => object.controller !== event.seat)
    if (!imposed || allFlagbearers.some((object) => objectIds.has(object.id))) return

    const able = allFlagbearers.some((flagbearer) =>
      targets.some((_target, index) =>
        canFillObjectTarget(state, source, event, flagbearer, index)))
    if (able) return 'an opponent choosing targets must target a Flagbearer if able'
  },
}
