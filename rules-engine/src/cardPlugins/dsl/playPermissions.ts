import type { LandFaceChoice } from '../../plugins/doubleFaced'
import { applyFace, landFacesOf } from '../../plugins/doubleFaced'
import { captureObject } from '../../objectIdentity'
import type { GameObject, GameState, PlayerId } from '../../types'
import { evaluateCondition, evaluateObjectSelector, evaluatePlayerSelector } from './compiler/runtime'
import { activePrintedStaticModifiers, isActiveKeywordStatic } from './staticModifierCore'
import type { ContinuousEffectDefinition } from './schema/v1'

type CastSpellsEffect = Extract<ContinuousEffectDefinition, { kind: 'castSpells' }>

/** Read live sources and zone order; permissions disappear with their source. */
export const canonicalLandPermission = (state: GameState, player: PlayerId, card: GameObject, face?: LandFaceChoice) =>
  Object.values(state.objects).some(source => {
    if (!source.ruleDefinition) return false
    return activePrintedStaticModifiers(state, source).some(entry => {
      if (isActiveKeywordStatic(entry) || entry.effect.kind !== 'playLands') return false
      const permission = entry.effect
      const context = { state, controller: source.controller, source: captureObject(source) }
      if (!evaluatePlayerSelector(permission.players, context).includes(player)) return false
      // CR 712.8: evaluate a land-play permission using the face being played.
      const candidates = landFacesOf(card).filter(candidate => !face || candidate.choice === face)
      const matches = (view: GameObject) => evaluateObjectSelector(permission.cards, {
        ...context, state: { ...state, objects: { ...state.objects, [card.id]: view } },
      }).some(candidate => candidate.id === card.id)
      if (!(candidates.length === 0 && !face && matches(card)) && !candidates.some(({ characteristics }) => {
        const view = structuredClone(card)
        applyFace(view, characteristics)
        return matches(view)
      })) return false
      return !permission.topOnly || (card.zone === 'library' && state.zoneOrder[card.owner]?.library[0] === card.id)
    })
  })

/** Live castSpells selectors authorize announcement from their selected zone. */
export const canonicalSpellPermission = (
  state: GameState,
  player: PlayerId,
  card: GameObject,
): CastSpellsEffect | undefined => {
  for (const source of Object.values(state.objects)) {
    if (!source.ruleDefinition) continue
    for (const entry of activePrintedStaticModifiers(state, source)) {
      if (isActiveKeywordStatic(entry) || entry.effect.kind !== 'castSpells') continue
      const permission = entry.effect
      const context = { state, controller: source.controller, source: captureObject(source) }
      if (permission.when && !evaluateCondition(permission.when, context)) continue
      if (!evaluatePlayerSelector(permission.players, context).includes(player)) continue
      if (!evaluateObjectSelector(permission.cards, context).some(candidate => candidate.id === card.id)) continue
      return permission
    }
  }
}
