import { emptyMana, poolTotal } from './draft'
import { PERMANENT_TYPES } from './definitions'
import { manaModes, poolForChoice } from './plugins/mana'
import { payCost } from './plugins/spells'
import {
  canPayActivationCosts as canPayCardActivationCosts,
  crewCostCandidates,
  discardCostCandidates,
  needsActivationCostPicks,
  sacrificeCostCandidates,
} from './cardPlugins/activationCosts'
import { effectsOf } from './cardPlugins/cardRules'
import {
  activateEffect,
  conditionHolds,
  searchEffect,
  type ActivateCost,
} from './cardPlugins/effects'
import { SEARCH_FETCH } from './cardPlugins/librarySearch'
import { validTargetRef } from './cardPlugins/targetedResolve'
import { hasKeyword } from './keywords'
import { castFaceOf, landFaceOf } from './plugins/doubleFaced'
import { pendingExtortFor } from './cardPlugins/extort'
import {
  alternateCastEffects,
  canChooseAlternateCast,
} from './cardPlugins/alternateCosts'
import {
  attackTaxByDefender,
  blockTaxPerCreature,
  combatTaxAmount,
} from './cardPlugins/combatTax'
import {
  canSacrificeLandForBlack,
  SACRIFICE_LAND_FOR_BLACK,
} from './plugins/sacrificeLandMana'
import {
  pendingSelection,
  pendingSelectionFor,
  type CardSelectionKind,
  type PendingCardSelection,
} from './rules/selectCards'
import { pendingPlayerSelection } from './rules/selectPlayers'
import type {
  GameEvent,
  GameObject,
  GameState,
  ManaId,
  ManaPool,
  PlayerId,
  StackItem,
  AttackerDecl,
  BlockerDecl,
} from './types'

type ActionTargetGroup = {
  label: string
  min: number
  max: number
  kind?: 'object' | 'player'
  purpose?: 'target' | 'cost'
  targets: Array<{ objectId: string; name: string; controller: PlayerId }>
}

export type AvailableAction =
  | { kind: 'playLand'; objectId: string; name: string }
  | {
      kind: 'castSpell'
      objectId: string
      name: string
      targetObjectId?: string
      targetPlayerId?: string
      targetObjectIds?: string[]
      targetName?: string
      x?: number
      castOption?: string
      castLabel?: string
      targetGroups?: ActionTargetGroup[]
    }
  | {
      kind: 'activateAbility'
      objectId: string
      name: string
      text: string
      abilityId?: string
      targetObjectIds?: string[]
      targetGroups?: ActionTargetGroup[]
      mana?: ManaId
    }
  | { kind: 'tapForMana'; objectId: string; name: string; mana?: ManaId }
  | {
      kind: 'payExtort'
      triggerId: string
      sourceId: string
      source: string
      mana?: 'W' | 'B'
    }
  | {
      kind: 'declareAttackers'
      objectIds: string[]
      taxByDefender?: Record<string, number>
    }
  | {
      kind: 'declareBlockers'
      objectIds: string[]
      attackerIds: string[]
      taxPerBlocker?: number
    }
  | {
      kind: 'continueAction'
      stackId: string
      actionId: string
      objectIds: string[]
      count: number
    }
  | {
      kind: 'selectCards'
      selectionId: string
      cardKind: CardSelectionKind
      objectIds: string[]
      names: string[]
      count: number
      destinations?: string[]
    }
  | {
      kind: 'selectPlayers'
      selectionId: string
      players: PlayerId[]
      min: number
      max: number
    }

const MAIN_STEPS = new Set(['precombatMain', 'postcombatMain'])

export type WaitingDiscard = {
  item: StackItem
  chooser: PlayerId
  discardSeat: PlayerId
  handIds: string[]
  count: number
}

/** A discard action sitting on the stack until its chooser sends continueAction. */
export const waitingDiscard = (
  state: GameState,
  seat?: PlayerId,
): WaitingDiscard | null => {
  const item = state.stack[0]
  if (item?.kind !== 'action' || item.actionId !== 'discard' || item.waiting !== 'choice') {
    return null
  }
  const payload = item.payload
  if (!payload || typeof payload.seat !== 'string' || typeof payload.count !== 'number') {
    return null
  }
  const chooser = (typeof payload.chooser === 'string' ? payload.chooser : payload.seat) as PlayerId
  if (seat && seat !== chooser) return null
  const discardSeat = payload.seat as PlayerId
  const handIds = state.zoneOrder[discardSeat]?.hand ?? []
  return {
    item,
    chooser,
    discardSeat,
    handIds,
    count: Math.min(payload.count, handIds.length),
  }
}

export const waitingContinueAction = (
  state: GameState,
  seat: PlayerId,
): AvailableAction | null => {
  const waiting = waitingDiscard(state, seat)
  if (!waiting) return null
  return {
    kind: 'continueAction',
    stackId: waiting.item.id,
    actionId: 'discard',
    objectIds: waiting.handIds,
    count: waiting.count,
  }
}

export type WaitingSelectCards = {
  selection: PendingCardSelection
  objectIds: string[]
  names: string[]
  count: number
}

/** A typed card selection waiting for `selectCards` from the chooser seat. */
export const waitingSelectCards = (
  state: GameState,
  seat?: PlayerId,
): WaitingSelectCards | null => {
  const pending = seat ? pendingSelectionFor(state, seat) : pendingSelection(state)
  if (!pending || (seat && pending.seat !== seat)) return null

  const fromSeat = pending.fromSeat ?? pending.seat
  const objectIds = pending.candidates.filter((objectId) => {
    const object = state.objects[objectId]
    if (pending.kind === 'discard' || pending.kind === 'reveal') {
      return object?.zone === 'hand' && object.controller === fromSeat
    }
    if (pending.kind === 'sacrifice') {
      return object?.zone === 'battlefield'
        && object.controller === fromSeat
    }
    return Boolean(object)
  })

  return {
    selection: pending,
    objectIds,
    names: objectIds.map((objectId) => state.objects[objectId]?.name ?? ''),
    count: Math.min(pending.count, objectIds.length),
  }
}

export const waitingCardSelection = (
  state: GameState,
  seat: PlayerId,
): AvailableAction | null => {
  const waiting = waitingSelectCards(state, seat)
  if (!waiting) return null
  return {
    kind: 'selectCards',
    selectionId: waiting.selection.id,
    cardKind: waiting.selection.kind,
    objectIds: waiting.objectIds,
    names: waiting.names,
    count: waiting.count,
    destinations: waiting.selection.destinations,
  }
}

export const waitingPlayerSelection = (
  state: GameState,
  seat: PlayerId,
): AvailableAction | null => {
  const selection = pendingPlayerSelection(state, seat)
  if (!selection) return null
  return {
    kind: 'selectPlayers',
    selectionId: selection.id,
    players: selection.candidates.filter((player) => !state.players[player]?.lost),
    min: selection.min,
    max: selection.max,
  }
}

const DAMAGE_PENDING_STEPS = new Set([
  'declareAttackers',
  'declareBlockers',
  'firstStrikeDamage',
  'combatDamage',
])
const MANA_IDS: ManaId[] = ['W', 'U', 'B', 'R', 'G', 'C']

const addPool = (left: ManaPool, right: Partial<ManaPool>) => {
  const sum = { ...left }
  for (const mana of MANA_IDS) sum[mana] += right[mana] ?? 0
  return sum
}

const samePool = (left: Partial<ManaPool>, right?: Partial<ManaPool>) =>
  !!right && MANA_IDS.every((mana) => (left[mana] ?? 0) === (right[mana] ?? 0))

/**
 * The tapForMana choice that yields exactly `mode` from `source`, or null when
 * the reducer cannot be steered to that mode.
 */
const tapChoice = (
  state: GameState,
  source: GameObject,
  mode: Partial<ManaPool>,
): { mana?: ManaId } | null => {
  if (samePool(mode, poolForChoice(source, undefined, state))) return {}
  const mana = MANA_IDS.find((symbol) => (mode[symbol] ?? 0) > 0)
  if (mana && samePool(mode, poolForChoice(source, mana, state))) return { mana }
  return null
}

const sourceCanTap = (object: GameObject, seat: PlayerId, state: GameState) =>
  object.zone === 'battlefield'
  && object.controller === seat
  && !object.tapped
  && (
    !object.types.includes('Creature')
    || !object.summoningSickness
    || hasKeyword(object, 'haste', state)
  )

const poolKey = (pool: ManaPool, cap: number) =>
  MANA_IDS.map((mana) => Math.min(pool[mana], cap)).join(',')

const canFund = (state: GameState, seat: PlayerId, cost: string) => {
  const sources = Object.values(state.objects)
    .filter((object) => sourceCanTap(object, seat, state))
    .map((object) => manaModes(object, state))
    .filter((modes) => modes.length > 0)
  const cap = Math.max(
    1,
    [...cost.matchAll(/\{(\d+)\}/g)].reduce(
      (total, match) => total + Number(match[1]),
      [...cost.matchAll(/\{[WUBRGC](?:\/[WUBRGC])?\}/g)].length,
    ),
  )
  let pools = [state.players[seat]?.mana ?? emptyMana()]
  for (const modes of sources) {
    const next = new Map<string, ManaPool>()
    for (const pool of pools) {
      for (const mode of modes) {
        const candidate = addPool(pool, mode)
        next.set(poolKey(candidate, cap), candidate)
      }
    }
    pools = [...next.values()]
  }
  return pools.some((pool) => payCost(pool, cost))
}

const taxFor = (state: GameState, seat: PlayerId, object: GameObject) => {
  if (object.zone !== 'command' || !object.tags.includes('commander')) return 0
  const taxes = state.players[seat]?.data.commanderTax
  if (!taxes || typeof taxes !== 'object' || Array.isArray(taxes)) return 0
  const value = (taxes as Record<string, unknown>)[object.id]
  return typeof value === 'number' ? value : 0
}

/**
 * A spell that can only target something on the stack is not merely uncertain
 * with an empty stack, it is uncastable. Offering it would stop the human at
 * every otherwise empty priority window.
 */
const needsStackTarget = (object: GameObject) =>
  /counter target[^.]*\b(spell|ability)\b/i.test(object.oracleText)

const canCastAtTiming = (state: GameState, seat: PlayerId, object: GameObject) => {
  const face = castFaceOf(object)
  const spell = face ? { ...object, ...face } : object
  if (!state.castableZones.includes(object.zone)) return false
  if (object.types.includes('Land') && !face) return false
  if (object.owner !== seat || object.controller !== seat) return false
  const endStepOnly = effectsOf(object).some(
    (effect) => effect.op === 'castCost' && effect.timing === 'yourEndStep',
  )
  if (endStepOnly && (state.active !== seat || state.step !== 'end')) return false
  if (state.stack.length === 0 && needsStackTarget(object)) return false
  if (
    !spell.types.includes('Instant')
    && (
      state.active !== seat
      || !MAIN_STEPS.has(state.step)
      || state.stack.length > 0
    )
  ) {
    return false
  }
  return true
}

const xManaKind = (object: GameObject) =>
  effectsOf(object).flatMap((effect) =>
    effect.op === 'castCost' && effect.xMana ? [effect.xMana] : [])[0]

const costForX = (object: GameObject, x: number) => {
  const xCost = xManaKind(object) === 'black'
    ? '{B}'.repeat(x)
    : x > 0 ? `{${x}}` : ''
  return object.manaCost.replaceAll('{X}', xCost)
}

const castActions = (state: GameState, seat: PlayerId, object: GameObject): AvailableAction[] => {
  if (!canCastAtTiming(state, seat, object)) return []
  const tax = taxFor(state, seat, object)
  const suffix = tax > 0 ? `{${tax}}` : ''
  const alternatives = alternateCastEffects(object)
  const paysLifeX = effectsOf(object).some((effect) => effect.op === 'castCost' && effect.lifeX)
  if (!object.manaCost.includes('{X}') && !paysLifeX) {
    const face = castFaceOf(object)
    const actions: AvailableAction[] = canFund(
      state,
      seat,
      `${face?.manaCost ?? object.manaCost}${suffix}`,
    )
      ? [{ kind: 'castSpell', objectId: object.id, name: object.name }]
      : []
    for (const alternative of alternatives) {
      if (
        canChooseAlternateCast(state, seat, alternative)
        && canFund(state, seat, `${alternative.manaCost}${suffix}`)
      ) {
        actions.push({
          kind: 'castSpell',
          objectId: object.id,
          name: object.name,
          castOption: alternative.id,
          castLabel: alternative.label,
        })
      }
    }
    return actions
  }
  const sourceMana = Object.values(state.objects)
    .filter((source) => sourceCanTap(source, seat, state))
    .reduce((total, source) => total + Math.max(
      0,
      ...manaModes(source, state).map((mode) => poolTotal({ ...emptyMana(), ...mode })),
    ), 0)
  const manaUpper = poolTotal(state.players[seat].mana) + sourceMana
  const upper = paysLifeX && !object.manaCost.includes('{X}')
    ? state.players[seat].life
    : paysLifeX
      ? Math.min(manaUpper, state.players[seat].life)
      : manaUpper
  return Array.from({ length: upper + 1 }, (_, x) => x)
    .filter((x) => canFund(state, seat, costForX(object, x)))
    .map((x) => ({ kind: 'castSpell', objectId: object.id, name: object.name, x }))
}

const activatedText = (object: GameObject) =>
  object.oracleText
    .split('\n')
    .filter((line) => {
      const colon = line.indexOf(':')
      if (colon < 0) return false
      const effect = line.slice(colon + 1)
      return !/^\s*Add\b/i.test(effect)
    })

const canActivate = (
  state: GameState,
  object: GameObject,
  seat: PlayerId,
  line: string,
) => {
  if (object.zone !== 'battlefield' || object.controller !== seat) return false
  const cost = line.slice(0, line.indexOf(':'))
  if (/\{T\}/i.test(cost) && !sourceCanTap(object, seat, state)) return false
  if (
    (/activate only as a sorcery/i.test(line) || /^[+−-]\d+:/u.test(line))
    && (
      state.active !== seat
      || !MAIN_STEPS.has(state.step)
      || state.stack.length > 0
    )
  ) {
    return false
  }
  if (/^[+−-]\d+:/u.test(line)) {
    if (object.loyaltyActivatedTurn === state.turn) return false
    const amount = Number(line.match(/^[+−-](\d+)/u)?.[1] ?? 0)
    if (/^[−-]/u.test(line) && (object.counters.loyalty ?? 0) < amount) return false
  }
  // A free fog is legal in every window, so enumerating it everywhere would
  // stop its controller at every step of every turn. Surface it once combat
  // damage is actually threatened; a later combat redeclares attackers and
  // reopens the window.
  if (/prevent all combat damage[^.]*this turn/i.test(line)) {
    if (!DAMAGE_PENDING_STEPS.has(state.step)) return false
    const attacking = Object.values(state.objects).some(
      (candidate) => candidate.zone === 'battlefield' && candidate.attacking,
    )
    if (!attacking) return false
  }
  const manaCost = [...cost.matchAll(/\{(?:\d+|[WUBRGC](?:\/[WUBRGC])?)\}/gi)]
    .map((match) => match[0])
    .join('')
  if (manaCost && !canFund(state, seat, manaCost)) return false
  return true
}

const canPayActivateCosts = (
  state: GameState,
  object: GameObject,
  seat: PlayerId,
  costs: ActivateCost,
) => canPayCardActivationCosts(
  state,
  object,
  seat,
  costs,
  (cost) => canFund(state, seat, cost),
)

const cardRuleActions = (state: GameState, object: GameObject, seat: PlayerId) =>
  effectsOf(object).flatMap((effect): AvailableAction[] => {
    if (object.zone !== 'battlefield' || object.controller !== seat) return []
    if (effect.op === 'activate' && !effect.manaAbility) {
      const loyalty = effect.costs.loyalty
      if (
        !canPayActivateCosts(state, object, seat, effect.costs)
        || !conditionHolds(effect.if, state, object)
        || (
          loyalty !== undefined
          && (
            state.active !== seat
            || !MAIN_STEPS.has(state.step)
            || state.stack.length > 0
            || object.loyaltyActivatedTurn === state.turn
            || (loyalty < 0 && (object.counters.loyalty ?? 0) < -loyalty)
          )
        )
      ) {
        return []
      }
      const fogsAllCombat = effect.do.some((instruction) =>
        instruction.kind === 'preventCombatDamage'
        && (instruction.from ?? 'all') === 'all'
        && !instruction.toController)
      if (fogsAllCombat) {
        if (!DAMAGE_PENDING_STEPS.has(state.step)) return []
        const attacking = Object.values(state.objects).some(
          (candidate) => candidate.zone === 'battlefield' && candidate.attacking,
        )
        if (!attacking) return []
      }
      return [{
        kind: 'activateAbility',
        objectId: object.id,
        name: object.name,
        text: fogsAllCombat ? object.oracleText : effect.id,
        abilityId: effect.id,
      }]
    }
    if (
      effect.op === 'search'
      && effect.via === 'ability'
      && canPayActivateCosts(state, object, seat, effect.costs)
    ) {
      return [{
        kind: 'activateAbility',
        objectId: object.id,
        name: object.name,
        text: effect.spec.prompt,
        abilityId: 'librarySearch.fetch',
      }]
    }
    return []
  })

/**
 * Enumerate meaningful choices for the seat with priority. Mana abilities are
 * folded into spells they can fund; listing every untapped land as a choice
 * would make an otherwise empty priority window look actionable.
 *
 * Target legality and card-specific restrictions are deliberately
 * conservative: an uncertain action remains listed and therefore causes a
 * stop. The host may auto-pass only when this list is genuinely empty.
 */
export const availableActions = (
  state: GameState,
  seat: PlayerId = state.priority ?? '',
): AvailableAction[] => {
  if (!seat || state.players[seat]?.lost) return []
  const extort = pendingExtortFor(state, seat)
  if (extort) {
    return [
      {
        kind: 'payExtort',
        triggerId: extort.triggerId,
        sourceId: extort.sourceId,
        source: extort.source,
      },
      ...(['W', 'B'] as const).flatMap((mana): AvailableAction[] =>
        canFund(state, seat, `{${mana}}`)
          ? [{
              kind: 'payExtort',
              triggerId: extort.triggerId,
              sourceId: extort.sourceId,
              source: extort.source,
              mana,
            }]
          : []),
    ]
  }
  if (state.priority !== seat) return []
  if (state.step === 'untap' || state.step === 'cleanup') return []
  const waiting = waitingContinueAction(state, seat)
    ?? waitingPlayerSelection(state, seat)
    ?? waitingCardSelection(state, seat)
  if (waiting) return [waiting]
  const actions: AvailableAction[] = []
  const hand = state.zoneOrder[seat]?.hand ?? []

  if (
    state.active === seat
    && MAIN_STEPS.has(state.step)
    && state.stack.length === 0
    && state.players[seat].landsPlayed < state.players[seat].landPlaysAllowed
  ) {
    for (const id of hand) {
      const object = state.objects[id]
      if (object && (object.types.includes('Land') || landFaceOf(object))) {
        actions.push({ kind: 'playLand', objectId: id, name: object.name })
      }
    }
  }

  for (const object of Object.values(state.objects)) {
    actions.push(...castActions(state, seat, object))
    const declaredActions = cardRuleActions(state, object, seat)
    actions.push(...declaredActions)
    if (
      object.zone === 'battlefield'
      && object.controller === seat
      && object.types.includes('Land')
      && canSacrificeLandForBlack(state, seat)
    ) {
      actions.push({
        kind: 'activateAbility',
        objectId: object.id,
        name: object.name,
        text: 'Sacrifice this land: Add {B}.',
        abilityId: SACRIFICE_LAND_FOR_BLACK,
      })
    }
    if (declaredActions.length === 0) {
      for (const text of activatedText(object)) {
        if (canActivate(state, object, seat, text)) {
          actions.push({
            kind: 'activateAbility',
            objectId: object.id,
            name: object.name,
            text,
          })
        }
      }
    }
  }

  if (state.active === seat && state.step === 'declareAttackers') {
    const objectIds = Object.values(state.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && object.controller === seat
        && object.types.includes('Creature')
        && !object.tapped
        && (!object.summoningSickness || hasKeyword(object, 'haste', state)))
      .map((object) => object.id)
    if (objectIds.length > 0) {
      const taxByDefender = attackTaxByDefender(state)
      actions.push({
        kind: 'declareAttackers',
        objectIds,
        ...(Object.keys(taxByDefender).length > 0 ? { taxByDefender } : {}),
      })
    }
  }

  if (state.step === 'declareBlockers') {
    const attackerIds = Object.values(state.objects)
      .filter((object) => {
        if (object.zone !== 'battlefield' || !object.attacking) return false
        if (typeof object.attacking === 'string') return object.attacking === seat
        if (object.attacking.kind === 'player') return object.attacking.player === seat
        return state.objects[object.attacking.objectId]?.controller === seat
      })
      .map((object) => object.id)
    const objectIds = Object.values(state.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && object.controller === seat
        && object.types.includes('Creature')
        && !object.tapped)
      .map((object) => object.id)
    if (attackerIds.length > 0 && objectIds.length > 0) {
      const taxPerBlocker = blockTaxPerCreature(state)
      actions.push({
        kind: 'declareBlockers',
        objectIds,
        attackerIds,
        ...(taxPerBlocker > 0 ? { taxPerBlocker } : {}),
      })
    }
  }

  return actions
}

/**
 * Tap-for-mana buttons for the acting seat. These are UI affordances, not a
 * reason to stop an otherwise empty priority window.
 */
export const manaAffordances = (
  state: GameState,
  seat: PlayerId = state.priority ?? '',
): AvailableAction[] => {
  if (!seat || state.priority !== seat || state.players[seat]?.lost) return []
  if (state.step === 'untap' || state.step === 'cleanup') return []
  const actions: AvailableAction[] = []
  const seen = new Set<string>()
  for (const object of Object.values(state.objects)) {
    for (const effect of effectsOf(object)) {
      if (
        effect.op !== 'activate'
        || !effect.manaAbility
        || object.zone !== (effect.zone ?? 'battlefield')
        || object.controller !== seat
        || !canPayActivateCosts(state, object, seat, effect.costs)
      ) continue
      if (effect.do.some((instruction) => instruction.kind === 'addChosenColorMana')) {
        for (const mana of MANA_IDS.filter((symbol) => symbol !== 'C')) {
          actions.push({
            kind: 'activateAbility',
            objectId: object.id,
            name: object.name,
            text: effect.id,
            abilityId: effect.id,
            mana,
          })
        }
      }
    }
    if (!sourceCanTap(object, seat, state)) continue
    for (const mode of manaModes(object, state)) {
      const choice = tapChoice(state, object, mode)
      if (!choice) continue
      const key = `${object.id}:${choice.mana ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      actions.push({
        kind: 'tapForMana',
        objectId: object.id,
        name: object.name,
        ...choice,
      })
    }
  }
  return actions
}

const targetVariants = (
  state: GameState,
  seat: PlayerId,
  action: AvailableAction,
): AvailableAction[] => {
  if (action.kind !== 'castSpell') return [action]
  const source = state.objects[action.objectId]
  if (source?.name === 'Settle the Wreckage') {
    return state.playerOrder
      .filter((player) => !state.players[player].lost)
      .map((player) => ({
        ...action,
        targetPlayerId: player,
        targetName: player,
      }))
  }
  if (source?.name === 'Energy Arc') {
    const targets = Object.values(state.objects)
      .filter((object) => object.zone === 'battlefield' && object.types.includes('Creature'))
      .map((object) => ({
        objectId: object.id,
        name: object.name,
        controller: object.controller,
      }))
    return [{
      ...action,
      targetGroups: [{
        label: 'Creatures',
        min: 0,
        max: targets.length,
        targets,
      }],
    }]
  }
  if (source?.name === 'Ghostly Flicker') return [action]
  if (source?.name === 'Ephemerate' || source?.name === 'Vanish into Memory') {
    return Object.values(state.objects)
      .filter((object) => validBlinkSpellTarget(source.name, object, seat))
      .map((target) => ({
        ...action,
        targetObjectId: target.id,
        targetName: target.name,
      }))
  }
  const targeted = source
    ? effectsOf(source).filter((effect) => effect.op === 'targetedResolve')
    : []
  const playerAura = source
    ? effectsOf(source).some((effect) => effect.op === 'playerAuraDeal')
    : false
  if (playerAura) {
    return state.playerOrder
      .filter((player) => player !== seat && !state.players[player].lost)
      .map((player) => ({
        ...action,
        targetObjectId: player,
        targetName: player,
      }))
  }
  if (targeted.length !== 1 || !source) return [action]
  const effect = targeted[0]
  const objectTargets = Object.values(state.objects)
    .filter((object) =>
      validTargetRef(state, { kind: 'object', objectId: object.id }, effect.filter, seat))
    .map((target): AvailableAction => ({
      ...action,
      targetObjectId: target.id,
      targetName: target.name,
    }))
  const playerTargets = state.playerOrder
    .filter((player) =>
      validTargetRef(state, { kind: 'player', player }, effect.filter, seat))
    .map((player): AvailableAction => ({
      ...action,
      targetPlayerId: player,
      targetName: player,
    }))
  return [...objectTargets, ...playerTargets]
}

const validBlinkSpellTarget = (
  name: string,
  object: GameObject,
  seat: PlayerId,
) => object.zone === 'battlefield'
  && object.types.includes('Creature')
  && (name !== 'Ephemerate' || object.controller === seat)

const activationCostTargetGroups = (
  state: GameState,
  source: GameObject,
  costs: ActivateCost,
): ActionTargetGroup[] => {
  const groups: ActionTargetGroup[] = []
  if (costs.discard && costs.discard !== 'self') {
    groups.push({
      label: costs.discard === 'land' ? 'Land card to discard' : 'Card to discard',
      min: 1,
      max: 1,
      purpose: 'cost',
      targets: discardCostCandidates(state, source.controller, costs.discard)
        .map((object) => ({
          objectId: object.id,
          name: object.name,
          controller: object.controller,
        })),
    })
  }
  if (costs.sacrificeTarget) {
    groups.push({
      label: `${costs.sacrificeTarget === 'land' ? 'Land' : 'Creature'} to sacrifice`,
      min: 1,
      max: 1,
      purpose: 'cost',
      targets: sacrificeCostCandidates(
        state,
        source,
        source.controller,
        costs.sacrificeTarget,
        costs.sacrificeOther,
      ).map((object) => ({
        objectId: object.id,
        name: object.name,
        controller: object.controller,
      })),
    })
  }
  if (costs.crew !== undefined) {
    const creatures = crewCostCandidates(state, source.controller)
    groups.push({
      label: `Creatures to crew ${costs.crew}`,
      min: costs.crew > 0 ? 1 : 0,
      max: creatures.length,
      purpose: 'cost',
      targets: creatures.map((object) => ({
        objectId: object.id,
        name: object.name,
        controller: object.controller,
      })),
    })
  }
  return groups
}

const activationTargetGroups = (
  state: GameState,
  action: AvailableAction,
): AvailableAction => {
  if (action.kind === 'castSpell' && action.name === 'Ghostly Flicker') {
    const targets = Object.values(state.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && object.controller === state.priority
        && ['Artifact', 'Creature', 'Land'].some((type) => object.types.includes(type)))
      .map((object) => ({
        objectId: object.id,
        name: object.name,
        controller: object.controller,
      }))
    return {
      ...action,
      targetGroups: [
        { label: 'First permanent', min: 1, max: 1, targets },
        { label: 'Second permanent', min: 1, max: 1, targets },
      ],
    }
  }
  if (action.kind !== 'activateAbility' || !action.abilityId) return action
  const source = state.objects[action.objectId]
  if (action.abilityId === 'loran.draw') {
    return {
      ...action,
      targetGroups: [{
        label: 'Opponent',
        min: 1,
        max: 1,
        kind: 'player',
        targets: state.playerOrder
          .filter((player) => player !== source?.controller && !state.players[player].lost)
          .map((player) => ({ objectId: player, name: player, controller: player })),
      }],
    }
  }
  const effect = source
    ? activateEffect(effectsOf(source), action.abilityId)
    : undefined
  const search = source && action.abilityId === SEARCH_FETCH
    ? searchEffect(effectsOf(source))
    : undefined
  const costs = effect?.costs ?? (search?.via === 'ability' ? search.costs : undefined)
  const costGroups = source && costs
    ? activationCostTargetGroups(state, source, costs)
    : []
  if (effect?.targets === 'opponent') {
    return {
      ...action,
      targetGroups: [
        ...costGroups,
        {
          label: 'Opponent',
          min: 1,
          max: 1,
          kind: 'player',
          targets: state.playerOrder
            .filter((seat) => seat !== source?.controller && !state.players[seat].lost)
            .map((seat) => ({ objectId: seat, name: seat, controller: seat })),
        },
      ],
    }
  }
  const targets = Object.values(state.objects).filter((object) => object.zone === 'battlefield')
  if (
    effect?.targets === 'creature'
    || effect?.targets === 'land'
    || effect?.targets === 'any'
  ) {
    const type = effect.targets === 'creature'
      ? 'Creature'
      : effect.targets === 'land'
        ? 'Land'
        : undefined
    return {
      ...action,
      targetGroups: [
        ...costGroups,
        {
          label: type ?? 'Permanent',
          min: 1,
          max: 1,
          targets: targets
            .filter((object) => !type || object.types.includes(type))
            .map((object) => ({
              objectId: object.id,
              name: object.name,
              controller: object.controller,
            })),
        },
      ],
    }
  }
  if (effect?.targets !== 'teferiSunsetPlusOne') {
    return costGroups.length > 0 ? { ...action, targetGroups: costGroups } : action
  }
  return {
    ...action,
    targetGroups: [
      ...costGroups,
      ...['Artifact', 'Creature', 'Land'].map((type) => ({
        label: type,
        min: 0,
        max: 1,
        targets: targets
          .filter((object) => object.types.includes(type))
          .map((object) => ({
            objectId: object.id,
            name: object.name,
            controller: object.controller,
          })),
      })),
    ],
  }
}

export const legalActsFor = (
  state: GameState,
  seat: PlayerId = state.priority ?? '',
): AvailableAction[] =>
  [...availableActions(state, seat), ...manaAffordances(state, seat)]
    .flatMap((action) => targetVariants(state, seat, action))
    .map((action) => activationTargetGroups(state, action))
    .filter((action) =>
      action.kind === 'declareAttackers'
      || action.kind === 'declareBlockers'
      || action.kind === 'continueAction'
      || action.kind === 'selectCards'
      || action.kind === 'selectPlayers'
      || (action.kind === 'castSpell' && Boolean(action.targetGroups))
      || (action.kind === 'activateAbility' && Boolean(action.targetGroups))
      || eventsForAvailableAction(state, seat, action))

export const sameLegalAct = (
  left: AvailableAction,
  right: {
    kind?: string
    objectId?: string
    abilityId?: string
    text?: string
    mana?: ManaId
    targetObjectId?: string
    targetPlayerId?: string
    x?: number
    castOption?: string
    stackId?: string
    selectionId?: string
    triggerId?: string
  },
) => {
  if (left.kind !== right.kind) return false
  if ('objectId' in left && left.objectId !== right.objectId) return false
  if (left.kind === 'tapForMana') return left.mana === right.mana
  if (left.kind === 'activateAbility') {
    return left.abilityId === right.abilityId
      && left.text === right.text
      && left.mana === right.mana
  }
  if (left.kind === 'castSpell') {
    return left.targetObjectId === right.targetObjectId
      && left.targetPlayerId === right.targetPlayerId
      && left.x === right.x
      && left.castOption === right.castOption
  }
  if (left.kind === 'continueAction') return left.stackId === right.stackId
  if (left.kind === 'selectCards') return left.selectionId === right.selectionId
  if (left.kind === 'selectPlayers') return left.selectionId === right.selectionId
  if (left.kind === 'payExtort') {
    return left.triggerId === right.triggerId && left.mana === right.mana
  }
  return true
}

const SIMPLE_PERMANENT = new Set<string>(PERMANENT_TYPES)

const fundingEvents = (
  state: GameState,
  seat: PlayerId,
  cost: string,
  excluded = new Set<string>(),
): GameEvent[] | null => {
  const sources = Object.values(state.objects)
    .filter((object) => sourceCanTap(object, seat, state) && !excluded.has(object.id))
    .map((source) => ({ source, modes: manaModes(source, state) }))
    .filter(({ modes }) => modes.length > 0)
  let plans = [{
    pool: state.players[seat]?.mana ?? emptyMana(),
    events: [] as GameEvent[],
  }]
  for (const { source, modes } of sources) {
    const next = new Map<string, typeof plans[number]>()
    for (const plan of plans) {
      const candidates = [
        plan,
        ...modes.flatMap((mode) => {
          const choice = tapChoice(state, source, mode)
          if (!choice) return []
          return [{
            pool: addPool(plan.pool, mode),
            events: [
              ...plan.events,
              { type: 'tapForMana', seat, objectId: source.id, ...choice } as GameEvent,
            ],
          }]
        }),
      ]
      for (const candidate of candidates) {
        const key = poolKey(candidate.pool, 20)
        const previous = next.get(key)
        if (!previous || candidate.events.length < previous.events.length) {
          next.set(key, candidate)
        }
      }
    }
    plans = [...next.values()]
  }
  return plans
    .filter((plan) => payCost(plan.pool, cost))
    .sort((left, right) => left.events.length - right.events.length)[0]
    ?.events ?? null
}

export const eventsForCombatDeclaration = (
  state: GameState,
  event:
    | { type: 'declareAttackers'; seat: PlayerId; attackers: AttackerDecl[] }
    | { type: 'declareBlockers'; seat: PlayerId; blockers: BlockerDecl[] },
): GameEvent[] | null => {
  const tax = combatTaxAmount(state, event)
  if (tax === 0) return [event]
  const excluded = event.type === 'declareAttackers'
    ? new Set(event.attackers.flatMap((attacker) => {
        const object = state.objects[attacker.objectId]
        return object && !hasKeyword(object, 'vigilance', state) ? [object.id] : []
      }))
    : new Set(event.blockers.map((blocker) => blocker.blockerId))
  const funding = fundingEvents(state, event.seat, `{${tax}}`, excluded)
  if (!funding) return null
  return [{
    ...event,
    payment: funding.flatMap((payment) =>
      payment.type === 'tapForMana'
        ? [{
            objectId: payment.objectId,
            ...('mana' in payment && payment.mana ? { mana: payment.mana } : {}),
          }]
        : []),
  }]
}

/**
 * Turn an enumerated, choice-free action into reducer events. Returning null
 * is deliberate: targets, optional costs, ETB choices, and spell instructions
 * still need a card handler or the judge.
 */
export const eventsForAvailableAction = (
  state: GameState,
  seat: PlayerId,
  action: AvailableAction,
): GameEvent[] | null => {
  if (
    action.kind === 'continueAction'
    || action.kind === 'selectCards'
    || action.kind === 'selectPlayers'
  ) return null
  if (action.kind === 'payExtort') {
    if (!action.mana) {
      return [{
        type: 'payExtort',
        seat,
        triggerId: action.triggerId,
      }]
    }
    const mana = fundingEvents(state, seat, `{${action.mana}}`)
    if (!mana) return null
    return [
      ...mana,
      {
        type: 'payExtort',
        seat,
        triggerId: action.triggerId,
        mana: action.mana,
      },
    ]
  }
  if (action.kind === 'playLand') {
    return [{ type: 'playLand', seat, objectId: action.objectId }]
  }
  if (action.kind === 'tapForMana') {
    return [{
      type: 'tapForMana',
      seat,
      objectId: action.objectId,
      ...(action.mana ? { mana: action.mana } : {}),
    }]
  }
  if (action.kind === 'activateAbility') {
    const object = state.objects[action.objectId]
    if (!object || !action.abilityId) return null
    if (action.abilityId === SACRIFICE_LAND_FOR_BLACK) {
      return [{
        type: 'activateAbility',
        abilityId: SACRIFICE_LAND_FOR_BLACK,
        seat,
        objectId: object.id,
        manaAbility: true,
      }]
    }
    const effect = effectsOf(object).find(
      (candidate): candidate is Extract<ReturnType<typeof effectsOf>[number], { op: 'activate' }> =>
      candidate.op === 'activate'
      && candidate.id === action.abilityId
      && !candidate.targets,
    )
    return effect
      && !effect.costs.loyaltyX
      && !effect.targets
      && !needsActivationCostPicks(effect.costs)
      ? [{
          type: 'activateAbility',
          abilityId: effect.id,
          seat,
          objectId: object.id,
          ...(effect.manaAbility ? { manaAbility: true } : {}),
          ...(action.mana ? { choices: [action.mana] } : {}),
        }]
      : null
  }
  if (action.kind !== 'castSpell') return null
  const object = state.objects[action.objectId]
  const targeted = object
    ? effectsOf(object).filter((effect) => effect.op === 'targetedResolve')
    : []
  const resolvesThroughKernel = object
    ? effectsOf(object).some((effect) =>
      (effect.op === 'trigger' && effect.on === 'resolve')
      || (effect.op === 'search' && effect.via === 'spell')
      || (
        effect.op === 'handler'
        && effect.pluginId === 'combatPreventionCards'
      )
      || effect.op === 'playerAuraDeal')
    : false
  const playerAura = object
    ? effectsOf(object).some((effect) => effect.op === 'playerAuraDeal')
    : false
  const hasDeclarativeAdditionalCost = object
    ? effectsOf(object).some((effect) => effect.op === 'castCost' && effect.lifeX)
    : false
  const hasAlternateCast = object ? alternateCastEffects(object).length > 0 : false
  if (
    !object
    || (
      targeted.length === 0
      && !object.types.some((type) => SIMPLE_PERMANENT.has(type))
      && !resolvesThroughKernel
    )
    || targeted.length > 1
    || (targeted.length === 0 && !playerAura && /\btarget\b/i.test(object.oracleText))
    || (
      !hasAlternateCast
      && /(?:enters(?: the battlefield)?|when you cast|choose)/i.test(object.oracleText)
    )
    || (
      /additional cost/i.test(object.oracleText)
      && !hasDeclarativeAdditionalCost
    )
  ) {
    if (!['Ephemerate', 'Ghostly Flicker', 'Vanish into Memory'].includes(object?.name ?? '')) {
      return null
    }
  }
  if ((targeted.length === 1 || playerAura) && !action.targetObjectId) return null
  const blinkTargets = action.targetObjectIds
    ?? (action.targetObjectId ? [action.targetObjectId] : [])
  if (
    ['Ephemerate', 'Vanish into Memory'].includes(object.name)
    && blinkTargets.length !== 1
  ) return null
  if (object.name === 'Ghostly Flicker' && blinkTargets.length !== 2) return null
  const tax = taxFor(state, seat, object)
  const face = castFaceOf(object)
  const casting = face ? { ...object, ...face } : object
  const alternative = alternateCastEffects(object).find(
    (effect) => effect.id === action.castOption,
  )
  const cost = `${
    alternative?.manaCost ?? costForX(casting, action.x ?? 0)
  }${tax > 0 ? `{${tax}}` : ''}`
  const mana = fundingEvents(state, seat, cost)
  if (!mana) return null
  return [
    ...mana,
    {
      type: 'castSpell',
      seat,
      objectId: object.id,
      ...(action.castOption ? { castOption: action.castOption } : {}),
      ...(action.targetObjectId || action.targetObjectIds
        ? {
            targets: playerAura
              ? [{ kind: 'player' as const, player: action.targetObjectId! }]
              : blinkTargets.map((objectId) => ({
                  kind: 'object' as const,
                  objectId,
                })),
          }
        : action.targetPlayerId
          ? { targets: [{ kind: 'player' as const, player: action.targetPlayerId }] }
        : {}),
      ...(action.x !== undefined ? { x: action.x } : {}),
    },
  ]
}
