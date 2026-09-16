import {
  clearPendingDialog,
  DIALOG_CHOSEN,
  pendingDialogFor,
  setPendingDialog,
} from '../pendingDialog'
import type { Plugin } from '../types'
import { enteringObjectId } from './entersTapped'

export const PIT_REPAIR_CHOICE = 'pitOfOfferings.chooseExiles'
export const PIT_RESOLVE = 'pitOfOfferings.resolve'
export const PIT_STACK_NAME = 'Pit of Offerings — Exile graveyard cards'

const openChoice = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  sourceId: string,
) => {
  const source = draft.object(sourceId)
  if (!source || source.name !== 'Pit of Offerings' || source.zone !== 'battlefield') return
  for (const objectId of source.exiledCards ?? []) {
    const card = draft.object(objectId)
    if (card?.exiledWith === source.id) delete card.exiledWith
  }
  source.exiledCards = []
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'exile-graveyards',
    prompt: 'Choose up to three target cards from graveyards to exile with Pit of Offerings.',
    waiting: 'is choosing up to three cards in graveyards.',
    judge: 'Waiting for Pit of Offerings targets.',
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['graveyard', 'exile'],
    optional: true,
    requirements: { exile: { min: 0, max: 3 } },
  })
}

export const pitOfOfferings: Plugin = {
  id: 'pit-of-offerings',
  replace: ({ state, event }) => {
    const item = state.stack[0]
    if (event.type !== 'resolveTop' || item?.name !== PIT_STACK_NAME) return
    return {
      type: 'custom',
      name: PIT_RESOLVE,
      seat: item.controller,
      payload: {
        sourceId: item.objectId,
        objectIds: item.targets
          .filter((target) => target.kind === 'object')
          .map((target) => target.objectId),
      },
    }
  },
  apply: ({ state, event, draft }) => {
    const enteredId = enteringObjectId(event, state)
    if (enteredId && state.objects[enteredId]?.name === 'Pit of Offerings') {
      openChoice(draft, enteredId)
      return
    }
    if (event.type === 'custom' && event.name === PIT_REPAIR_CHOICE) {
      const sourceId = event.payload?.sourceId
      if (typeof sourceId === 'string') openChoice(draft, sourceId)
      return
    }
    if (event.type !== 'custom' || !event.seat) return
    if (event.name === DIALOG_CHOSEN) {
      const dialog = pendingDialogFor(state, event.seat)
      if (dialog?.kind !== 'exile-graveyards') return
      const source = draft.object(dialog.sourceId)
      if (!source || source.zone !== 'battlefield') return
      const ids = Array.isArray(event.payload?.objectIds)
        ? event.payload.objectIds.filter((id): id is string => typeof id === 'string').slice(0, 3)
        : []
      const targets = ids.filter((id) => draft.object(id)?.zone === 'graveyard')
      clearPendingDialog(draft, event.seat)
      draft.stack.unshift({
        id: draft.allocId('stack'),
        kind: 'ability',
        objectId: source.id,
        controller: event.seat,
        name: PIT_STACK_NAME,
        targets: targets.map((objectId) => ({ kind: 'object', objectId })),
      })
      draft.passedInRow = []
      draft.priority = draft.active
      draft.note(`${source.name} puts its triggered ability on the stack`)
      return
    }
    if (event.name !== PIT_RESOLVE || state.stack[0]?.name !== PIT_STACK_NAME) return
    draft.stack.shift()
    const sourceId = event.payload?.sourceId
    const source = typeof sourceId === 'string' ? draft.object(sourceId) : undefined
    if (!source) return
    const ids = Array.isArray(event.payload?.objectIds)
      ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
      : []
    const linked: string[] = []
    for (const objectId of ids) {
      const card = draft.object(objectId)
      if (!card || card.zone !== 'graveyard') continue
      card.exiledWith = source.id
      linked.push(card.id)
      draft.enqueue({ type: 'move', objectId: card.id, to: 'exile' })
    }
    source.exiledCards = linked
    draft.note(
      linked.length > 0
        ? `${source.name} exiles ${linked.map((id) => draft.object(id)?.name).join(', ')}`
        : `${source.name} exiles no cards`,
    )
    draft.passedInRow = []
    draft.priority = draft.active
  },
}
