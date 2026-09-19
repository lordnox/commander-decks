import type { GameObject, GameState, Plugin } from '../types'
import { isSwamp } from '../plugins/swampOverlay'
import { effectsOf } from './cardRules'
import type { CardEffect } from './effects'

export type AlternateCastEffect = Extract<CardEffect, { op: 'alternateCast' }>

export const alternateCastEffects = (object: GameObject) =>
  effectsOf(object).filter(
    (effect): effect is AlternateCastEffect => effect.op === 'alternateCast',
  )

export const alternateCastEffect = (object: GameObject, id?: string) =>
  id ? alternateCastEffects(object).find((effect) => effect.id === id) : undefined

export const canChooseAlternateCast = (
  state: GameState,
  seat: string,
  effect: AlternateCastEffect,
) => {
  if ((effect.life ?? 0) > state.players[seat].life) return false
  if (
    effect.controlledSubtype
    && !Object.values(state.objects).some((object) =>
      object.zone === 'battlefield'
      && object.controller === seat
      && (
        effect.controlledSubtype === 'Swamp'
          ? isSwamp(object, state)
          : object.subtypes.includes(effect.controlledSubtype!)
      ))
  ) {
    return false
  }
  return true
}

export const alternateCosts: Plugin = {
  id: 'alternateCosts',
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const object = state.objects[event.objectId]
    if (!object) return
    const alternatives = alternateCastEffects(object)
    if (!event.castOption) return
    const selected = alternateCastEffect(object, event.castOption)
    if (!selected) return `${object.name} has no casting option ${event.castOption}`
    if (!canChooseAlternateCast(state, event.seat, selected)) {
      return `${event.castOption} cannot be paid for ${object.name}`
    }
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'castSpell' || !event.castOption) return
    const object = draft.object(event.objectId)
    const selected = object ? alternateCastEffect(object, event.castOption) : undefined
    if (!selected?.life) return
    draft.enqueue({
      type: 'payLife',
      seat: event.seat,
      amount: selected.life,
      source: object!.id,
    })
  },
}
