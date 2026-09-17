import type { Plugin } from '../types'
import { DIALOG_CHOSEN, pendingDialogFor, setPendingDialog } from '../pendingDialog'
import { effectsOf } from './cardRules'
import { runInstructions, triggerEffects } from './effects'

const castModalEffects = (object: { name: string; effects?: ReturnType<typeof effectsOf> }) =>
  triggerEffects(effectsOf(object), 'cast').filter((effect) => effect.modal)

export const castTriggers: Plugin = {
  id: 'castTriggers',
  apply: ({ state, event, draft }) => {
    if (event.type === 'castSpell') {
      const spell = draft.object(event.objectId)
      if (!spell) return
      for (const permanent of draft.zoneOf('battlefield')) {
        for (const effect of triggerEffects(effectsOf(permanent), 'cast')) {
          if (event.seat !== permanent.controller) continue
          if (effect.creatureOnly && !spell.types.includes('Creature')) continue
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
          runInstructions(draft, permanent, effect.do, draft.stack[0])
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
    const effect = triggerEffects(effectsOf(permanent), 'cast').find((entry) => entry.modal)
    if (!effect?.modal) return
    const labels = Array.isArray(event.payload?.modes)
      ? event.payload.modes.filter((mode): mode is string => typeof mode === 'string')
      : []
    const mode = effect.modal.modes.find((entry) => labels.includes(entry.label))
    if (!mode) return
    delete draft.players[event.seat].data['castModal.permanentId']
    delete draft.players[event.seat].data['castModal.spellId']
    runInstructions(draft, permanent, mode.do, draft.stack[0])
    draft.note(`${permanent.name}: ${mode.label}`)
  },
}
