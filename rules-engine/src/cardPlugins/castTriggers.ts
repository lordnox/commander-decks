import type { Plugin } from '../types'
import { DIALOG_CHOSEN, pendingDialogFor, setPendingDialog } from '../pendingDialog'
import { effectsOf } from './cardRules'
import { triggerEffects } from './effects'
import { isTriggerBindingIf, matchesTriggerEvent } from './triggers/matching'
import { markTriggeredOnceEachTurn, mayTriggerOnceEachTurn, triggerEffectByKey, triggerEffectKey } from './triggerFrequency'

export const castTriggers: Plugin = {
  id: 'castTriggers',
  apply: ({ state, event, draft }) => {
    if (event.type === 'castSpell') {
      const spell = draft.object(event.objectId)
      if (!spell) return
      for (const permanent of draft.zoneOf('battlefield')) {
        const catalog = effectsOf(permanent)
        for (const effect of triggerEffects(catalog, 'cast')) {
          if (!effect.modal || !matchesTriggerEvent(draft, permanent, effect, {
            watched: spell, player: event.seat, event,
          })) continue
          const key = triggerEffectKey(catalog, effect)
          if (effect.onceEachTurn && !mayTriggerOnceEachTurn(permanent, key, draft.turn)) continue
          if (effect.onceEachTurn) markTriggeredOnceEachTurn(permanent, key, draft.turn)
          draft.players[permanent.controller].data['castModal.effectKey'] = key
          if (effect.modal) {
            setPendingDialog(draft, {
              sourceId: permanent.id,
              source: permanent.name,
              seat: permanent.controller,
              kind: 'choose-modes',
              options: effect.modal.modes.map((mode) => mode.label),
              prompt: `${permanent.name}: choose one.`,
              waiting: 'is choosing a mode.',
              judge: `Waiting for ${permanent.name} mode choice.`,
              chosenEvent: DIALOG_CHOSEN,
              destinations: ['skip', 'target'],
              requirements: { target: { min: 1, max: 1 } },
            })
            draft.players[permanent.controller].data['castModal.permanentId'] = permanent.id
            draft.players[permanent.controller].data['castModal.spellId'] = spell.id
            continue
          }
        }
      }
      return
    }

    if (event.type !== 'custom' || event.name !== DIALOG_CHOSEN || !event.seat) return
    const dialog = pendingDialogFor(state, event.seat)
    if (dialog?.kind !== 'choose-modes') return
    const permanentId = draft.players[event.seat].data['castModal.permanentId']
    if (typeof permanentId !== 'string' || permanentId !== dialog.sourceId) return
    const permanent = draft.object(permanentId)
    if (!permanent) return
    const spellId = draft.players[event.seat].data['castModal.spellId']
    const key = draft.players[event.seat].data['castModal.effectKey']
    const effect = typeof key === 'string' ? triggerEffectByKey(effectsOf(permanent), key) : undefined
    if (!effect?.modal) return
    const labels = Array.isArray(event.payload?.modes)
      ? event.payload.modes.filter((mode): mode is string => typeof mode === 'string')
      : []
    const mode = effect.modal.modes.find((entry) => labels.includes(entry.label))
    if (!mode) return
    delete draft.players[event.seat].data['castModal.permanentId']
    delete draft.players[event.seat].data['castModal.spellId']
    delete draft.players[event.seat].data['castModal.effectKey']
    draft.addTriggeredAbility(permanent, mode.do, {
      payload: {
        instructions: mode.do,
        triggeringPlayer: typeof spellId === 'string' ? state.objects[spellId]?.controller : undefined,
        triggerEffectKey: key,
        ...(effect.if && !isTriggerBindingIf(effect.if) ? { interveningIf: effect.if } : {}),
      },
    })
    draft.note(`${permanent.name}: ${mode.label}`)
  },
}
