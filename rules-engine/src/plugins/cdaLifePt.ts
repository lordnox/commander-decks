import type { CardEffect } from '../cardPlugins/effectDefinitions'
import {
  countControlledPermanents,
  refreshCdaCountPt,
  refreshCdaLifePt,
} from '../cardPlugins/continuousEffects'
import { enteringObjectId } from '../cardPlugins/entersTapped'
import type { GameObject, GameState, Plugin } from '../types'

const SYNC = 'cdaLifePt.sync'

const ptEqualsLifeSpec = (object: GameObject) => {
  for (const effect of object.effects ?? []) {
    if (effect.op === 'static' && effect.ptEqualsLife) return effect.ptEqualsLife
  }
}

const ptEqualsCountSpec = (object: GameObject) => {
  for (const effect of object.effects ?? []) {
    if (effect.op === 'static' && effect.ptEqualsCount) return effect.ptEqualsCount
  }
}

export const ptEqualsLifeEffects = (effects: CardEffect[] | undefined) =>
  (effects ?? []).flatMap((effect) =>
    effect.op === 'static' && effect.ptEqualsLife ? [effect.ptEqualsLife] : [])

export const ptEqualsCountEffects = (effects: CardEffect[] | undefined) =>
  (effects ?? []).flatMap((effect) =>
    effect.op === 'static' && effect.ptEqualsCount ? [effect.ptEqualsCount] : [])

const refreshAll = (draft: GameState) => {
  for (const object of Object.values(draft.objects)) {
    const life = ptEqualsLifeSpec(object)
    if (life) refreshCdaLifePt(draft, object, life.who)
    const count = ptEqualsCountSpec(object)
    if (count) refreshCdaCountPt(draft, object, count.types)
  }
}

const lifeChanged = (event: Parameters<NonNullable<Plugin['apply']>>[0]['event']) =>
  event.type === 'gainLife'
  || event.type === 'loseLife'
  || event.type === 'setLifeTotal'
  || event.type === 'exchangeLifeTotals'

const shouldRefresh = (event: Parameters<NonNullable<Plugin['apply']>>[0]['event'], state: GameState) =>
  lifeChanged(event)
  || event.type === 'move'
  || Boolean(enteringObjectId(event, state))
  || (event.type === 'custom' && event.name === SYNC)

const cdaEntry = (object: GameObject) =>
  object.continuousEffects?.find(({ effect, duration }) =>
    effect.kind === 'cdaLifePt' && duration.kind === 'cdaLifePt')

const needsSync = (state: GameState) =>
  Object.values(state.objects).some((object) => {
    const life = ptEqualsLifeSpec(object)
    const count = ptEqualsCountSpec(object)
    if (!life && !count) return false
    const entry = cdaEntry(object)
    if (!entry || entry.effect.kind !== 'cdaLifePt') return true
    if (life) {
      const total = state.players[
        life.who === 'controller' ? object.controller : object.owner
      ]?.life
      if (total !== entry.effect.after.power || life.who !== entry.effect.who) return true
    }
    if (count) {
      const value = countControlledPermanents(state, object.controller, count.types)
      if (value !== entry.effect.after.power) return true
    }
    return false
  })

export const cdaLifePt: Plugin = {
  id: 'cdaLifePt',
  apply: ({ state, event, draft }) => {
    if (!shouldRefresh(event, state)) return
    refreshAll(draft)
  },
  sba: ({ state }) =>
    needsSync(state) ? [{ type: 'custom', name: SYNC }] : [],
}
