import type Draft from '../draft'
import { finishedSpellZone } from '../cardPlugins/alternateCosts'
import { wardGeneric } from '../keywords'
import {
  DIALOG_CHOSEN,
  hasPendingDialog,
  pendingDialogFor,
  setPendingDialog,
} from '../pendingDialog'
import { payCost } from './spells'
import type { GameObject, GameState, Plugin, StackItem } from '../types'

const ASK = 'ward.ask'

const stampedWard = (object: GameObject) => {
  for (const effect of object.effects ?? []) {
    if (effect.op === 'static' && effect.ward) return effect.ward.generic
  }
}

export const wardCostGeneric = (object: GameObject) =>
  stampedWard(object) ?? wardGeneric(object)

type UnpaidWard = {
  item: StackItem
  target: GameObject
  generic: number
}

const unpaidWard = (state: GameState): UnpaidWard | undefined => {
  for (const item of state.stack) {
    if (item.kind === 'action') continue
    const settled = new Set(item.wardSettled ?? [])
    for (const target of item.targets) {
      if (target.kind !== 'object' || settled.has(target.objectId)) continue
      const object = state.objects[target.objectId]
      if (!object || object.zone !== 'battlefield') continue
      if (object.controller === item.controller) continue
      const generic = wardCostGeneric(object)
      if (generic === undefined) continue
      return { item, target: object, generic }
    }
  }
}

const markSettled = (item: StackItem, targetId: string) => {
  item.wardSettled = [...new Set([...(item.wardSettled ?? []), targetId])]
}

const counterStackItem = (draft: Draft, item: StackItem, source: string) => {
  const index = draft.stack.findIndex((candidate) => candidate.id === item.id)
  if (index < 0) return
  if (draft.stack[index].uncounterable) {
    draft.note(`${source}'s ward cannot counter ${item.name}`)
    return
  }
  const [countered] = draft.stack.splice(index, 1)
  if (countered.kind === 'spell') {
    draft.enqueue({
      type: 'move',
      objectId: countered.objectId,
      to: finishedSpellZone(countered, 'graveyard'),
    })
  }
  draft.note(`${source}'s ward counters ${item.name}`)
}

export const ward: Plugin = {
  id: 'ward',
  legal: ({ state, event }) => {
    if (event.type !== 'custom' || event.name !== DIALOG_CHOSEN || !event.seat) return
    const dialog = pendingDialogFor(state, event.seat)
    if (dialog?.kind !== 'pay-ward') return
    if (event.payload?.accepted !== true) return
    const cost = dialog.cost
    if (!cost) return
    if (!payCost(state.players[event.seat]?.mana, cost)) {
      return `not enough mana to pay ward ${cost}`
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'custom' && event.name === DIALOG_CHOSEN && event.seat) {
      const dialog = pendingDialogFor(state, event.seat)
      if (dialog?.kind !== 'pay-ward' || !dialog.stackId || !dialog.targetId) return
      const item = draft.stack.find((candidate) => candidate.id === dialog.stackId)
      if (!item) return
      markSettled(item, dialog.targetId)
      if (event.payload?.accepted === true && dialog.cost) {
        draft.enqueue({ type: 'payMana', seat: event.seat, cost: dialog.cost })
        draft.note(`${event.seat} pays ${dialog.cost} for ward of ${dialog.source}`)
        return
      }
      counterStackItem(draft, item, dialog.source)
      return
    }
    if (event.type !== 'custom' || event.name !== ASK) return
    if (state.playerOrder.some((seat) => hasPendingDialog(state, seat, 'pay-ward'))) return
    const pending = unpaidWard(draft)
    if (!pending) return
    const cost = `{${pending.generic}}`
    setPendingDialog(draft, {
      sourceId: pending.target.id,
      source: pending.target.name,
      seat: pending.item.controller,
      kind: 'pay-ward',
      prompt: `Pay ${cost} for ward of ${pending.target.name}, or ${pending.item.name} is countered.`,
      waiting: 'is deciding whether to pay ward.',
      judge: `Waiting for ${pending.item.controller} to pay ward ${cost}.`,
      chosenEvent: DIALOG_CHOSEN,
      destinations: ['skip', 'target'],
      cost,
      stackId: pending.item.id,
      targetId: pending.target.id,
      optional: true,
    })
  },
  sba: ({ draft }) => {
    if (draft.playerOrder.some((seat) => hasPendingDialog(draft, seat, 'pay-ward'))) return []
    return unpaidWard(draft) ? [{ type: 'custom', name: ASK }] : []
  },
}
