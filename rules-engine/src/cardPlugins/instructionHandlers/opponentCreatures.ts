import { openPlayerSelection } from '../../rules/selectPlayers'
import { stampLoseAbilitiesBecomeOnOpponentCreatures } from '../loseAbilitiesStamp'
import type { InstructionHandler } from './types'

const loseAbilitiesBecomeInstruction: InstructionHandler<'loseAbilitiesBecome'> = (
  { draft, source, item },
  instruction,
) => {
  const target = item?.targets.find((entry) => entry.kind === 'player')
  if (target?.kind === 'player') {
    stampLoseAbilitiesBecomeOnOpponentCreatures(draft, target.player, instruction)
    return
  }
  const candidates = draft.playerOrder.filter(
    (seat) => seat !== source.controller && !draft.players[seat].lost,
  )
  if (candidates.length === 0) return
  openPlayerSelection(draft, {
    seat: source.controller,
    sourceId: source.id,
    source: source.name,
    prompt: 'Choose target opponent.',
    min: 1,
    max: 1,
    candidates,
    action: {
      kind: 'loseAbilitiesBecomeOpponent',
      extraSubtype: instruction.extraSubtype,
      power: instruction.power,
      toughness: instruction.toughness,
    },
  })
}

export const opponentCreatureHandlers = {
  loseAbilitiesBecome: loseAbilitiesBecomeInstruction,
} satisfies Partial<import('./types').InstructionHandlers>

export { stampLoseAbilitiesBecomeOnOpponentCreatures } from '../loseAbilitiesStamp'
