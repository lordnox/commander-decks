import type { Plugin } from '../types'
import { conditionHolds, extraTriggerCount, runInstructions, triggerEffects } from './effects'
import { effectsOf } from './cardRules'
import { enteringObjectId } from './entersTapped'

export const zoneTriggers: Plugin = {
  id: 'zoneTriggers',
  apply: ({ state, event, draft }) => {
    const enteredId = enteringObjectId(event, state)
    if (enteredId) {
      const object = draft.object(enteredId)
      if (object?.zone === 'battlefield') {
        for (const effect of triggerEffects(effectsOf(object), 'enters')) {
          if (!conditionHolds(effect.if, state, object)) continue
          const extras = extraTriggerCount(state, object.controller, 'enters', object)
          for (let index = 0; index < 1 + extras; index += 1) {
            runInstructions(draft, object, effect.do)
          }
        }
      }
    }

    if (event.type === 'declareAttackers') {
      for (const declaration of event.attackers) {
        const attacker = draft.object(declaration.objectId)
        if (!attacker) continue
        for (const effect of triggerEffects(effectsOf(attacker), 'attacks')) {
          if (!conditionHolds(effect.if, state, attacker)) continue
          runInstructions(draft, attacker, effect.do)
        }
      }
    }

    if (event.type === 'custom' && event.name === 'advanceStep' && draft.step === 'upkeep') {
      for (const object of draft.zoneOf('battlefield')) {
        for (const effect of triggerEffects(effectsOf(object), 'upkeep')) {
          if (!conditionHolds(effect.if, state, object)) continue
          runInstructions(draft, object, effect.do)
        }
      }
    }

    if (event.type !== 'move') return
    const before = state.objects[event.objectId]
    if (!before) return
    if (event.to === 'graveyard' && before.types.includes('Land')) {
      const fromLibrary = before.zone === 'library'
      for (const source of draft.zoneOf('battlefield', before.owner)) {
        for (const effect of triggerEffects(effectsOf(source), 'landToGraveyard')) {
          if (!conditionHolds(effect.if, state, source)) continue
          if (fromLibrary && effect.do.some((instruction) => instruction.kind === 'putMilledLandTapped')) {
            draft.enqueue({ type: 'move', objectId: before.id, to: 'battlefield' })
            draft.enqueue({ type: 'tap', objectId: before.id })
            continue
          }
          if (effect.do.some((instruction) => instruction.kind === 'putMilledLandTapped')) continue
          runInstructions(draft, source, effect.do)
        }
      }
    }
    if (before.zone !== 'battlefield' || event.to === 'battlefield') return
    for (const effect of triggerEffects(effectsOf(before), 'leaves')) {
      if (!conditionHolds(effect.if, state, before)) continue
      runInstructions(draft, before, effect.do)
    }
    if (event.to !== 'graveyard' || !before.types.includes('Creature')) return
    for (const effect of triggerEffects(effectsOf(before), 'dies')) {
      if (!conditionHolds(effect.if, state, before)) continue
      runInstructions(draft, before, effect.do)
    }
  },
}
