import { discard } from './discard'
import { draw } from './draw'
import { selectCards } from './selectCards'
import { selectPlayers } from './selectPlayers'
import { triggers } from './triggers'

export { discard, initiateDiscard } from './discard'
export { draw, initiateDraw } from './draw'
export {
  openCardSelection,
  pendingSelection,
  pendingSelectionById,
  pendingSelectionFor,
  pendingSelectionsFor,
  selectCards,
  type CardSelectionKind,
  type PendingCardSelection,
} from './selectCards'
export { triggers } from './triggers'
export {
  openPlayerSelection,
  pendingPlayerSelection,
  pendingPlayerSelectionFor,
  pendingPlayerSelectionsFor,
  selectPlayers,
  type PendingPlayerSelection,
} from './selectPlayers'
export { resolveAbility, resolveAction } from './actions'

/** CR 701 / 121 / 603 — always-on game rules for the stack pipeline. */
export const gameRules = [discard, draw, selectCards, selectPlayers, triggers]
