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

/**
 * The action list is written for whoever holds priority. A responder is only
 * interesting before priority reaches them, so ask the same question with the
 * window moved to that seat.
 */
const actionsIfPriority = (state: GameState, seat: PlayerId) =>
  availableActions(state.priority === seat ? state : { ...state, priority: seat }, seat)

const actionText = (action: AvailableAction) => {
  if (action.kind === 'playLand') return `play ${action.name}`
  if (action.kind === 'castSpell') {
    return action.alternativeCost === 'withoutPayingMana'
      ? `cast ${action.name} without paying its mana cost`
      : `cast ${action.name}`
  }
  if (action.kind === 'declineFreeCast') return `decline the free cast of ${action.name}`
  if (action.kind === 'activateAbility') {
    return `activate ${action.name}${action.abilityId ? ` (${action.abilityId})` : ''}`
  }
  if (action.kind === 'payExtort') {
    return action.mana ? `pay {${action.mana}} for extort` : 'decline extort'
  }
  if (action.kind === 'declareAttackers') return 'declare attackers'
  return 'declare blockers'
}

/**
 * The journal alone made the judge re-simulate the game to answer "what step is
 * it", and a wrong guess rejected legal lines. These are the few facts it kept
 * getting wrong, computed from the authoritative state instead.
 */
export const kernelFacts = (state: GameState, seat: SeatId, human?: SeatId) => {
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
  const responders = state.playerOrder
    .filter((id) => id !== seat && !state.players[id].lost)
    .map((id) => ({ id, actions: actionsIfPriority(state, id) }))
    .filter((entry) => entry.actions.length > 0)

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
    `Other seats the kernel currently offers an action: ${
      responders
        .map((entry) => `${entry.id} (${entry.actions.length} action(s)${
          entry.id === human ? ', human seat' : ''
        })`)
        .join(', ') || 'none'
    }.`,
    'Those seats can afford something here, whatever their board looks like to',
    'you. Do not pass priority for them and do not rule their answer too',
    'expensive: open a window naming them and wait. The host drops any event you',
    'append past the human seat\'s own open response window.',
    'Counts only: never name or hint at the cards, hand, or plan behind another',
    "seat's actions, in this seat's private notes or at the table.",
  ].join('\n')
}
