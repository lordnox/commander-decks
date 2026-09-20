import { markKnownToAll } from '../knowledge'
import {
  openOptionSelection,
  pendingOptionSelection,
} from '../rules/selectOptions'
import type { Plugin } from '../types'
import type { InstructionHandler } from './instructionHandlers/types'

export const hiddenPileNegotiationInstruction: InstructionHandler<'hiddenPileNegotiation'> = (
  { draft, source },
  instruction,
) => {
  const count = instruction.pileSize * instruction.pileCount
  const cards = draft.zoneOrder[source.controller].library.slice(0, count)
  const piles: [string[], string[]] = [
    cards.slice(0, instruction.pileSize),
    cards.slice(instruction.pileSize),
  ]
  for (const objectId of cards) {
    const object = draft.move(objectId, 'exile')
    if (!object) continue
    object.faceDown = true
    object.knownTo = [source.controller]
  }
  const opponents = draft.playerOrder.filter((seat) =>
    seat !== source.controller && !draft.players[seat].lost)
  if (cards.length === 0 || opponents.length === 0) {
    draft.enqueue({
      type: 'loseLife',
      seat: source.controller,
      amount: instruction.lifeLoss,
      source: source.name,
    })
    return
  }
  openOptionSelection(draft, {
    seat: source.controller,
    sourceId: source.id,
    source: source.name,
    prompt: 'Choose a pile to turn face up and an opponent to choose a pile.',
    options: piles.flatMap((pile, pileIndex) =>
      opponents.map((opponent) => ({
        id: `${pileIndex}:${opponent}`,
        label: `Reveal pile ${pileIndex + 1} (${
          pile.map((id) => draft.objects[id]?.name).filter(Boolean).join(', ')
        }); ${opponent} chooses`,
      }))),
    action: {
      kind: 'hidden-piles-reveal',
      piles,
      opponents,
      lifeLoss: instruction.lifeLoss,
    },
  })
}

const optionLabel = (
  state: Parameters<NonNullable<Plugin['apply']>>[0]['state'],
  pile: string[],
  visible: boolean,
  index: number,
) => visible
  ? `Pile ${index + 1}: ${pile.map((id) => state.objects[id]?.name).filter(Boolean).join(', ')}`
  : `Face-down pile ${index + 1} (${pile.length} cards)`

export const hiddenPiles: Plugin = {
  id: 'hiddenPiles',
  apply: ({ state, event, draft }) => {
    if (event.type !== 'selectOption') return
    const pending = pendingOptionSelection(state, event.seat)
    if (!pending) return

    if (pending.action.kind === 'hidden-piles-reveal') {
      const [pileText, opponent] = event.optionId.split(':')
      const pileIndex = Number(pileText)
      if (
        (pileIndex !== 0 && pileIndex !== 1)
        || !pending.action.opponents.includes(opponent)
      ) return
      const pile = pending.action.piles[pileIndex]
      markKnownToAll(draft, pile)
      for (const objectId of pile) {
        const object = draft.object(objectId)
        if (object) object.faceDown = false
      }
      openOptionSelection(draft, {
        seat: opponent,
        sourceId: pending.sourceId,
        source: pending.source,
        prompt: 'Choose the pile its controller puts into their hand.',
        options: pending.action.piles.map((candidate, index) => ({
          id: String(index),
          label: optionLabel(state, candidate, index === pileIndex, index),
        })),
        action: {
          kind: 'hidden-piles-take',
          piles: pending.action.piles,
          lifeLoss: pending.action.lifeLoss,
        },
      })
      return
    }

    if (pending.action.kind !== 'hidden-piles-take') return
    const chosenIndex = Number(event.optionId)
    if (chosenIndex !== 0 && chosenIndex !== 1) return
    const source = pending.sourceId ? state.objects[pending.sourceId] : undefined
    const controller = source?.controller
    if (!controller) return
    const otherIndex = chosenIndex === 0 ? 1 : 0
    for (const objectId of pending.action.piles[chosenIndex]) {
      const object = draft.object(objectId)
      if (object) object.faceDown = false
      draft.move(objectId, 'hand')
    }
    for (const objectId of pending.action.piles[otherIndex]) {
      const object = draft.object(objectId)
      if (object) object.faceDown = false
      draft.move(objectId, 'graveyard')
    }
    draft.enqueue({
      type: 'loseLife',
      seat: controller,
      amount: pending.action.lifeLoss,
      source: pending.source,
    })
  },
}
