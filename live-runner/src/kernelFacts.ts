import { availableActions } from '../../rules-engine/src/index'
import type { AvailableAction } from '../../rules-engine/src/actions'
import type {
  GameObject,
  GameState,
  ManaId,
  PlayerId,
} from '../../rules-engine/src/types'
import type { SeatId } from './protocol'

const MANA_ORDER: ManaId[] = ['W', 'U', 'B', 'R', 'G', 'C']

const poolText = (pool: Record<string, number>) => {
  const held = MANA_ORDER.flatMap((symbol) =>
    Array.from({ length: pool[symbol] ?? 0 }, () => `{${symbol}}`))
  return held.length > 0 ? held.join('') : 'empty'
}

/**
 * A source is only worth naming when it is actually available: the judge kept
 * inventing tapped lands, and an untapped list is the shortest correction.
 */
const producesMana = (object: GameObject) =>
  Boolean(object.tapProduces) || /add (?:\{|one mana)/i.test(object.oracleText)

const untappedSources = (state: GameState, seat: PlayerId) =>
  state.zoneOrder[seat].battlefield
    .map((id) => state.objects[id])
    .filter((object) => object && !object.tapped && producesMana(object))
    .map((object) => object.name)

const actionText = (action: AvailableAction) => {
  if (action.kind === 'playLand') return `play ${action.name}`
  if (action.kind === 'castSpell') return `cast ${action.name}`
  if (action.kind === 'activateAbility') {
    return `activate ${action.name}${action.abilityId ? ` (${action.abilityId})` : ''}`
  }
  if (action.kind === 'declareAttackers') return 'declare attackers'
  return 'declare blockers'
}

/**
 * The journal alone made the judge re-simulate the game to answer "what step is
 * it", and a wrong guess rejected legal lines. These are the few facts it kept
 * getting wrong, computed from the authoritative state instead.
 */
export const kernelFacts = (state: GameState, seat: SeatId) => {
  const round = Math.floor((state.turn - 1) / state.playerOrder.length) + 1
  const seats = state.playerOrder.map((id) => {
    const player = state.players[id]
    return `- ${id}: ${player.life} life, pool ${poolText(player.mana)}, `
      + `${player.landsPlayed}/${player.landPlaysAllowed} land plays used`
  })
  const actions = availableActions(state, seat as PlayerId)
  const stack = state.stack.length > 0
    ? state.stack.map((item) => item.name).join(', ')
    : 'empty'

  return [
    'Authoritative table state, computed by the host from the kernel. Trust it',
    'over any state you derive yourself; where your reading disagrees, yours is',
    'wrong. The board calls this round ' + round + ', so say "turn ' + round
      + '" to players rather than the internal counter.',
    `Internal turn ${state.turn} (round ${round}), step ${state.step}.`,
    `Active seat ${state.active}. Priority ${state.priority ?? 'none'}.`,
    `Stack: ${stack}.`,
    ...seats,
    `Untapped mana sources for ${seat}: ${
      untappedSources(state, seat as PlayerId).join(', ') || 'none'
    }.`,
    `Legal actions the kernel currently offers ${seat}: ${
      actions.map(actionText).join('; ') || 'none'
    }.`,
    'A line built only from those actions must not be rejected as illegal.',
  ].join('\n')
}
