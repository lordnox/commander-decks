import { swampCount } from '../../plugins/swampOverlay'
import { lifeLostThisTurn } from '../../plugins/life'
import { initiateDiscard } from '../../rules/discard'
import { registerDelayedTrigger } from '../../rules/delayedTriggers'
import { openPlayerSelection } from '../../rules/selectPlayers'
import { openCumulativeUpkeep } from '../cumulativeUpkeep'
import {
  addTypes,
  animateUntilEndOfTurn,
  changeStatsUntilEndOfTurn,
  grantOracleLineUntilEndOfTurn,
  untilEndOfTurn,
} from '../continuousEffects'
import { addPlusCounters as applyPlusCounters, manaValueOf } from '../effects'
import { discardSeatFor, instructionAmount } from './helpers'
import type { InstructionHandler, InstructionHandlers } from './types'

const tap: InstructionHandler<'tap'> = ({ draft, source }) => {
  draft.enqueue({ type: 'tap', objectId: source.id })
}

const payMana: InstructionHandler<'payMana'> = ({ draft, source }, instruction) => {
  draft.enqueue({ type: 'payMana', seat: source.controller, cost: instruction.cost })
}

const addMana: InstructionHandler<'addMana'> = ({ draft, source }, instruction) => {
  draft.enqueue({ type: 'addMana', seat: source.controller, mana: instruction.mana })
}

const draw: InstructionHandler<'draw'> = ({ draft, source, buffer }, instruction) => {
  const seat = instruction.seat ?? source.controller
  if (buffer) {
    buffer.push({ kind: 'draw', remaining: instruction.count, seat })
    return
  }
  draft.enqueue({ type: 'draw', seat, count: instruction.count })
}

const discardCards: InstructionHandler<'discardCards'> = (
  { draft, source, item, buffer },
  instruction,
) => {
  const seat = discardSeatFor(source, item, instruction.who)
  if (buffer) {
    buffer.push({ kind: 'discard', count: instruction.count, who: instruction.who })
    return
  }
  initiateDiscard(draft, {
    seat,
    count: instruction.count,
    chooser: seat,
    sourceId: source.id,
    name: source.name,
  })
}

const gainLife: InstructionHandler<'gainLife'> = ({ draft, source, item }, instruction) => {
  draft.enqueue({
    type: 'gainLife',
    seat: source.controller,
    amount: instructionAmount(instruction.count, item),
    source: source.id,
  })
}

const cumulativeUpkeepOpponentLife: InstructionHandler<'cumulativeUpkeepOpponentLife'> = (
  { draft, source },
) => {
  openCumulativeUpkeep(draft, source.id)
}

const drainOpponentsX: InstructionHandler<'drainOpponentsX'> = (
  { draft, source, item },
  instruction,
) => {
  const amount = Math.max(0, item?.x ?? 0) * instruction.multiplier
  const opponents = draft.playerOrder.filter(
    (seat) => seat !== source.controller && !draft.players[seat].lost,
  )
  draft.enqueue({
    type: 'gainLife',
    seat: source.controller,
    amount: amount * opponents.length,
    source: source.id,
  })
  for (const seat of opponents) {
    draft.enqueue({ type: 'loseLife', seat, amount, source: source.id })
  }
}

const drawX: InstructionHandler<'drawX'> = ({ draft, source, item }) => {
  draft.enqueue({
    type: 'draw',
    seat: source.controller,
    count: Math.max(0, item?.x ?? 0),
  })
}

const setAllLifeToLowest: InstructionHandler<'setAllLifeToLowest'> = ({ draft, source }) => {
  const living = draft.playerOrder.filter((seat) => !draft.players[seat].lost)
  const lowest = Math.min(...living.map((seat) => draft.players[seat].life))
  for (const seat of living) {
    draft.enqueue({ type: 'setLifeTotal', seat, total: lowest, source: source.id })
  }
}

const gainLifeLostThisTurn: InstructionHandler<'gainLifeLostThisTurn'> = (
  { draft, source },
  instruction,
) => {
  const seats = instruction.who === 'all' ? draft.playerOrder : [source.controller]
  const amount = seats.reduce(
    (total, seat) => total + lifeLostThisTurn(draft.players[seat]),
    0,
  )
  draft.enqueue({
    type: 'gainLife',
    seat: source.controller,
    amount,
    source: source.id,
  })
}

const exchangeLifeWithOpponent: InstructionHandler<'exchangeLifeWithOpponent'> = (
  { draft, source, item },
  instruction,
) => {
  const target = item?.targets[0]
  if (target?.kind === 'player' && !instruction.optional) {
    const lifeLost = Math.max(
      0,
      draft.players[source.controller].life - draft.players[target.player].life,
    )
    draft.enqueue({
      type: 'exchangeLifeTotals',
      first: source.controller,
      second: target.player,
      source: source.id,
    })
    if (instruction.drawLifeLost && lifeLost > 0) {
      draft.enqueue({ type: 'draw', seat: source.controller, count: lifeLost })
    }
    return
  }
  const candidates = target?.kind === 'player'
    ? [target.player]
    : draft.playerOrder.filter(
      (seat) => seat !== source.controller && !draft.players[seat].lost,
    )
  openPlayerSelection(draft, {
    seat: source.controller,
    sourceId: source.id,
    source: source.name,
    prompt: instruction.optional
      ? 'You may exchange life totals with target opponent.'
      : 'Choose an opponent to exchange life totals with.',
    min: instruction.optional ? 0 : 1,
    max: 1,
    candidates,
    action: {
      kind: 'exchangeLifeTotals',
      ...(instruction.drawLifeLost ? { drawLifeLost: true } : {}),
    },
  })
}

const winGame: InstructionHandler<'winGame'> = ({ draft, source }) => {
  draft.enqueue({ type: 'winGame', seat: source.controller, source: source.id })
}

const addPlusCounters: InstructionHandler<'addPlusCounters'> = (
  { draft, item },
  instruction,
) => {
  const target = item?.targets[0]
  const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
  if (object) applyPlusCounters(object, instruction.count)
}

const doublePlusCounters: InstructionHandler<'doublePlusCounters'> = ({ draft, source }) => {
  const live = draft.object(source.id)
  if (!live) return
  applyPlusCounters(live, live.counters['+1/+1'] ?? 0)
  draft.note(`${live.name} doubles to ${live.counters['+1/+1'] ?? 0} +1/+1 counters`)
}

const loseLife: InstructionHandler<'loseLife'> = ({ draft, source, item }, instruction) => {
  const seat = instruction.who === 'controller'
    ? source.controller
    : typeof item?.payload?.triggeringPlayer === 'string'
      ? item.payload.triggeringPlayer
      : source.controller
  draft.enqueue({
    type: 'loseLife',
    seat,
    amount: instructionAmount(instruction.amount, item),
    source: source.id,
  })
}

const loseLifeTargetPlayer: InstructionHandler<'loseLifeTargetPlayer'> = (
  { draft, source, item },
  instruction,
) => {
  const target = item?.targets[0]
  if (target?.kind === 'player') {
    draft.enqueue({
      type: 'loseLife',
      seat: target.player,
      amount: instruction.amount,
      source: source.id,
    })
  }
}

const loseLifeTargetManaValue: InstructionHandler<'loseLifeTargetManaValue'> = (
  { draft, source, item },
) => {
  const target = item?.targets[0]
  if (target?.kind !== 'object') return
  const object = draft.object(target.objectId)
  if (!object) return
  const amount = manaValueOf(object)
  if (amount > 0) {
    draft.enqueue({
      type: 'loseLife',
      seat: source.controller,
      amount,
      source: source.id,
    })
  }
}

const loseLifeTargetController: InstructionHandler<'loseLifeTargetController'> = (
  { draft, source, item },
  instruction,
) => {
  const target = item?.targets[0]
  if (target?.kind !== 'object') return
  const object = draft.object(target.objectId)
  if (!object) return
  draft.enqueue({
    type: 'loseLife',
    seat: object.controller,
    amount: instruction.amount,
    source: source.id,
  })
}

const pump: InstructionHandler<'pump'> = ({ draft, item }, instruction) => {
  const target = item?.targets[0]
  const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
  if (!object || object.power === null || object.toughness === null) return
  changeStatsUntilEndOfTurn(object, instruction.power, instruction.toughness)
}

const pumpTargetX: InstructionHandler<'pumpTargetX'> = ({ draft, item }, instruction) => {
  const target = item?.targets[0]
  const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
  if (!object || object.power === null || object.toughness === null) return
  const amount = Math.max(0, item?.x ?? 0) * instruction.multiplier
  changeStatsUntilEndOfTurn(object, amount, amount)
}

const pumpSelf: InstructionHandler<'pumpSelf'> = ({ draft, source }, instruction) => {
  const object = draft.object(source.id)
  if (!object || object.power === null || object.toughness === null) return
  changeStatsUntilEndOfTurn(object, instruction.power, instruction.toughness)
}

const animateUntilEot: InstructionHandler<'animateUntilEot'> = (
  { draft, source },
  instruction,
) => {
  const object = draft.object(source.id)
  if (!object || object.zone !== 'battlefield') return
  animateUntilEndOfTurn(object, instruction.power, instruction.toughness)
}

const grantUntilEot: InstructionHandler<'grantUntilEot'> = (
  { draft, item },
  instruction,
) => {
  const target = item?.targets[0]
  const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
  if (!object) return
  for (const keyword of instruction.keywords) {
    grantOracleLineUntilEndOfTurn(object, keyword)
  }
}

const crewVehicle: InstructionHandler<'crewVehicle'> = ({ draft, source }) => {
  const vehicle = draft.object(source.id)
  if (!vehicle || vehicle.zone !== 'battlefield') return
  untilEndOfTurn(vehicle, addTypes(vehicle, 'Artifact', 'Creature'))
}

const untapTarget: InstructionHandler<'untapTarget'> = ({ draft, item }) => {
  const target = item?.targets[0]
  if (target?.kind === 'object') {
    draft.enqueue({ type: 'untap', objectId: target.objectId })
  }
}

const addManaPerSwamp: InstructionHandler<'addManaPerSwamp'> = (
  { draft, source },
  instruction,
) => {
  const count = swampCount(draft, source.controller, instruction.basic)
  if (count > 0) {
    draft.enqueue({ type: 'addMana', seat: source.controller, mana: { B: count } })
  }
}

const gainLifeTargetPower: InstructionHandler<'gainLifeTargetPower'> = (
  { draft, source, item },
) => {
  const target = item?.targets[0]
  const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
  const amount = object?.power ?? 0
  if (amount > 0) {
    draft.enqueue({
      type: 'gainLife',
      seat: source.controller,
      amount,
      source: source.id,
    })
  }
}

const addUntilCleanupRule: InstructionHandler<'addUntilCleanupRule'> = (
  { draft, source },
  instruction,
) => {
  draft.enqueue({
    type: 'addRule',
    pluginId: instruction.pluginId,
    params: { untilCleanup: true, controller: source.controller, ...instruction.params },
  })
}

const addChosenColorMana: InstructionHandler<'addChosenColorMana'> = (
  { draft, source, item },
) => {
  const choice = item?.choices?.[0]
  if (choice && ['W', 'U', 'B', 'R', 'G'].includes(choice)) {
    draft.enqueue({
      type: 'addMana',
      seat: source.controller,
      mana: { [choice]: 1 },
    })
  }
}

const drawAtNextUpkeep: InstructionHandler<'drawAtNextUpkeep'> = (
  { draft, source, item },
  instruction,
) => {
  const seat = instruction.who === 'you'
    ? source.controller
    : item?.targets[0]?.kind === 'object'
      ? draft.object(item.targets[0].objectId)?.controller
      : item?.targets[0]?.kind === 'player'
        ? item.targets[0].player
        : undefined
  if (!seat) return
  // "At the beginning of the next upkeep" is whichever upkeep comes first, not the drawer's.
  registerDelayedTrigger(
    draft,
    source,
    { kind: 'step', step: 'upkeep' },
    [{
      kind: instruction.optional ? 'mayDraw' : 'draw',
      count: instruction.count,
      seat,
    }],
  )
}

const drawGreatestPower: InstructionHandler<'drawGreatestPower'> = (
  { draft, source },
  instruction,
) => {
  const greatest = Math.max(0, ...Object.values(draft.objects)
    .filter((object) =>
      object.zone === 'battlefield'
      && object.controller === source.controller
      && object.types.includes('Creature')
      && (!instruction.nonHuman || !object.subtypes.includes('Human')))
    .map((object) => object.power ?? 0))
  if (greatest > 0) {
    draft.enqueue({ type: 'draw', seat: source.controller, count: greatest })
  }
}

const pumpControlled: InstructionHandler<'pumpControlled'> = (
  { draft, source },
  instruction,
) => {
  const bonus = instruction.powerFromGreatest
    ? Math.max(0, ...Object.values(draft.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && object.controller === source.controller
        && object.types.includes('Creature'))
      .map((object) => object.power ?? 0))
    : instruction.power
  const toughnessBonus = instruction.powerFromGreatest ? bonus : instruction.toughness
  for (const object of Object.values(draft.objects)) {
    if (object.zone !== 'battlefield' || object.controller !== source.controller) continue
    if (!object.types.includes('Creature')) continue
    if (instruction.other && object.id === source.id) continue
    if (instruction.nonHuman && object.subtypes.includes('Human')) continue
    changeStatsUntilEndOfTurn(object, bonus, toughnessBonus)
    if (instruction.trample) grantOracleLineUntilEndOfTurn(object, 'Trample')
  }
}

const grantControlled: InstructionHandler<'grantControlled'> = (
  { draft, source },
  instruction,
) => {
  for (const object of Object.values(draft.objects)) {
    if (object.zone !== 'battlefield' || object.controller !== source.controller) continue
    if (!object.types.includes('Creature')) continue
    if (instruction.other && object.id === source.id) continue
    if (instruction.nonHuman && object.subtypes.includes('Human')) continue
    for (const keyword of instruction.keywords) {
      grantOracleLineUntilEndOfTurn(object, keyword)
    }
  }
}

export const resourceHandlers = {
  tap,
  payMana,
  addMana,
  draw,
  discardCards,
  gainLife,
  cumulativeUpkeepOpponentLife,
  drainOpponentsX,
  drawX,
  setAllLifeToLowest,
  gainLifeLostThisTurn,
  exchangeLifeWithOpponent,
  winGame,
  addPlusCounters,
  doublePlusCounters,
  loseLife,
  loseLifeTargetPlayer,
  loseLifeTargetManaValue,
  loseLifeTargetController,
  pump,
  pumpTargetX,
  pumpSelf,
  animateUntilEot,
  grantUntilEot,
  crewVehicle,
  untapTarget,
  addManaPerSwamp,
  gainLifeTargetPower,
  addUntilCleanupRule,
  addChosenColorMana,
  drawAtNextUpkeep,
  drawGreatestPower,
  pumpControlled,
  grantControlled,
} satisfies Partial<InstructionHandlers>
