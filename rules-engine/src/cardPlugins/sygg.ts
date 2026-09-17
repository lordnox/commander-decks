import { DIALOG_CHOSEN, hasPendingDialog, setPendingDialog } from '../pendingDialog'
import { lifeLostThisTurn } from '../plugins/damage'
import type { Plugin } from '../types'

/**
 * Sygg, River Cutthroat: at the beginning of each end step, if an opponent
 * lost 3 or more life this turn, you may draw a card. The condition is checked
 * when the trigger would go on the stack, so a life total that healed back up
 * does not hide the loss (CR 603.4). A player who was an opponent when they
 * left the game still counts, per Sygg's own ruling and CR 800.4i.
 */
export const sygg: Plugin = {
  id: 'sygg',
  apply: ({ event, draft, rule }) => {
    if (event.type !== 'custom' || event.name !== 'advanceStep') return
    if (draft.step !== 'end') return
    const source = draft.objects[rule.sourceId ?? '']
    if (!source || source.zone !== 'battlefield') return
    const bled = draft.playerOrder.some((seat) =>
      seat !== source.controller
      && lifeLostThisTurn(draft.players[seat]) >= 3)
    if (!bled) return
    if (hasPendingDialog(draft, source.controller, 'may-draw')) return
    setPendingDialog(draft, {
      sourceId: source.id,
      source: source.name,
      seat: source.controller,
      kind: 'may-draw',
      prompt: 'An opponent lost 3 or more life this turn. You may draw a card.',
      waiting: 'is deciding whether to draw.',
      judge: `Waiting for an optional draw from ${source.name}.`,
      chosenEvent: DIALOG_CHOSEN,
      destinations: ['skip', 'target'],
      count: 1,
    })
  },
}
