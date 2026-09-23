import { isPermanentType } from '../definitions'
import type { GameObject, GameState, Plugin, StackItem, ZoneId } from '../types'
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

const retraceEffect = (object: GameObject): AlternateCastEffect => ({
  op: 'alternateCast',
  id: 'retrace',
  label: 'Retrace—Discard a land card.',
  manaCost: object.manaCost,
  fromZone: 'graveyard',
  discard: 'land',
})

export const availableAlternateCastEffects = (
  state: GameState,
  seat: string,
  object: GameObject,
) => {
  const effects = [...alternateCastEffects(object)]
  for (const source of Object.values(state.objects)) {
    if (source.zone !== 'battlefield' || source.controller !== seat) continue
    for (const effect of effectsOf(source)) {
      const grant = effect.op === 'static' ? effect.grantRetrace : undefined
      if (!grant) continue
      if (grant.duringYourTurn && state.active !== seat) continue
      if (grant.other && source.id === object.id) continue
      if (grant.nonlandPermanent && (
        object.types.includes('Land')
        || !isPermanentType(object.types)
      )) continue
      effects.push(retraceEffect(object))
    }
  }
  return effects.filter(
    (effect, index) => effects.findIndex((candidate) => candidate.id === effect.id) === index,
  )
}

export const availableAlternateCastEffect = (
  state: GameState,
  seat: string,
  object: GameObject,
  id?: string,
) => id
  ? availableAlternateCastEffects(state, seat, object).find((effect) => effect.id === id)
  : undefined

const costCandidates = (
  state: GameState,
  seat: string,
  effect: AlternateCastEffect,
) => {
  const controlled = Object.values(state.objects).filter((object) => object.controller === seat)
  const discard = effect.discard === 'land'
    ? controlled.filter((object) => object.zone === 'hand' && object.types.includes('Land'))
    : []
  const sacrifice = effect.sacrifice
    ? controlled.filter((object) =>
        object.zone === 'battlefield' && object.types.includes(effect.sacrifice!.type))
    : []
  return { discard, sacrifice }
}

export const printedAlternateManaCost = (
  effect: AlternateCastEffect,
  object: GameObject,
) => effect.manaCost === '__printed__' ? object.manaCost : effect.manaCost

export const canChooseAlternateCast = (
  state: GameState,
  seat: string,
  effect: AlternateCastEffect,
  object?: GameObject,
) => {
  if (effect.afterWarp) {
    if (object?.zone !== 'exile') return false
    if (object.warpExiledTurn === undefined) return false
    if (state.turn <= object.warpExiledTurn) return false
  }
  if (effect.fromZone && object?.zone !== effect.fromZone) return false
  if ((effect.life ?? 0) > state.players[seat].life) return false
  if (
    effect.controlledSubtype
    && !Object.values(state.objects).some((candidate) =>
      candidate.zone === 'battlefield'
      && candidate.controller === seat
      && (
        effect.controlledSubtype === 'Swamp'
          ? isSwamp(candidate, state)
          : candidate.subtypes.includes(effect.controlledSubtype!)
      ))
  ) {
    return false
  }
  const candidates = costCandidates(state, seat, effect)
  if (effect.discard && candidates.discard.length < 1) return false
  if (effect.sacrifice && candidates.sacrifice.length < effect.sacrifice.count) return false
  return true
}

export const finishedSpellZone = (
  item: StackItem | undefined,
  otherwise: ZoneId,
): ZoneId => item?.exileAfterUse ? 'exile' : otherwise

export const alternateCosts: Plugin = {
  id: 'alternateCosts',
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const object = state.objects[event.objectId]
    if (!object) return
    if (!event.castOption) return
    const selected = availableAlternateCastEffect(state, event.seat, object, event.castOption)
    if (!selected) return `${object.name} has no casting option ${event.castOption}`
    if (!canChooseAlternateCast(state, event.seat, selected, object)) {
      return `${event.castOption} cannot be paid for ${object.name}`
    }
    const discard = event.discard ?? []
    if (selected.discard && (
      discard.length !== 1
      || !costCandidates(state, event.seat, selected).discard.some(
        (candidate) => candidate.id === discard[0],
      )
    )) return `${event.castOption} requires discarding a land card`
    const sacrifice = event.sacrifice ?? []
    if (selected.sacrifice && (
      sacrifice.length !== selected.sacrifice.count
      || new Set(sacrifice).size !== sacrifice.length
      || sacrifice.some((objectId) =>
        !costCandidates(state, event.seat, selected).sacrifice.some(
          (candidate) => candidate.id === objectId,
        ))
    )) {
      return `${event.castOption} requires sacrificing ${selected.sacrifice.count} ${selected.sacrifice.type.toLowerCase()}(s)`
    }
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'castSpell' || !event.castOption) return
    const object = draft.object(event.objectId)
    const selected = object
      ? availableAlternateCastEffect(draft, event.seat, object, event.castOption)
      : undefined
    if (!selected) return
    if (selected.life) {
      draft.enqueue({
        type: 'payLife',
        seat: event.seat,
        amount: selected.life,
        source: object!.id,
      })
    }
    for (const objectId of event.discard ?? []) {
      draft.enqueue({ type: 'discard', seat: event.seat, objectId })
    }
  },
}
