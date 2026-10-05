import type Draft from '../draft'
import { openOptionSelection, pendingOptionSelection } from '../rules/selectOptions'
import { apnapSeats } from '../turnOrder'
import type { PlayerId, Plugin } from '../types'
import type { InstructionHandler } from './instructionHandlers/types'

const WHEEL = 'wheel'
const KEEP = 'keep'

/** Ask the first of `seats` (turn order); answering asks the next, so each player decides in turn. */
const askNext = (
  draft: Draft,
  source: { id: string; name: string },
  count: number,
  seats: PlayerId[],
) => {
  const [seat, ...remaining] = seats.filter((candidate) => !draft.players[candidate].lost)
  if (!seat) return
  openOptionSelection(draft, {
    seat,
    sourceId: source.id,
    source: source.name,
    prompt: `You may discard your hand. If you do, draw ${count} cards.`,
    options: [
      { id: WHEEL, label: `Discard your hand and draw ${count} cards` },
      { id: KEEP, label: 'Keep your hand' },
    ],
    action: { kind: 'wheel', count, remaining },
  })
}

/** "Each player may discard their hand and, if they do, draw `count` cards." */
export const eachPlayerMayWheelInstruction: InstructionHandler<'eachPlayerMayWheel'> = (
  { draft, source },
  instruction,
) => {
  askNext(draft, source, instruction.count, apnapSeats(draft))
}

export const eachPlayerWheel: Plugin = {
  id: 'eachPlayerWheel',
  apply: ({ state, event, draft }) => {
    if (event.type !== 'selectOption') return
    const pending = pendingOptionSelection(state, event.seat)
    if (pending?.action.kind !== 'wheel' || !pending.sourceId) return
    const { count, remaining } = pending.action
    if (event.optionId === WHEEL) {
      for (const objectId of draft.zoneOrder[event.seat].hand) {
        draft.enqueue({ type: 'discard', seat: event.seat, objectId })
      }
      draft.enqueue({ type: 'draw', seat: event.seat, count })
    }
    askNext(draft, { id: pending.sourceId, name: pending.source ?? '' }, count, remaining)
  },
}
