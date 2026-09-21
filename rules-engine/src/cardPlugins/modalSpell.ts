import type { Plugin } from '../types'
import { DIALOG_CHOSEN, pendingDialogFor, setPendingDialog } from '../pendingDialog'
import { effectsOf } from './cardRules'
import {
  runInstructions,
  type CardInstruction,
  type ModalMode,
} from './effects'

export const MODAL_CHOOSE = 'modalSpell.choose'

const modalEffects = (object: { name: string; effects?: ReturnType<typeof effectsOf> }) =>
  effectsOf(object).filter((effect) => effect.op === 'modal')

const listedInstructions = (object: { name: string; effects?: ReturnType<typeof effectsOf> }) =>
  effectsOf(object).flatMap((effect) => {
    if (effect.op === 'trigger' || effect.op === 'activate') return effect.do
    if (effect.op === 'modal') return effect.modes.flatMap((mode) => mode.do)
    return [] as CardInstruction[]
  })

const chooseModesInstruction = (object: { name: string; effects?: ReturnType<typeof effectsOf> }) =>
  listedInstructions(object).find((instruction): instruction is Extract<
    CardInstruction,
    { kind: 'chooseModes' }
  > => instruction.kind === 'chooseModes')

const chosenModes = (
  modes: ModalMode[],
  payload: { modes?: unknown } | undefined,
  choose: 'one' | 'any' | 'two',
) => {
  const labels = Array.isArray(payload?.modes)
    ? payload.modes.filter((mode): mode is string => typeof mode === 'string')
    : []
  const selected = modes.filter((mode) => labels.includes(mode.label))
  switch (choose) {
    case 'one':
      return selected.slice(0, 1)
    case 'two':
      return selected.slice(0, 2)
    default:
      return selected
  }
}

export const modalSpell: Plugin = {
  id: 'modalSpell',
  replace: ({ state, event }) => {
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    const object = item ? state.objects[item.objectId] : undefined
    if (!item || item.kind !== 'spell' || !object || modalEffects(object).length === 0) return
    if ((item.choices?.length ?? 0) > 0) return
    return {
      type: 'custom',
      name: MODAL_CHOOSE,
      seat: item.controller,
      payload: { sourceId: item.objectId },
    }
  },
  legal: ({ state, event }) => {
    if (event.type !== 'custom' || event.name !== DIALOG_CHOSEN || !event.seat) return
    const dialog = pendingDialogFor(state, event.seat)
    if (dialog?.kind !== 'choose-modes') return
    const source = state.objects[dialog.sourceId]
    const modal = source ? modalEffects(source)[0] : undefined
    const instruction = source ? chooseModesInstruction(source) : undefined
    const choose = modal && modal.op === 'modal'
      ? modal.choose
      : instruction?.choose
    if (choose !== 'two' && choose !== 'one') return
    const modes = modal && modal.op === 'modal' ? modal.modes : instruction?.modes
    if (!modes) return
    const selected = chosenModes(modes, event.payload, choose)
    if (choose === 'two' && selected.length !== 2) {
      return `${dialog.source} requires exactly two modes`
    }
    if (choose === 'one' && selected.length !== 1) {
      return `${dialog.source} requires exactly one mode`
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'custom' && event.name === MODAL_CHOOSE && event.seat) {
      const sourceId = event.payload?.sourceId
      const source = typeof sourceId === 'string' ? draft.object(sourceId) : undefined
      const modal = source ? modalEffects(source)[0] : undefined
      if (!source || !modal || modal.op !== 'modal') return
      const item = draft.stack.find((candidate) => candidate.objectId === source.id)
      const commanderBoth = modal.commanderChooseBoth && item?.payload?.commanderCast === true
      const max = modal.choose === 'any' || commanderBoth
        ? modal.modes.length
        : modal.choose === 'two'
          ? 2
          : 1
      const min = modal.choose === 'two' ? 2 : 1
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: event.seat,
        kind: 'choose-modes',
        options: modal.modes.map((mode) => mode.label),
        prompt: commanderBoth
          ? `Choose one or both — ${source.name}.`
          : modal.choose === 'two'
            ? `Choose two — ${source.name}.`
            : `Choose one — ${source.name}.`,
        waiting: 'is choosing a mode.',
        judge: `Waiting for ${source.name} mode choice.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        requirements: { target: { min, max } },
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
        const choose = modal.commanderChooseBoth && item.payload?.commanderCast === true
          ? 'any'
          : modal.choose
        const modes = chosenModes(modal.modes, event.payload, choose)
        if (modes.length === 0) return
        item.choices = [...modes.map((mode) => mode.id), '__modalRan__']
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
    if (!item || item.kind !== 'spell' || !object || !modal || modal.op !== 'modal') return
    const choices = item.choices
    if (!choices?.[0] || choices.includes('__modalExecuted__')) return
    const selected = modal.modes.filter((entry) => choices.includes(entry.id))
    if (selected.length === 0) return
    choices.push('__modalExecuted__')
    const pendingBefore = draft.pending.length
    for (const mode of selected) runInstructions(draft, object, mode.do, item)
    const instructions = draft.pending.splice(pendingBefore)
    draft.pending.unshift(...instructions)
    draft.note(`${object.name}: ${selected.map((mode) => mode.label).join('; ')}`)
  },
}
