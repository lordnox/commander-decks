import type { GameEvent, GameObject, GameState, Plugin } from '../types'
import {
  clearPendingDialog,
  DIALOG_CHOSEN,
  pendingDialogFor,
  setPendingDialog,
} from '../pendingDialog'
import { spreeModesOf } from '../spreeCost'
import { effectsOf } from './cardRules'
import { runInstructions } from './effects'
import type { SpreeMode } from './effectDefinitions'

const PENDING_CAST = 'spreeCast.pending'

type PendingSpreeCast = Omit<Extract<GameEvent, { type: 'castSpell' }>, 'type' | 'spreeModes'>

const spreeEffect = (object: GameObject) =>
  effectsOf(object).find((effect) => effect.op === 'castCost' && effect.spree)

const labelsToIds = (modes: SpreeMode[], labels: string[]) => {
  const selected = modes.filter((mode) => labels.includes(mode.label))
  return selected.map((mode) => mode.id)
}

const validateSpreeModes = (modes: SpreeMode[], selected: string[] | undefined) => {
  if (!selected || selected.length === 0) return 'choose at least one Spree mode'
  const known = new Set(modes.map((mode) => mode.id))
  if (selected.some((id) => !known.has(id))) return 'illegal Spree mode'
  if (new Set(selected).size !== selected.length) return 'duplicate Spree mode'
  return undefined
}

export const spreeCast: Plugin = {
  id: 'spreeCast',
  replace: ({ state, event }) => {
    if (event.type !== 'castSpell' || event.spreeModes) return
    const object = state.objects[event.objectId]
    if (!object || !spreeEffect(object)) return
    const {
      type: _type,
      spreeModes: _modes,
      ...cast
    } = event
    return [{
      type: 'custom' as const,
      name: 'spreeCast.openSelection',
      seat: event.seat,
      payload: { cast },
    }]
  },
  legal: ({ state, event }) => {
    if (event.type === 'custom' && event.name === DIALOG_CHOSEN && event.seat) {
      const pending = state.players[event.seat]?.data[PENDING_CAST]
      if (!pending) return
      const object = state.objects[(pending as PendingSpreeCast).objectId]
      const modes = object ? spreeModesOf(object) : undefined
      if (!modes) return
      const labels = Array.isArray(event.payload?.modes)
        ? event.payload.modes.filter((mode): mode is string => typeof mode === 'string')
        : []
      return validateSpreeModes(modes, labelsToIds(modes, labels))
    }
    if (event.type !== 'castSpell') return
    const object = state.objects[event.objectId]
    const modes = object ? spreeModesOf(object) : undefined
    if (!modes) {
      if (event.spreeModes) return 'this spell has no Spree cost'
      return
    }
    if (!event.spreeModes) return
    return validateSpreeModes(modes, event.spreeModes)
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'custom' && event.name === 'spreeCast.openSelection' && event.seat) {
      const cast = event.payload?.cast as PendingSpreeCast | undefined
      const object = cast ? state.objects[cast.objectId] : undefined
      const effect = object ? spreeEffect(object) : undefined
      const modes = effect?.spree
      if (!cast || !object || !modes) return
      setPendingDialog(draft, {
        sourceId: object.id,
        source: object.name,
        seat: event.seat,
        kind: 'choose-modes',
        options: modes.map((mode) => mode.label),
        prompt: `${object.name}: choose one or more Spree modes.`,
        waiting: 'is choosing Spree modes.',
        judge: `Waiting for ${object.name} Spree mode choice.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        requirements: { target: { min: 1, max: modes.length } },
      })
      draft.players[event.seat].data[PENDING_CAST] = cast
      return
    }

    if (event.type === 'custom' && event.name === DIALOG_CHOSEN && event.seat) {
      const pending = draft.players[event.seat].data[PENDING_CAST] as PendingSpreeCast | undefined
      if (!pending) return
      const dialog = pendingDialogFor(state, event.seat)
      if (dialog?.kind !== 'choose-modes' || dialog.sourceId !== pending.objectId) return
      const object = draft.object(pending.objectId)
      const modes = object ? spreeModesOf(object) : undefined
      if (!object || !modes) return
      const labels = Array.isArray(event.payload?.modes)
        ? event.payload.modes.filter((mode): mode is string => typeof mode === 'string')
        : []
      const spreeModes = labelsToIds(modes, labels)
      const error = validateSpreeModes(modes, spreeModes)
      if (error) return
      delete draft.players[event.seat].data[PENDING_CAST]
      clearPendingDialog(draft, event.seat)
      draft.enqueue({
        type: 'castSpell',
        ...pending,
        spreeModes,
      })
      return
    }

    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (!item || item.kind !== 'spell' || !item.spreeModes?.length) return
    if (item.choices?.includes('__spreeExecuted__')) return
    const object = draft.object(item.objectId)
    const modes = object ? spreeModesOf(object) : undefined
    if (!object || !modes) return
    item.choices = [...(item.choices ?? []), '__spreeExecuted__']
    for (const id of item.spreeModes) {
      const mode = modes.find((entry) => entry.id === id)
      if (!mode) continue
      const pendingBefore = draft.pending.length
      runInstructions(draft, object, mode.do, item)
      const instructions = draft.pending.splice(pendingBefore)
      draft.pending.unshift(...instructions)
    }
    draft.note(`${object.name}: ${item.spreeModes.map((id) =>
      modes.find((mode) => mode.id === id)?.label ?? id).join('; ')}`)
  },
}
