import { abilityTokens } from '../../rules-engine/src/keywords'
import { replayComparableState } from '../../rules-engine/src/replay'
import type {
  EventTrace,
  GameObject,
  GameState,
  ManaPool,
  PlayerId,
} from '../../rules-engine/src/types'
import type {
  LiveEvent,
  LiveHistoryFrame,
  LiveSeat,
  LiveSnapshot,
} from '../../site/src/liveCodec'
import type { ReplayCombat } from '../../site/src/replayTypes'
import { SEAT_COLORS } from '../../site/src/liveCompact'
import type { LobbyState } from './lobby'
import { isSeatId, type SeatId } from './protocol'

const deckPath = (path?: string) => path || ''

const manaText = (mana: Partial<ManaPool>) =>
  Object.entries(mana)
    .filter(([, amount]) => amount)
    .map(([symbol, amount]) => `${amount} {${symbol}}`)
    .join(', ')

const traceSummary = (trace: EventTrace, state: GameState) => {
  const { event } = trace
  let summary: string
  switch (event.type) {
    case 'activateAbility':
      summary = `${event.seat} activates ${event.abilityId}`
      break
    case 'payMana':
      summary = `${event.seat} pays ${event.cost}`
      break
    case 'tap':
      summary = `${state.objects[event.objectId]?.name ?? 'A permanent'} taps`
      break
    case 'addMana':
      summary = `${event.seat} adds ${manaText(event.mana)}`
      break
    case 'emptyManaPools':
      summary = 'Empty mana pools'
      break
    case 'loseLife':
      summary = `${event.seat} loses ${event.amount} life`
      break
    case 'judgeFallback':
      summary = 'Judge fallback applied'
      break
    case 'reveal':
      summary = `${event.seat} reveals ${
        event.objectIds
          .map((id) => state.objects[id]?.name ?? 'a card')
          .join(', ')
      }`
      break
    case 'custom':
      summary = event.name
      break
    default:
      summary = event.type
  }
  const outcome = trace.outcome === 'applied'
    ? ''
    : ` — ${trace.outcome}${trace.pluginId ? ` by ${trace.pluginId}` : ''}`
  return `${'↳ '.repeat(trace.depth)}${summary}${outcome}`
}

export const liveEventFromTrace = (
  trace: EventTrace,
  state: GameState,
  id: number,
): LiveEvent => {
  const comparable = replayComparableState(state)
  const event = trace.event
  return {
    id,
    turn: comparable.turn,
    phase: comparable.phase,
    ...('seat' in event ? { seat: event.seat ?? null } : {}),
    kind: `kernel-${trace.outcome}`,
    summary: traceSummary(trace, state),
  }
}

const COMBAT_VIEW_STEPS: Partial<Record<GameState['step'], ReplayCombat['step']>> = {
  declareAttackers: 'attackers',
  declareBlockers: 'blockers',
  firstStrikeDamage: 'first_strike_damage',
  combatDamage: 'combat_damage',
}

const KEYWORDS = [
  'flying',
  'deathtouch',
  'lifelink',
  'first strike',
  'double strike',
  'trample',
  'vigilance',
  'menace',
  'reach',
  'indestructible',
]

const keywordsOf = (object: GameObject) => {
  const tokens = abilityTokens(object.oracleText)
  return KEYWORDS.filter((keyword) => tokens.includes(keyword))
}

const ptText = (object: GameObject) =>
  object.power === null || object.toughness === null
    ? undefined
    : `${object.power}/${object.toughness}`

const battlefieldObjects = (state: GameState) =>
  state.playerOrder.flatMap((seat) =>
    state.zoneOrder[seat].battlefield.map((id) => state.objects[id]).filter(Boolean))

const defenderName = (state: GameState, object: GameObject) => {
  if (!object.attacking) return ''
  if (typeof object.attacking === 'string') return object.attacking
  return object.attacking.kind === 'player'
    ? object.attacking.player
    : state.objects[object.attacking.objectId]?.name ?? object.attacking.objectId
}

const defendingSeat = (state: GameState, object: GameObject) => {
  if (!object.attacking) return ''
  if (typeof object.attacking === 'string') return object.attacking
  return object.attacking.kind === 'player'
    ? object.attacking.player
    : state.objects[object.attacking.objectId]?.controller ?? ''
}

const untappedCreatures = (battlefield: GameObject[], seat: PlayerId) =>
  battlefield
    .filter((object) =>
      object.controller === seat
      && object.types.includes('Creature')
      && !object.tapped)
    .map((object) => object.name)

/**
 * Attackers and blockers are invisible in a public board of names and tap
 * states, so project them for the viewer's combat panel.
 */
export const kernelCombat = (state: GameState): ReplayCombat | undefined => {
  const step = COMBAT_VIEW_STEPS[state.step]
  if (!step) return undefined
  const battlefield = battlefieldObjects(state)
  const attackers = battlefield.filter((object) => object.attacking)
  if (attackers.length === 0) return undefined
  const combat: ReplayCombat = {
    step,
    attackers: attackers.map((object) => ({
      card: object.name,
      defender: defenderName(state, object),
      ...(ptText(object) ? { pt: ptText(object) } : {}),
      tapped: object.tapped,
      ...(keywordsOf(object).length > 0 ? { keywords: keywordsOf(object) } : {}),
    })),
  }

  const blockers = battlefield.filter((object) => object.blocking)
  if (blockers.length === 0 && step !== 'first_strike_damage' && step !== 'combat_damage') {
    const defenders = [...new Set(attackers.map((object) => defenderName(state, object)))]
    combat.possible_blockers = Object.fromEntries(
      defenders.map((defender) => {
        const attacker = attackers.find((object) => defenderName(state, object) === defender)
        return [defender, untappedCreatures(battlefield, defendingSeat(state, attacker!))]
      }),
    )
    return combat
  }

  combat.blocks = attackers
    .map((attacker) => ({
      attacker: attacker.name,
      blockers: blockers
        .filter((blocker) => blocker.blocking === attacker.id)
        .map((blocker) => blocker.name),
    }))
    .filter((block) => block.blockers.length > 0)
  combat.unblocked = attackers
    .filter((attacker) => !blockers.some((blocker) => blocker.blocking === attacker.id))
    .map((attacker) => attacker.name)
  return combat
}

/**
 * Loyalty, +1/+1 and charge counters are live game state that the printed card
 * face cannot show. Without them the board falls back to the printed Scryfall
 * value and reports a planeswalker at its starting loyalty forever.
 */
const counterLabels = (object?: GameObject) =>
  object && Object.keys(object.counters).length > 0
    ? { counters: { ...object.counters } }
    : {}

/**
 * Floating mana is public, but it only exists between a tap and the spell it
 * pays for. Send it only when something is actually held so an empty pool costs
 * nothing on the wire.
 */
const manaLabel = (pool: Record<string, number>) => {
  const held = Object.entries(pool).filter(([, amount]) => amount > 0)
  return held.length > 0 ? { mana: Object.fromEntries(held) } : {}
}

const summoningSicknessLabel = (object?: GameObject) =>
  object?.types.includes('Creature') && object.summoningSickness
    ? { summoningSickness: true }
    : {}

/** The card face shows tap state only, so attacks need their own label. */
const combatLabels = (state: GameState, lobby: LobbyState, object?: GameObject) => {
  if (!object) return {}
  if (object.attacking) {
    if (typeof object.attacking !== 'string' && object.attacking.kind === 'object') {
      return { attacking: state.objects[object.attacking.objectId]?.name ?? object.attacking.objectId }
    }
    const defender = typeof object.attacking === 'string'
      ? object.attacking
      : object.attacking.player
    return { attacking: lobby.occupants[defender as SeatId]?.name || defender }
  }
  if (object.blocking) {
    const blocked = state.objects[object.blocking]?.name
    return blocked ? { blocking: blocked } : {}
  }
  return {}
}

const liveSeatId = (player: PlayerId): SeatId => {
  if (!isSeatId(player)) throw new Error(`live host cannot project player ${player}`)
  return player
}

export const liveSeatsFromState = (
  state: GameState,
  lobby: LobbyState,
  viewer: SeatId | null,
): LiveSeat[] => {
  const comparable = replayComparableState(state)
  return state.playerOrder.map((playerId, index) => {
    const seat = liveSeatId(playerId)
    const player = comparable.players[playerId]
    const occupant = lobby.occupants[seat]
    const handHidden = viewer !== playerId
    return {
      id: seat,
      name: occupant?.name || seat,
      deck: deckPath(occupant?.deck),
      commanders: player.command,
      color: SEAT_COLORS[index] ?? SEAT_COLORS[0],
      life: player.life,
      poison: player.poison,
      commander_tax: 0,
      ...manaLabel(state.players[playerId].mana),
      library_count: player.library_count,
      hand_count: state.zoneCounts[seat].hand,
      ...(handHidden ? {} : { hand: player.hand }),
      commander_damage: Object.fromEntries(
        state.playerOrder
          .filter((other) => other !== seat)
          .map((other) => [other, 0]),
      ),
      battlefield: player.battlefield.map((card, index) => {
        const object = state.objects[state.zoneOrder[seat].battlefield[index]]
        return {
          ...card,
          ...counterLabels(object),
          ...summoningSicknessLabel(object),
          ...combatLabels(state, lobby, object),
        }
      }),
      graveyard: player.graveyard,
      exile: player.exile,
      command: player.command,
    }
  })
}

export const liveSnapshotFromState = (options: {
  state: GameState
  lobby: LobbyState
  viewer: SeatId | null
  history?: LiveHistoryFrame[]
  historyCursor?: number
  events?: LiveEvent[]
}): LiveSnapshot => {
  const { state, lobby, viewer } = options
  const comparable = replayComparableState(state)
  const seats = liveSeatsFromState(state, lobby, viewer)
  const priority = state.priority
  const combat = kernelCombat(state)
  return {
    v: 1,
    ...(combat ? { combat } : {}),
    you: viewer,
    headline: seats.map((seat) => seat.name).join(' / ') || 'Live table',
    // The judge writes the actionable prompt privately: it names the cards and
    // the sequence, so the seat that owes the answer must read that one.
    waiting: (viewer && lobby.privateWaiting[viewer]) || lobby.waiting,
    talk: lobby.talk,
    judge: viewer && lobby.privateJudge[viewer]
      ? lobby.privateJudge[viewer]
      : lobby.judge,
    judgeHistory: viewer ? lobby.judgeHistory[viewer] : undefined,
    youAct: Boolean(viewer && priority === viewer),
    actions: viewer && lobby.actions[viewer]
      ? lobby.actions[viewer]
      : [],
    actionId: viewer ? lobby.actionIds[viewer] : undefined,
    topdeck: viewer && lobby.topdeck?.seat === viewer
      ? lobby.topdeck
      : undefined,
    alwaysStopOnPriority: viewer
      ? lobby.alwaysStopOnPriority[viewer]
      : undefined,
    holding: viewer ? lobby.holds[viewer] : undefined,
    events: options.events ?? [],
    turn: comparable.turn,
    phase: comparable.phase,
    active: comparable.active,
    stack: comparable.stack,
    seats,
    catalog: {},
    history: options.history,
    historyCursor: options.historyCursor,
    replica: state,
  }
}

export const historyFrameFromState = (
  state: GameState,
  lobby: LobbyState,
  viewer: SeatId | null,
  summary: string,
): LiveHistoryFrame => {
  const comparable = replayComparableState(state)
  return {
    seq: 0,
    summary,
    turn: comparable.turn,
    phase: comparable.phase,
    active: comparable.active,
    seats: liveSeatsFromState(state, lobby, viewer),
  }
}
