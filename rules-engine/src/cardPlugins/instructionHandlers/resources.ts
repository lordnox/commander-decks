import type Draft from '../../draft'
import type { PlayerId } from '../../types'
import { swampCount } from '../../plugins/swampOverlay'
import { lifeLostThisTurn } from '../../plugins/life'
import { openFreeCast } from '../../plugins/rebound'
import { initiateDiscard } from '../../rules/discard'
import { openCardSelection } from '../../rules/selectCards'
import { registerDelayedTrigger } from '../../rules/delayedTriggers'
import { openPlayerSelection } from '../../rules/selectPlayers'
import { openCumulativeUpkeep } from '../cumulativeUpkeep'
import {
  addTypes,
  animateUntilEndOfTurn,
  changeStatsUntilEndOfTurn,
  goadPermanent,
  goadUntilEndOfTurn,
  grantOracleLineUntilEndOfTurn,
  pumpWhileSourceOnBattlefield,
  untilEndOfTurn,
} from '../continuousEffects'
import { addPlusCounters as applyPlusCounters, manaValueOf } from '../effects'
import { matchesTargetFilter } from '../targetedResolve'
import type { GameState } from '../../types'
import { discardSeatFor, instructionAmount } from './helpers'
import type { InstructionHandler, InstructionHandlers } from './types'

const tap: InstructionHandler<'tap'> = ({ draft, source }) => {
  draft.enqueue({ type: 'tap', objectId: source.id })
}

const payMana: InstructionHandler<'payMana'> = ({ draft, source }, instruction) => {
  draft.enqueue({ type: 'payMana', seat: source.controller, cost: instruction.cost })
}

const getEnergy: InstructionHandler<'getEnergy'> = ({ draft, source }, instruction) => {
  draft.enqueue({
    type: 'addEnergy',
    seat: source.controller,
    amount: instruction.count,
    source: source.id,
  })
}

const payEnergyInstruction: InstructionHandler<'payEnergy'> = ({ draft, source }, instruction) => {
  draft.enqueue({
    type: 'payEnergy',
    seat: source.controller,
    amount: instruction.count,
    source: source.id,
  })
}

const addMana: InstructionHandler<'addMana'> = ({ draft, source }, instruction) => {
  draft.enqueue({ type: 'addMana', seat: source.controller, mana: instruction.mana })
}

const draw: InstructionHandler<'draw'> = ({ draft, source, item, buffer }, instruction) => {
  const seat = instruction.who === 'target'
    ? discardSeatFor(source, item, 'target')
    : instruction.seat
      ?? (instruction.who === 'triggeringPlayer'
        && typeof item?.payload?.triggeringPlayer === 'string'
        ? item.payload.triggeringPlayer
        : source.controller)
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
  if (instruction.optional || instruction.then) {
    const candidates = draft.zoneOrder[seat].hand
    if (candidates.length === 0) return
    openCardSelection(draft, {
      seat,
      kind: 'discard',
      count: instruction.count,
      min: instruction.optional ? 0 : Math.min(instruction.count, candidates.length),
      candidates,
      sourceId: source.id,
      source: source.name,
      prompt: instruction.optional
        ? instruction.count === 1
          ? 'You may discard a card.'
          : `You may discard ${instruction.count} cards.`
        : instruction.count === 1
          ? `${source.name} makes you discard a card. Choose one.`
          : `${source.name} makes you discard ${instruction.count} cards. Choose ${instruction.count}.`,
      destinations: ['graveyard'],
      fromSeat: seat,
      ...(instruction.then ? { reflexive: instruction.then } : {}),
    })
    return
  }
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

const handDifferenceDrawCount = (
  draft: Draft,
  controller: PlayerId,
  opponent: PlayerId,
) => Math.max(
  0,
  draft.zoneOrder[opponent].hand.length - draft.zoneOrder[controller].hand.length,
)

const drawHandDifference: InstructionHandler<'drawHandDifference'> = (
  { draft, source, item },
) => {
  const target = item?.targets[0]
  if (target?.kind === 'player') {
    const count = handDifferenceDrawCount(draft, source.controller, target.player)
    if (count > 0) {
      draft.enqueue({ type: 'draw', seat: source.controller, count })
    }
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
    prompt: 'Choose an opponent.',
    min: 1,
    max: 1,
    candidates,
    action: { kind: 'drawHandDifference' },
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
  { draft, source, item },
  instruction,
) => {
  const target = item?.targets[0]
  const object = target?.kind === 'object'
    ? draft.object(target.objectId)
    : draft.object(source.id)
  if (object) applyPlusCounters(object, instruction.count)
}

const putChargeCountersFromTimesKicked: InstructionHandler<'putChargeCountersFromTimesKicked'> = ({
  draft,
  source,
  item,
}) => {
  const live = draft.object(source.id)
  if (!live) return
  const count = live.enteredWithTimesKicked
    ?? (item ? (item.timesKicked ?? (item.kicked ? 1 : 0)) : 0)
  if (count <= 0) return
  live.counters.charge = (live.counters.charge ?? 0) + count
  draft.note(`${live.name} enters with ${count} charge counter${count === 1 ? '' : 's'}`)
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
  const amount = instruction.amount || Math.max(0, item?.x ?? 0)
  if (target?.kind === 'player') {
    draft.enqueue({
      type: 'loseLife',
      seat: target.player,
      amount,
      source: source.id,
    })
    return
  }
  const candidates = draft.playerOrder.filter((seat) => !draft.players[seat].lost)
  if (candidates.length === 0 || amount <= 0) return
  openPlayerSelection(draft, {
    seat: source.controller,
    sourceId: source.id,
    source: source.name,
    prompt: `Choose a player to lose ${amount} life.`,
    min: 1,
    max: 1,
    candidates,
    action: {
      kind: 'putTriggeredAbility',
      triggeringPlayer: source.controller,
      instructions: [{ kind: 'loseLifeTargetPlayer', amount: instruction.amount }],
      x: item?.x,
    },
  })
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

const battlefieldCreatures = (
  draft: Parameters<InstructionHandler<'pumpTargetX'>>[0]['draft'],
) => Object.values(draft.objects)
  .filter((object) => object.zone === 'battlefield' && object.types.includes('Creature'))
  .map((object) => object.id)

const pumpTargetX: InstructionHandler<'pumpTargetX'> = ({ draft, source, item }, instruction) => {
  const target = item?.targets.find((candidate) => candidate.kind === 'object')
  const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
  const x = Math.max(0, item?.x ?? 0)
  if (!object || object.power === null || object.toughness === null) {
    const optionalCastChoseNone = Boolean(item)
      && (source.effects ?? []).some((effect) =>
        effect.op === 'targetedResolve' && effect.optional)
      && !item.targets.some((candidate) => candidate.kind === 'object')
    if (optionalCastChoseNone) return
    if (item?.targets.some((candidate) => candidate.kind === 'object')) return
    const candidates = battlefieldCreatures(draft)
    if (candidates.length === 0 || x <= 0) return
    openCardSelection(draft, {
      seat: source.controller,
      kind: 'choose',
      count: 1,
      min: 1,
      candidates,
      sourceId: source.id,
      source: source.name,
      prompt: `Choose a creature to get ${instruction.multiplier * x}/${(instruction.toughnessMultiplier ?? instruction.multiplier) * x} until end of turn.`,
      destinations: ['target'],
      triggerInstructions: [instruction],
      triggerX: x,
    })
    return
  }
  const amount = x * instruction.multiplier
  const toughness = x * (instruction.toughnessMultiplier ?? instruction.multiplier)
  changeStatsUntilEndOfTurn(object, amount, toughness)
}

const pumpSelf: InstructionHandler<'pumpSelf'> = ({ draft, source }, instruction) => {
  const object = draft.object(source.id)
  if (!object || object.power === null || object.toughness === null) return
  changeStatsUntilEndOfTurn(object, instruction.power, instruction.toughness)
}

const animateUntilEot: InstructionHandler<'animateUntilEot'> = (
  { draft, source, item },
  instruction,
) => {
  const object = draft.object(source.id)
  if (!object || object.zone !== 'battlefield') return
  const amount = instruction.fromX ? Math.max(0, item?.x ?? 0) : instruction.power
  const toughness = instruction.fromX ? amount : instruction.toughness
  if (instruction.fromX && amount < 1) return
  animateUntilEndOfTurn(object, amount, toughness)
}

const attachedCreature = (
  draft: Parameters<InstructionHandler<'tapAttached'>>[0]['draft'],
  source: Parameters<InstructionHandler<'tapAttached'>>[0]['source'],
) => {
  const aura = draft.object(source.id) ?? source
  const attachedId = aura.attachedTo
  return typeof attachedId === 'string' ? draft.object(attachedId) : undefined
}

const pumpAttached: InstructionHandler<'pumpAttached'> = (
  { draft, source },
  instruction,
) => {
  const creature = attachedCreature(draft, source)
  if (!creature || creature.zone !== 'battlefield') return
  pumpWhileSourceOnBattlefield(creature, instruction.power, instruction.toughness, source.id)
}

const tapAttached: InstructionHandler<'tapAttached'> = ({ draft, source }) => {
  const creature = attachedCreature(draft, source)
  if (creature && creature.zone === 'battlefield') {
    draft.enqueue({ type: 'tap', objectId: creature.id })
  }
}

const landCount = (
  draft: Parameters<InstructionHandler<'addPlusCountersEqualToLands'>>[0]['draft'],
  seat: string,
) => Object.values(draft.objects).filter((object) =>
  object.zone === 'battlefield'
  && object.controller === seat
  && object.types.includes('Land')).length

const addPlusCountersEqualToLands: InstructionHandler<'addPlusCountersEqualToLands'> = (
  { draft, source, item },
) => {
  const target = item?.targets[0]
  const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
  const count = landCount(draft, source.controller)
  if (object && count > 0) applyPlusCounters(object, count)
}

const pumpTargetEqualToLands: InstructionHandler<'pumpTargetEqualToLands'> = (
  { draft, source, item },
  instruction,
) => {
  const target = item?.targets[0]
  const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
  const amount = landCount(draft, source.controller)
  if (!object || object.power === null || object.toughness === null) {
    const candidates = Object.values(draft.objects)
      .filter((entry) =>
        entry.zone === 'battlefield'
        && entry.controller === source.controller
        && entry.types.includes('Creature'))
      .map((entry) => entry.id)
    if (candidates.length === 0 || amount <= 0) return
    openCardSelection(draft, {
      seat: source.controller,
      kind: 'choose',
      count: 1,
      min: 1,
      candidates,
      sourceId: source.id,
      source: source.name,
      prompt: `Choose a creature you control to get +${amount}/+${amount}${instruction.trample ? ' and trample' : ''} until end of turn.`,
      destinations: ['target'],
      triggerInstructions: [
        { kind: 'addPlusCountersEqualToLands' },
        { kind: 'pumpTargetEqualToLands', trample: instruction.trample },
      ],
    })
    return
  }
  changeStatsUntilEndOfTurn(object, amount, amount)
  if (instruction.trample) grantOracleLineUntilEndOfTurn(object, 'Trample')
}

const untapUpToLands: InstructionHandler<'untapUpToLands'> = (
  { draft, source },
  instruction,
) => {
  const candidates = Object.values(draft.objects)
    .filter((object) =>
      object.zone === 'battlefield'
      && object.controller === source.controller
      && object.types.includes('Land')
      && object.tapped)
    .map((object) => object.id)
  if (candidates.length === 0) return
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'choose',
    count: Math.min(instruction.count, candidates.length),
    min: 0,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: `Untap up to ${instruction.count} land(s).`,
    destinations: ['target'],
    untapSelected: true,
  })
}

const grantUntilEot: InstructionHandler<'grantUntilEot'> = (
  { draft, source, item },
  instruction,
) => {
  const x = Math.max(0, item?.x ?? 0)
  if (instruction.maxFromX) {
    const candidates = battlefieldCreatures(draft)
    if (candidates.length === 0 || x <= 0) return
    openCardSelection(draft, {
      seat: source.controller,
      kind: 'choose',
      count: x,
      min: 0,
      candidates,
      sourceId: source.id,
      source: source.name,
      prompt: `Choose up to ${x} creature(s) to gain ${instruction.keywords.join(', ')} until end of turn.`,
      destinations: ['target'],
      grantKeywordsUntilEot: instruction.keywords,
    })
    return
  }
  const target = item?.targets[0]
  const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
  if (!object) return
  for (const keyword of instruction.keywords) {
    grantOracleLineUntilEndOfTurn(object, keyword)
  }
}

const goadTargets: InstructionHandler<'goadTargets'> = (
  { draft, source, item },
  instruction,
) => {
  const apply = instruction.untilEndOfTurn ? goadUntilEndOfTurn : goadPermanent
  for (const target of item?.targets ?? []) {
    if (target.kind !== 'object') continue
    const object = draft.object(target.objectId)
    if (!object || !object.types.includes('Creature') || object.zone !== 'battlefield') continue
    apply(object, source.controller)
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

const tapAll: InstructionHandler<'tapAll'> = ({ draft, source, item }, instruction) => {
  const filter = instruction.filter.zone ?? instruction.filter.zones
    ? instruction.filter
    : { ...instruction.filter, zone: 'battlefield' as const }
  const state = draft as GameState
  for (const object of Object.values(draft.objects)) {
    if (!matchesTargetFilter(state, object, filter, source.controller, item?.castOption)) continue
    draft.enqueue({ type: 'tap', objectId: object.id })
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

const gainLifeTargetToughness: InstructionHandler<'gainLifeTargetToughness'> = (
  { draft, source, item },
) => {
  const target = item?.targets[0]
  const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
  const amount = object?.toughness ?? 0
  if (amount > 0) {
    draft.enqueue({
      type: 'gainLife',
      seat: object?.controller ?? source.controller,
      amount,
      source: source.id,
    })
  }
}

const loseHalfLifeRoundedUp: InstructionHandler<'loseHalfLifeRoundedUp'> = (
  { draft, source },
) => {
  const life = draft.players[source.controller]?.life ?? 0
  const amount = Math.ceil(life / 2)
  if (amount > 0) {
    draft.enqueue({
      type: 'loseLife',
      seat: source.controller,
      amount,
      source: source.id,
    })
  }
}

const addManaAtNextMainFromTarget: InstructionHandler<'addManaAtNextMainFromTarget'> = (
  { draft, source, item },
) => {
  const target = item?.targets[0]
  const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
  const amount = object ? manaValueOf(object) : 0
  if (amount <= 0) return
  registerDelayedTrigger(
    draft,
    source,
    { kind: 'step', step: ['precombatMain', 'postcombatMain'], active: source.controller },
    [{ kind: 'addMana', mana: { C: amount } }],
  )
}

const addPlusCountersToControlled: InstructionHandler<'addPlusCountersToControlled'> = (
  { draft, source },
  instruction,
) => {
  const candidates = Object.values(draft.objects)
    .filter((object) =>
      object.zone === 'battlefield'
      && object.controller === source.controller
      && object.types.includes('Creature'))
    .map((object) => object.id)
  if (candidates.length === 0) return
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'choose',
    count: 1,
    min: 1,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: `Put ${instruction.count} +1/+1 counter(s) on a creature you control.`,
    destinations: ['target'],
    plusCounters: instruction.count,
  })
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

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const

const addChosenColorMana: InstructionHandler<'addChosenColorMana'> = (
  { draft, source, item },
  instruction,
) => {
  const allowed = instruction.colors ?? COLORS
  const choice = item?.choices?.[0]
  if (choice && allowed.includes(choice as typeof COLORS[number])) {
    draft.enqueue({
      type: 'addMana',
      seat: source.controller,
      mana: { [choice]: 1 },
    })
  }
}

const delay: InstructionHandler<'delay'> = (
  { draft, source, item },
  instruction,
) => {
  const targetId = instruction.bindTarget
    ? item?.targets.find((target) => target.kind === 'object')?.objectId
    : undefined
  if (instruction.bindTarget && !targetId) return
  const condition = instruction.condition.kind === 'event' && targetId
    ? { ...instruction.condition, objectId: targetId }
    : instruction.condition
  const steps = instruction.do.map((step) =>
    step.kind === 'returnToOwnersControl' && !step.objectId && targetId
      ? { ...step, objectId: targetId }
      : step)
  registerDelayedTrigger(draft, source, condition, steps, {
    untilCleanup: instruction.untilCleanup,
  })
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

const mayCastFromExileWithoutPayingMana:
InstructionHandler<'mayCastFromExileWithoutPayingMana'> = ({ draft, source }) => {
  openFreeCast(draft, source)
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
  { draft, source, item },
  instruction,
) => {
  const bonus = instruction.fromStackX
    ? Math.max(0, item?.x ?? 0)
    : instruction.powerFromGreatest
      ? Math.max(0, ...Object.values(draft.objects)
        .filter((object) =>
          object.zone === 'battlefield'
          && object.controller === source.controller
          && object.types.includes('Creature'))
        .map((object) => object.power ?? 0))
      : instruction.power
  const toughnessBonus = instruction.fromStackX || instruction.powerFromGreatest
    ? bonus
    : instruction.toughness
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
  getEnergy,
  payEnergy: payEnergyInstruction,
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
  drawHandDifference,
  winGame,
  addPlusCounters,
  putChargeCountersFromTimesKicked,
  doublePlusCounters,
  loseLife,
  loseLifeTargetPlayer,
  loseLifeTargetManaValue,
  loseLifeTargetController,
  pump,
  pumpTargetX,
  pumpSelf,
  animateUntilEot,
  pumpAttached,
  tapAttached,
  addPlusCountersEqualToLands,
  pumpTargetEqualToLands,
  untapUpToLands,
  grantUntilEot,
  goadTargets,
  crewVehicle,
  untapTarget,
  tapAll,
  addManaPerSwamp,
  gainLifeTargetPower,
  gainLifeTargetToughness,
  loseHalfLifeRoundedUp,
  addManaAtNextMainFromTarget,
  addPlusCountersToControlled,
  addUntilCleanupRule,
  addChosenColorMana,
  delay,
  drawAtNextUpkeep,
  mayCastFromExileWithoutPayingMana,
  drawGreatestPower,
  pumpControlled,
  grantControlled,
} satisfies Partial<InstructionHandlers>
