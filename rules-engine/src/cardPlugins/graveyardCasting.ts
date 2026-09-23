import { payCost } from '../plugins/spells'
import type { AvailableAction, GameObject, GameState, PlayerId, Plugin, StackItem } from '../types'
import {
  activationCostError,
  canPayActivationCosts,
  payActivationCosts,
} from './activationCosts'
import { effectsOf } from './cardRules'
import type { CardEffect } from './effectDefinitions'
import {
  copyTokenTemplate,
  createToken,
} from './effectRuntime'

export const EMBALM_ABILITY_ID = 'embalm'

const MAIN_STEPS = new Set(['precombatMain', 'postcombatMain'])

export type EmbalmEffect = Extract<CardEffect, { op: 'embalm' }>

export const embalmEffect = (effects: CardEffect[]) =>
  effects.find((effect): effect is EmbalmEffect => effect.op === 'embalm')

export const embalmEffectOf = (object: GameObject) =>
  embalmEffect(effectsOf(object))

const embalmSorceryLegal = (state: GameState, seat: PlayerId) =>
  state.active === seat
  && MAIN_STEPS.has(state.step)
  && state.stack.length === 0

const canEmbalm = (state: GameState, source: GameObject, seat: PlayerId) => {
  const effect = embalmEffectOf(source)
  if (!effect) return false
  if (source.zone !== 'graveyard' || source.controller !== seat) return false
  if (!embalmSorceryLegal(state, seat)) return false
  return canPayActivationCosts(state, source, seat, { mana: effect.manaCost })
}

export const embalmActions = (
  state: GameState,
  object: GameObject,
  seat: PlayerId,
): AvailableAction[] => {
  if (!canEmbalm(state, object, seat)) return []
  const effect = embalmEffectOf(object)!
  return [{
    kind: 'activateAbility',
    objectId: object.id,
    name: object.name,
    text: `Embalm ${effect.manaCost}`,
    abilityId: EMBALM_ABILITY_ID,
  }]
}

export const embalmTokenTemplate = (source: GameObject, effect: EmbalmEffect) =>
  copyTokenTemplate(source, {
    colors: effect.colors,
    extraSubtypes: effect.extraSubtypes,
    noManaCost: true,
  })

export const resolveEmbalmAbility = (draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'], item: StackItem) => {
  const source = draft.object(item.objectId)
  if (!source) return
  const effect = embalmEffectOf(source)
  if (!effect) return
  createToken(draft, item.controller, embalmTokenTemplate(source, effect))
}

export const graveyardCasting: Plugin = {
  id: 'graveyardCasting',
  legal: ({ state, event }) => {
    if (event.type !== 'activateAbility' || event.abilityId !== EMBALM_ABILITY_ID) return
    const source = state.objects[event.objectId]
    if (!source) return 'no such object'
    const effect = embalmEffectOf(source)
    if (!effect) return `${source.name} has no embalm ability`
    if (source.zone !== 'graveyard') {
      return `${source.name} must be in your graveyard to embalm`
    }
    if (source.controller !== event.seat) {
      return `${event.seat} does not control ${source.name}`
    }
    if (!embalmSorceryLegal(state, event.seat)) {
      return `${source.name} can be embalmed only as a sorcery`
    }
    const canPayMana = (cost: string) => Boolean(payCost(state.players[event.seat]?.mana, cost))
    const costError = activationCostError(state, source, event.seat, { mana: effect.manaCost }, {
      canPayMana,
    })
    if (costError) return costError
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'activateAbility' || event.abilityId !== EMBALM_ABILITY_ID) return
    const source = draft.object(event.objectId)
    if (!source) return
    const effect = embalmEffectOf(source)
    if (!effect) return
    payActivationCosts(draft, source, event.seat, { mana: effect.manaCost })
    draft.enqueue({ type: 'move', objectId: source.id, to: 'exile' })
    draft.addToStack({
      kind: 'ability',
      objectId: source.id,
      controller: event.seat,
      name: source.name,
      targets: [],
      abilityId: EMBALM_ABILITY_ID,
    })
    draft.passedInRow = []
    draft.priority = event.seat
    draft.note(`${event.seat} embalms ${source.name}`)
  },
}
