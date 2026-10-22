import type { GameState } from '../../types'
import { captureObject } from '../../objectIdentity'
import { evaluateObjectSelector } from './compiler/runtime'
import { activePrintedStaticModifiers } from './staticModifierCore'

/** Additional participants in the same turn-based untap action, not triggered abilities. */
export const otherPlayerUntapParticipants = (state: GameState) => {
  const ids = new Set<string>()
  for (const source of Object.values(state.objects)) {
    for (const entry of activePrintedStaticModifiers(state, source)) {
      if (!('effect' in entry) || entry.effect.kind !== 'untapDuringOthers') continue
      const context = { state, source: captureObject(source), controller: source.controller }
      for (const object of evaluateObjectSelector(entry.effect.targets, context)) {
        if (object.zone === 'battlefield' && object.controller !== state.active) ids.add(object.id)
      }
    }
  }
  return [...ids].map(id => state.objects[id])
}
