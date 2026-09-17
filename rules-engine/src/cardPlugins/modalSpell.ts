import type { Plugin } from '../types'
import { DIALOG_CHOSEN, pendingDialogFor, setPendingDialog } from '../pendingDialog'
import { effectsOf } from './cardRules'
import {
  runInstructions,
  type CardInstruction,
  type ModalMode,
} from './effects'

export const MODAL_CHOOSE = 'modalSpell.choose'

const modalEffects = (object: { effects?: ReturnType<typeof effectsOf> }) =>
  effectsOf(object).filter((effect) => effect.op === 'modal')

const listedInstructions = (object: { effects?: ReturnType<typeof effectsOf> }) =>
  effectsOf(object).flatMap((effect) => {
    if (effect.op === 'trigger' || effect.op === 'activate') return effect.do
    if (effect.op === 'modal') return effect.modes.flatMap((mode) => mode.do)
    return [] as CardInstruction[]
  })

const chooseModesInstruction = (object: { effects?: ReturnType<typeof effectsOf> }) =>
  listedInstructions(object).find((instruction): instruction is Extract<
    CardInstruction,
    { kind: 'chooseModes' }
  > => instruction.kind === 'chooseModes')

const chosenModes = (
  modes: ModalMode[],
  payload: { modes?: unknown } | undefined,
  choose: 'one' | 'any',
) => {
  const labels = Array.isArray(payload?.modes)
    ? payload.modes.filter((mode): mode is string => typeof mode === 'string')
    : []
  const selected = modes.filter((mode) => labels.includes(mode.label))
  if (choose === 'one') return selected.slice(0, 1)
  return selected
}

export const modalSpell: Plugin = {
  id: 'modalSpell',
  replace: ({ state, event }) => {
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    const object = item ? state.objects[item.objectId] : undefined
    if (!item || !object || modalEffects(object).length === 0) return
    if ((item.choices?.length ?? 0) > 0) return
    return {
      type: 'custom',
      name: MODAL_CHOOSE,
      seat: item.controller,
      payload: { sourceId: item.objectId },
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'custom' && event.name === MODAL_CHOOSE && event.seat) {
      const sourceId = event.payload?.sourceId
      const source = typeof sourceId === 'string' ? draft.object(sourceId) : undefined
      const modal = source ? modalEffects(source)[0] : undefined
      if (!source || !modal || modal.op !== 'modal') return
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: event.seat,
        kind: 'choose-modes',
        options: modal.modes.map((mode) => mode.label),
        prompt: `Choose one — ${source.name}.`,
        waiting: 'is choosing a mode.',
        judge: `Waiting for ${source.name} mode choice.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        requirements: { target: { min: 1, max: 1 } },
      })
      draft.players[event.seat].data['modalSpell.modeIds'] = modal.modes.map((mode) => mode.id)
      return
    }

    if (event.type === 'custom' && event.name === DIALOG_CHOSEN && event.seat) {
      const dialog = pendingDialogFor(state, event.seat)
      if (dialog?.kind !== 'choose-modes') return
      const source = draft.object(dialog.sourceId)
      if (!source) return
      const modal = modalEffects(source)[0]
      const item = draft.stack.find((candidate) => candidate.objectId === dialog.sourceId)
      if (modal && modal.op === 'modal' && item) {
        const [mode] = chosenModes(modal.modes, event.payload, modal.choose)
        if (!mode) return
        item.choices = [mode.id, '__modalRan__']
        draft.enqueue({ type: 'resolveTop' })
        return
      }
      const instruction = chooseModesInstruction(source)
      if (!instruction) return
      const modes = chosenModes(instruction.modes, event.payload, instruction.choose)
      draft.note(
        modes.length > 0
          ? `${dialog.source}: ${modes.map((mode) => mode.label).join('; ')}`
          : `${dialog.source} chooses no modes`,
      )
      for (const mode of modes) runInstructions(draft, source, mode.do)
      return
    }

    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    const object = item ? draft.object(item.objectId) : undefined
    const modal = object ? modalEffects(object)[0] : undefined
    if (!item || !object || !modal || modal.op !== 'modal') return
    if (!item.choices?.[0] || item.choices.includes('__modalExecuted__')) return
    const mode = modal.modes.find((entry) => entry.id === item.choices[0])
    if (!mode) return
    item.choices.push('__modalExecuted__')
    const pendingBefore = draft.pending.length
    runInstructions(draft, object, mode.do, item)
    const instructions = draft.pending.splice(pendingBefore)
    draft.pending.unshift(...instructions)
    draft.note(`${object.name}: ${mode.label}`)
  },
}
