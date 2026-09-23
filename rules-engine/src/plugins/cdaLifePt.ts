import type { CardEffect } from '../cardPlugins/effectDefinitions'
import { refreshCdaLifePt } from '../cardPlugins/continuousEffects'
import { enteringObjectId } from '../cardPlugins/entersTapped'
import type { GameObject, GameState, Plugin } from '../types'

const SYNC = 'cdaLifePt.sync'

const ptEqualsLifeSpec = (object: GameObject) => {
  for (const effect of object.effects ?? []) {
    if (effect.op === 'static' && effect.ptEqualsLife) return effect.ptEqualsLife
  }
}

export const ptEqualsLifeEffects = (effects: CardEffect[] | undefined) =>
  (effects ?? []).flatMap((effect) =>
    effect.op === 'static' && effect.ptEqualsLife ? [effect.ptEqualsLife] : [])

const refreshAll = (draft: GameState) => {
  for (const object of Object.values(draft.objects)) {
    const spec = ptEqualsLifeSpec(object)
    if (spec) refreshCdaLifePt(draft, object, spec.who)
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

const needsSync = (state: GameState) =>
  Object.values(state.objects).some((object) => {
    const spec = ptEqualsLifeSpec(object)
    if (!spec) return false
    const entry = object.continuousEffects?.find(({ effect, duration }) =>
      effect.kind === 'cdaLifePt' && duration.kind === 'cdaLifePt')
    if (!entry || entry.effect.kind !== 'cdaLifePt') return true
    const life = state.players[
      spec.who === 'controller' ? object.controller : object.owner
    ]?.life
    return life !== entry.effect.after.power || spec.who !== entry.effect.who
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
