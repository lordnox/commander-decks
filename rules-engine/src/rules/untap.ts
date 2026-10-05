import type { Draft } from '../draft'
import type { GameObject } from '../types'

export const STUN_COUNTER = 'stun'

/**
 * Untap one permanent. A tapped permanent with a stun counter loses one counter
 * instead of untapping (CR 122.1g). Returns whether it actually untapped.
 */
export const untapPermanent = (draft: Draft, object: GameObject) => {
  if (!object.tapped) return false
  const stun = object.counters[STUN_COUNTER] ?? 0
  if (stun > 0) {
    if (stun === 1) delete object.counters[STUN_COUNTER]
    else object.counters[STUN_COUNTER] = stun - 1
    draft.note(`${object.name} loses a stun counter instead of untapping`)
    return false
  }
  object.tapped = false
  return true
}

/**
 * Untap step for the permanents the active player controls. A permanent marked
 * `skipNextUntap` ("doesn't untap during its controller's next untap step")
 * stays as it is and loses the marker; everything else untaps through
 * `untapPermanent`.
 */
export const untapStepUntaps = (draft: Draft, object: GameObject) => {
  if (object.skipNextUntap) {
    delete object.skipNextUntap
    return
  }
  untapPermanent(draft, object)
}
