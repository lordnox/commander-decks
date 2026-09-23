import type Draft from '../draft'
import type { GameEvent, GameObject, GameState, PlayerId, Plugin, StackItem } from '../types'
import {
  clearPendingDialog,
  DIALOG_CHOSEN,
  pendingDialogFor,
  setPendingDialog,
} from '../pendingDialog'
import { pendingSelectionFor } from '../rules/selectCards'
import { spreeModesOf } from '../spreeCost'
import { effectsOf } from './cardRules'
import { runInstructions } from './effects'
import type { CardEffect, SpreeMode } from './effectDefinitions'

const PENDING_CAST = 'spreeCast.pending'
const SPREE_RESUME = 'spreeCast.resume'
const SPREE_RAN_PREFIX = '__spreeRan:'

type SpreeResume = {
  objectId: string
  spreeModes: string[]
  completed: string[]
}

type PendingSpreeCast = Omit<Extract<GameEvent, { type: 'castSpell' }>, 'type' | 'spreeModes'>

const spreeEffect = (object: GameObject) =>
  effectsOf(object).find((effect): effect is Extract<CardEffect, { op: 'castCost' }> =>
    effect.op === 'castCost' && Boolean(effect.spree))

const labelsToIds = (modes: SpreeMode[], labels: string[]) => {
  const selected = modes.filter((mode) => labels.includes(mode.label))
  return selected.map((mode) => mode.id)
}

const activeResume = (state: GameState | Draft): [PlayerId, SpreeResume] | undefined => {
  for (const seat of state.playerOrder) {
    const resume = state.players[seat]?.data[SPREE_RESUME] as SpreeResume | undefined
    if (resume?.objectId) return [seat, resume]
  }
}

const awaitingSpreeChoice = (
  state: GameState | Draft,
  objectId: string,
  seat: PlayerId,
) => {
  const selection = pendingSelectionFor(state, seat)
  if (selection?.sourceId === objectId) return true
  const dialog = pendingDialogFor(state, seat)
  return Boolean(dialog?.sourceId === objectId && dialog.kind !== 'choose-modes')
}

const finishSpreeResolution = (
  draft: Draft,
  seat: PlayerId,
  item: StackItem | undefined,
  object: GameObject,
  resume: SpreeResume,
) => {
  delete draft.players[seat].data[SPREE_RESUME]
  if (item) {
    item.choices = [...(item.choices ?? []), '__spreeExecuted__']
  }
  draft.note(`${object.name}: ${resume.spreeModes.map((id) =>
    spreeModesOf(object)?.find((mode) => mode.id === id)?.label ?? id).join('; ')}`)
}

const SPREE_CONTINUE = 'spreeCast.continue'

const advanceSpreeResolution = (
  draft: Draft,
  state: GameState,
  spellItem: StackItem | undefined,
) => {
  const resumed = activeResume(state)
  const seat = spellItem?.controller ?? resumed?.[0]
  if (!seat) return

  let resume = draft.players[seat].data[SPREE_RESUME] as SpreeResume | undefined
  if (spellItem && !resume) {
    resume = {
      objectId: spellItem.objectId,
      spreeModes: [...spellItem.spreeModes!],
      completed: [],
    }
    draft.players[seat].data[SPREE_RESUME] = resume
  }
  if (!resume) return

  const object = draft.object(resume.objectId)
  const modes = object ? spreeModesOf(object) : undefined
  if (!object || !modes) {
    delete draft.players[seat].data[SPREE_RESUME]
    return
  }

  if (
    spellItem?.choices?.includes('__spreeExecuted__')
    || (resume.completed.length === resume.spreeModes.length
      && !awaitingSpreeChoice(state, resume.objectId, seat))
  ) {
    return
  }

  if (awaitingSpreeChoice(state, resume.objectId, seat)) return

  const nextId = resume.spreeModes.find((id) => !resume.completed.includes(id))
  if (!nextId) {
    finishSpreeResolution(draft, seat, spellItem, object, resume)
    return
  }

  const mode = modes.find((entry) => entry.id === nextId)
  if (!mode) return

  const pendingBefore = draft.pending.length
  runInstructions(draft, object, mode.do, spellItem ?? state.stack[0])
  const instructions = draft.pending.splice(pendingBefore)
  draft.pending.unshift(...instructions)

  resume.completed.push(nextId)
  draft.players[seat].data[SPREE_RESUME] = resume
  if (spellItem) {
    spellItem.choices = [...(spellItem.choices ?? []), `${SPREE_RAN_PREFIX}${nextId}`]
  }

  if (awaitingSpreeChoice(draft, resume.objectId, seat)) return

  if (resume.completed.length < resume.spreeModes.length) {
    draft.enqueue({
      type: 'custom',
      name: SPREE_CONTINUE,
      seat,
      payload: { objectId: resume.objectId },
    })
    return
  }

  finishSpreeResolution(draft, seat, spellItem, object, resume)
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
    if (event.type === 'castSpell' && !event.spreeModes) {
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
    }
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

    if (event.type === 'selectCards' && event.seat) {
      const resumed = activeResume(draft)
      if (!resumed) return
      const [seat, resume] = resumed
      if (event.seat !== seat) return
      if (awaitingSpreeChoice(draft, resume.objectId, seat)) return
      if (resume.completed.length < resume.spreeModes.length) {
        draft.enqueue({
          type: 'custom',
          name: SPREE_CONTINUE,
          seat,
          payload: { objectId: resume.objectId },
        })
      }
      return
    }

    if (event.type === 'custom' && event.name === SPREE_CONTINUE && event.seat) {
      advanceSpreeResolution(draft, state, undefined)
      return
    }

    if (event.type !== 'resolveTop') return
    const stackItem = state.stack[0]
    const spellItem = stackItem?.kind === 'spell' && stackItem.spreeModes?.length
      ? stackItem
      : undefined
    if (!spellItem) return
    advanceSpreeResolution(draft, state, spellItem)
  },
}
