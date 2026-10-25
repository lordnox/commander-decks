import { objectIdentity } from '../objectIdentity'
import { STEP_IDS } from '../types'
import { activePrintedStaticModifiers } from '../cardPlugins/dsl/staticModifierCore'
import { emptyMana, nextPlayer, type Draft } from '../draft'
import { strikesFirst } from '../keywords'
import type { GameState, HookCtx, PlayerId, Plugin, StepId } from '../types'
import { clearPutIntoGraveyardFromBattlefieldThisTurn } from './fromBattlefieldThisTurn'
import { LEGENDARY_COMBAT_DAMAGE_FROM } from './combatLegendaryDamage'
import { clearDamageDealt } from './damageLedger'
import { LIFE_GAINED_THIS_TURN, LIFE_LOST_THIS_TURN } from './life'
import { phaseInControlledBeforeUntap } from './phasing'
import { clearAttackBans } from '../cardPlugins/attackBan'
import { CARDS_DRAWN_THIS_TURN } from '../rules/draw'
import { SPELLS_CAST_THIS_TURN } from '../rules/spellsCast'
import { beginDrawStepInstance } from '../rules/drawStepHistory'
import { otherPlayerDrawSeats, otherPlayerUntapParticipants } from '../cardPlugins/dsl/untapParticipation'
import { untapPermanent, untapStepUntaps } from '../rules/untap'

export const STEPS: StepId[] = [...STEP_IDS]

export const nextLivingPlayer = (draft: Draft, from: PlayerId) => {
  let player = nextPlayer(draft, from)
  for (let i = 0; i < draft.playerOrder.length; i += 1) {
    if (!draft.players[player].lost) return player
    player = nextPlayer(draft, player)
  }
  return nextPlayer(draft, from)
}

export const emptyAllManaPools = (draft: Draft) => {
  for (const player of draft.playerOrder) {
    draft.players[player].mana = emptyMana()
    delete draft.players[player].restrictedMana
  }
}

/**
 * Permanent "no maximum hand size for the rest of the game". Kept apart from
 * `maximumHandSize` (the static grant that `noMaxHand` refreshes and clears).
 */
export const NO_MAXIMUM_HAND_SIZE = 'noMaximumHandSize'

export const maximumHandSize = (state: GameState, player: PlayerId) => {
  if (state.players[player].data[NO_MAXIMUM_HAND_SIZE] === true) return null
  const unlimited = Object.values(state.objects).some(source =>
    source.controller === player
    && activePrintedStaticModifiers(state, source).some(entry =>
      'effect' in entry && entry.effect.kind === 'noMaximumHandSize'))
  if (unlimited) return null
  const configured = state.players[player].data.maximumHandSize
  if (configured === null) return null
  return typeof configured === 'number' && Number.isSafeInteger(configured)
    ? Math.max(0, configured)
    : 7
}

const cleanupHandSizeError = (state: GameState) => {
  if (state.step !== 'cleanup') return
  const maximum = maximumHandSize(state, state.active)
  if (maximum === null) return
  const cards = state.zoneCounts[state.active].hand
  if (cards > maximum) {
    return `${state.active} must discard ${cards - maximum} card(s) before cleanup can end`
  }
}

const onUntap = (draft: Draft) => {
  phaseInControlledBeforeUntap(draft, draft.active)
  const otherUntaps = otherPlayerUntapParticipants(draft)
  for (const object of draft.zoneOf('battlefield', draft.active)) {
    untapStepUntaps(draft, object)
    object.summoningSickness = false
    object.loyaltyActivatedTurn = null
  }
  for (const object of otherUntaps) untapPermanent(draft, object)
  draft.players[draft.active].landsPlayed = 0
  // "this turn" counters start over for everyone, not just the active seat.
  for (const player of draft.playerOrder) {
    delete draft.players[player].data[LIFE_LOST_THIS_TURN]
    delete draft.players[player].data[LIFE_GAINED_THIS_TURN]
    delete draft.players[player].data[LEGENDARY_COMBAT_DAMAGE_FROM]
    delete draft.players[player].data[CARDS_DRAWN_THIS_TURN]
    delete draft.players[player].data[SPELLS_CAST_THIS_TURN]
  }
  clearPutIntoGraveyardFromBattlefieldThisTurn(draft)
  clearAttackBans(draft)
  draft.note(`${draft.active} untaps`)
}

const onDraw = (draft: Draft) => {
  beginDrawStepInstance(draft, draft.active)
  draft.enqueue({ type: 'draw', seat: draft.active, count: 1 })
  for (const seat of otherPlayerDrawSeats(draft)) {
    draft.enqueue({ type: 'draw', seat, count: 1 })
  }
}

/**
 * Combat damage is a turn-based action, not something a seat has to ask for.
 * It runs once per damage step; `combat` decides who deals damage in which.
 */
const onCombatDamage = (draft: Draft) => {
  if (draft.step === 'firstStrikeDamage') {
    draft.firstStrikeCombatants = draft.zoneOf('battlefield')
      .filter(object => object.attacking !== null || object.blocking !== null)
      .filter(strikesFirst)
      .map(objectIdentity)
  }
  const attacking = draft
    .zoneOf('battlefield')
    .some((object) => object.attacking !== null)
  if (attacking) draft.enqueue({ type: 'assignCombatDamage' })
}

const clearCombatParticipation = (draft: Draft) => {
  for (const object of draft.zoneOf('battlefield')) {
    object.attacking = null
    delete object.blocked
    object.blocking = null
  }
}

const onCleanup = (draft: Draft) => {
  delete draft.firstStrikeCombatants
  clearCombatParticipation(draft)
  for (const object of draft.zoneOf('battlefield')) {
    object.damageMarked = 0
    delete object.deathtouched
  }
  clearDamageDealt(draft)
  delete draft.resolvedRuleEffects
  draft.rules = draft.rules.filter((rule) => rule.params.untilCleanup !== true)
  draft.delayedTriggers = draft.delayedTriggers.filter((trigger) => !trigger.untilCleanup)
  draft.note('cleanup')
}

const enterStep = (draft: Draft, step: StepId) => {
  switch (step) {
    case 'beginCombat':
    case 'endCombat':
      delete draft.firstStrikeCombatants
      return
    case 'untap': return onUntap(draft)
    case 'draw': return onDraw(draft)
    case 'firstStrikeDamage':
    case 'combatDamage': return onCombatDamage(draft)
    case 'cleanup': return onCleanup(draft)
  }
}

const inCombat = (draft: Draft) =>
  draft.zoneOf('battlefield').filter(
    (object) => object.attacking !== null || object.blocking !== null,
  )

/**
 * A step nobody can use is still a full pass round for every seat, and the
 * rules skip both of these: no attackers means no blockers or damage steps,
 * and no first or double striker means no first strike damage step.
 */
const skipEmptyStep = (draft: Draft, step: StepId) => {
  const combatants = inCombat(draft)
  if (step === 'declareBlockers' && combatants.length === 0) return 'endCombat'
  if (step === 'firstStrikeDamage' && !combatants.some(strikesFirst)) return 'combatDamage'
  return step
}

/**
 * Move to the next step, wrapping cleanup into the next player's untap.
 * Every player-turn bumps `turn`. Exported so `priority` can advance when all
 * living players pass on an empty stack; `turnStructure` never imports back.
 */
export const advanceTurnStep = (draft: Draft) => {
  // CR 511.3: participation lasts through endCombat, then ends with the phase.
  if (draft.step === 'endCombat') clearCombatParticipation(draft)
  const index = STEPS.indexOf(draft.step)
  const wraps = index === STEPS.length - 1
  const step = skipEmptyStep(draft, STEPS[(index + 1) % STEPS.length])
  // Turn-based declarations belong to a step instance, including repeated combats.
  delete draft.attackersDeclared
  draft.step = step
  if (wraps) {
    let queued = draft.extraTurns?.shift()
    while (queued && draft.players[queued]?.lost) queued = draft.extraTurns?.shift()
    if (queued) {
      // CR 500.7: an extra turn is inserted after the current one without changing the normal turn order.
      draft.extraTurnsResumeAfter ??= draft.active
      draft.active = queued
    } else {
      draft.active = nextLivingPlayer(draft, draft.extraTurnsResumeAfter ?? draft.active)
      delete draft.extraTurnsResumeAfter
    }
    draft.turn += 1
  }
  enterStep(draft, step)
  draft.passedInRow = []
  draft.priority = draft.active
  draft.note(`step ${step} (turn ${draft.turn}, active ${draft.active})`)
}

const isAdvance = (event: HookCtx['event']) =>
  event.type === 'advanceStep' || (event.type === 'custom' && event.name === 'advanceStep')

const legal = ({ state, event }: HookCtx) => {
  if (!isAdvance(event)) return
  if (state.stack.length > 0) return 'cannot advance the step while the stack is not empty'
  return cleanupHandSizeError(state)
}

const replace = ({ event }: HookCtx) => {
  if (event.type !== 'advanceStep') return
  return [{ type: 'emptyManaPools' as const }, { type: 'custom' as const, name: 'advanceStep' }]
}

const apply = ({ event, draft }: HookCtx) => {
  if (isAdvance(event)) {
    advanceTurnStep(draft)
    return
  }
  if (event.type === 'emptyManaPools') emptyAllManaPools(draft)
  if (event.type === 'grantNoMaximumHandSize') {
    const player = draft.players[event.seat]
    if (!player) return
    player.data[NO_MAXIMUM_HAND_SIZE] = true
    draft.note(`${event.seat} has no maximum hand size for the rest of the game`)
  }
  if (event.type === 'takeExtraTurn' && draft.players[event.seat] && !draft.players[event.seat].lost) {
    // CR 500.7: the most recently created extra turn is taken first.
    draft.extraTurns = [event.seat, ...(draft.extraTurns ?? [])]
    draft.note(`${event.seat} will take an extra turn after this turn${event.source ? ` (${event.source})` : ''}`)
  }
}

export const turnStructure: Plugin = { id: 'turnStructure', legal, replace, apply }
