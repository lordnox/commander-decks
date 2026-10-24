import type { Draft } from '../../draft'
import type { GameObject, GameState } from '../../types'
import { captureObject } from '../../objectIdentity'
import { evaluateObjectSelector } from './compiler/runtime'
import { activePrintedStaticModifiers } from './staticModifierCore'

/** CR 701.19b: a printed static "regenerate" covering this permanent replaces every destruction. */
const staticallyRegenerated = (state: GameState, object: GameObject) =>
  Object.values(state.objects).some(source =>
    source.zone === 'battlefield'
    && activePrintedStaticModifiers(state, source).some(entry =>
      'effect' in entry
      && entry.effect.kind === 'regenerate'
      && evaluateObjectSelector(entry.effect.targets, { state, source: captureObject(source), controller: source.controller })
        .some(candidate => candidate.id === object.id)))

/** A shield or static regeneration would replace this permanent's next destruction (CR 701.19). */
export const regenerationAvailable = (state: GameState, object: GameObject) =>
  object.continuousEffects?.some(entry => entry.effect.kind === 'regenerationShield') === true
  || staticallyRegenerated(state, object)

/**
 * Regenerate instead of destroying: remove marked damage, tap, and remove from combat (CR 701.19a).
 * A static effect is preferred over spending a shield, since its controller would always choose it.
 */
export const regenerate = (draft: Draft, object: GameObject) => {
  if (!staticallyRegenerated(draft, object)) {
    const shield = object.continuousEffects?.findIndex(entry => entry.effect.kind === 'regenerationShield') ?? -1
    if (shield < 0) return false
    object.continuousEffects = object.continuousEffects!.filter((_, index) => index !== shield)
  }
  object.damageMarked = 0
  delete object.deathtouched
  object.attacking = null
  object.blocking = null
  delete object.blocked
  draft.enqueue({ type: 'tap', objectId: object.id })
  draft.note(`${object.name} regenerates`)
  return true
}

/** "Can't be regenerated" stops shields from applying to this destruction (CR 701.19c). */
export const regenerateInsteadOfDestroy = (draft: Draft, object: GameObject, cannotRegenerate?: true) =>
  !cannotRegenerate && regenerate(draft, object)
