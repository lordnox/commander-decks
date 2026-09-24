import { emptyMana, poolTotal } from './draft'
import { isPhasedOut } from './plugins/phasing'
import { PERMANENT_TYPES } from './definitions'
import { manaModes, poolForChoice } from './plugins/mana'
import { giftSpecOf } from './cardPlugins/giftCast'
import {
  kickCastLabel,
  multikickerCostOf,
} from './plugins/kickCast'
import {
  convokeColors,
  hasConvoke,
  kickerCostOf,
  payCost,
  phyrexianSymbols,
  spellCost,
} from './plugins/spells'
import {
  canPayActivationCosts as canPayCardActivationCosts,
  crewCostCandidates,
  discardCostCandidates,
  needsActivationCostPicks,
  sacrificeCostCandidates,
} from './cardPlugins/activationCosts'
import { effectsOf } from './cardPlugins/cardRules'
import { spreeModesOf, spreeSubsetActions } from './spreeCost'
import {
  activateEffect,
  conditionHolds,
  searchEffect,
  type ActivateCost,
  type TargetFilter,
} from './cardPlugins/effects'
import { SEARCH_FETCH } from './cardPlugins/librarySearch'
import {
  targetedEffectFilter,
  validTargetRef,
} from './cardPlugins/targetedResolve'
import { hasKeyword } from './keywords'
import { CAST_TRANSFORMED_ACTION } from './plugins/battle'
import {
  adventureFaceOf,
  castFaceOf,
  isAdventureCard,
  landFaceOf,
  permanentFaceOf,
} from './plugins/doubleFaced'
import { resolveCastFace } from './plugins/adventure'
import type { FaceCharacteristics } from './types'
import { pendingFreeCastFor } from './plugins/rebound'
import { asRoomDoor, roomDoor } from './plugins/rooms'
import { canPlayExiledWithLife } from './cardPlugins/exiledWith'
import { manaValueOf } from './cardPlugins/effects'
import { pendingExtortFor } from './cardPlugins/extort'
import {
  alternateCastEffects,
  availableAlternateCastEffect,
  availableAlternateCastEffects,
  canChooseAlternateCast,
  type AlternateCastEffect,
} from './cardPlugins/alternateCosts'
import {
  canCastForetold,
  canForetellFromHand,
  FORETELL_ACTION_COST,
  FORETELL_CAST_ID,
} from './plugins/foretell'
import {
  attackTaxByDefender,
  blockTaxPerCreature,
  combatTaxAmount,
} from './cardPlugins/combatTax'
import { attackDeclarationError } from './plugins/goad'
import {
  canSacrificeLandForBlack,
  SACRIFICE_LAND_FOR_BLACK,
} from './plugins/sacrificeLandMana'
import {
  liveSelectionCandidates,
  pendingSelection,
  pendingSelectionFor,
  type CardSelectionKind,
  type PendingCardSelection,
} from './rules/selectCards'
import { pendingPlayerSelection } from './rules/selectPlayers'
import { isKnownTo } from './knowledge'
import type {
  GameEvent,
  GameObject,
  GameState,
  ManaId,
  ManaPool,
  PlayerId,
  RoomDoorId,
  StackItem,
  AttackerDecl,
  BlockerDecl,
} from './types'

export type ActionTargetGroup = {
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
      kicked?: boolean
      giftPromised?: boolean
      giftRecipientId?: string
      spreeModes?: string[]
      timesKicked?: number
      castOption?: string
      castLabel?: string
      convoke?: string[]
      phyrexianLife?: number[]
      alternativeCost?: 'withoutPayingMana'
      door?: RoomDoorId
      adventureCast?: boolean
      targetGroups?: ActionTargetGroup[]
    }
  | { kind: 'declineFreeCast'; objectId: string; name: string }
  | {
      kind: 'unlockDoor'
      objectId: string
      name: string
      door: RoomDoorId
      doorName: string
    }
  | { kind: 'foretell'; objectId: string; name: string }
  | {
      kind: 'activateAbility'
      objectId: string
      name: string
      text: string
      abilityId?: string
      targetObjectIds?: string[]
      targetGroups?: ActionTargetGroup[]
      mana?: ManaId
      door?: RoomDoorId
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
      options?: string[]
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

export type WaitingCastTransformed = {
  item: StackItem
  chooser: PlayerId
}

export const waitingCastTransformed = (
  state: GameState,
  seat?: PlayerId,
): WaitingCastTransformed | null => {
  const item = state.stack[0]
  if (
    item?.kind !== 'action'
    || item.actionId !== CAST_TRANSFORMED_ACTION
    || item.waiting !== 'choice'
  ) return null
  const chooser = (typeof item.payload?.chooser === 'string'
    ? item.payload.chooser
    : item.controller) as PlayerId
  return seat && seat !== chooser ? null : { item, chooser }
}

export const waitingContinueAction = (
  state: GameState,
  seat: PlayerId,
): AvailableAction | null => {
  const discard = waitingDiscard(state, seat)
  if (discard) {
    return {
      kind: 'continueAction',
      stackId: discard.item.id,
      actionId: 'discard',
      objectIds: discard.handIds,
      count: discard.count,
    }
  }
  const transformed = waitingCastTransformed(state, seat)
  return transformed
    ? {
        kind: 'continueAction',
        stackId: transformed.item.id,
        actionId: CAST_TRANSFORMED_ACTION,
        objectIds: [transformed.item.objectId],
        count: 1,
        options: ['cast', 'decline'],
      }
    : null
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

  const objectIds = liveSelectionCandidates(state, pending)

  return {
    selection: pending,
    objectIds,
    names: objectIds.map((objectId) => {
      const object = state.objects[objectId]
      if (!object) return ''
      if (
        pending.kind === 'choosePile'
        && object.zone === 'library'
        && !isKnownTo(object, pending.seat, state.playerOrder)
      ) {
        return 'Face-down card'
      }
      return object.name
    }),
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
  && !object.phasedOut
  && object.controller === seat
  && !object.tapped
  && (
    !object.types.includes('Creature')
    || !object.summoningSickness
    || hasKeyword(object, 'haste', state)
  )

const poolKey = (pool: ManaPool, cap: number) =>
  MANA_IDS.map((mana) => Math.min(pool[mana], cap)).join(',')

const canUseRestrictedMana = (
  state: GameState,
  seat: PlayerId,
  spell: GameObject | undefined,
  creatureType?: string,
) => Boolean(
  spell?.types.includes('Creature')
  && creatureType
  && (
    spell.subtypes.includes(creatureType)
    || Object.values(state.objects).some((object) =>
      object.zone === 'battlefield'
      && !object.phasedOut
      && object.controller === seat
      && effectsOf(object).some((effect) => effect.op === 'static' && effect.allCreatureTypes))
  ),
)

const canFund = (
  state: GameState,
  seat: PlayerId,
  cost: string,
  extras: number[] | { creatures?: ManaId[][]; phyrexianLife?: number[] } = {},
  spell?: GameObject,
) => {
  const sources = Object.values(state.objects)
    .filter((object) => sourceCanTap(object, seat, state))
    .map((object) => {
      const modes = manaModes(object, state)
      const restricted = effectsOf(object).some((effect) => effect.op === 'restrictedMana')
      return restricted && !canUseRestrictedMana(state, seat, spell, object.chosenType)
        ? modes.filter((mode) => (mode.C ?? 0) > 0)
        : modes
    })
    .filter((modes) => modes.length > 0)
  const cap = Math.max(
    1,
    [...cost.matchAll(/\{(\d+)\}/g)].reduce(
      (total, match) => total + Number(match[1]),
      [...cost.matchAll(/\{[WUBRGC](?:\/[WUBRGCP])?\}/g)].length,
    ),
  )
  const available = { ...(state.players[seat]?.mana ?? emptyMana()) }
  for (const mana of state.players[seat]?.restrictedMana ?? []) {
    if (canUseRestrictedMana(state, seat, spell, mana.creatureType)) available[mana.mana] += 1
  }
  let pools = [available]
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
  return pools.some((pool) => payCost(pool, cost, extras))
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

const canCastAtTiming = (
  state: GameState,
  seat: PlayerId,
  object: GameObject,
  withoutPayingMana = false,
  spellFace?: FaceCharacteristics,
) => {
  const face = spellFace ?? castFaceOf(object)
  const spell = face ? { ...object, ...face } : object
  const fromAlternateZone = availableAlternateCastEffects(state, seat, object)
    .some((effect) => effect.fromZone === object.zone)
  const fromAdventureExile = Boolean(
    object.adventured
    && object.zone === 'exile'
    && spellFace
    && !spellFace.subtypes.includes('Adventure'),
  )
  if (
    !state.castableZones.includes(object.zone)
    && !(withoutPayingMana && object.zone === 'exile')
    && !fromAlternateZone
    && !fromAdventureExile
  ) return false
  if (object.types.includes('Land') && !face) return false
  if (object.owner !== seat || object.controller !== seat) return false
  const endStepOnly = effectsOf(object).some(
    (effect) => effect.op === 'castCost' && effect.timing === 'yourEndStep',
  )
  if (
    !withoutPayingMana
    && endStepOnly
    && (state.active !== seat || state.step !== 'end')
  ) return false
  if (state.stack.length === 0 && needsStackTarget(object)) return false
  if (
    !withoutPayingMana
    && !spell.types.includes('Instant')
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

const phyrexianPayments = (cost: string, life: number) => {
  const symbols = phyrexianSymbols(cost)
  const payments = Array.from(
    { length: 2 ** symbols.length },
    (_, mask) => Array.from(
      { length: symbols.length },
      (__, index) => index,
    ).filter((index) => mask & (1 << index)),
  ).filter((symbols) => symbols.length * 2 <= life)
  const unique = new Map<string, number[]>()
  for (const payment of payments) {
    const key = payment.map((index) => symbols[index]).sort().join(',')
    if (!unique.has(key)) unique.set(key, payment)
  }
  return [...unique.values()]
}

const phyrexianCastLabel = (cost: string, payment: number[]) => {
  if (payment.length === 0) return 'Pay mana'
  const symbols = phyrexianSymbols(cost)
  return `Pay ${payment.length * 2} life for ${
    payment.map((index) => `{${symbols[index]}}`).join(' ')
  }`
}

const convokeIfNeeded = (
  state: GameState,
  seat: PlayerId,
  object: GameObject,
  cost: string,
  phyrexianLife: number[] = [],
) => {
  if (canFund(state, seat, cost, phyrexianLife, object)) return undefined
  if (!hasConvoke(object)) return null
  return convokeFundingPlan(state, seat, cost, phyrexianLife)?.convoke ?? null
}

/**
 * One cast can need both a Phyrexian life payment and convoked creatures, so
 * each payment combination carries the convoke plan that funds it.
 */
const fundedCasts = (
  state: GameState,
  seat: PlayerId,
  object: GameObject,
  cost: string,
) => {
  const payments = phyrexianPayments(cost, state.players[seat].life)
  return payments.flatMap((phyrexianLife) => {
    const convoke = convokeIfNeeded(state, seat, object, cost, phyrexianLife)
    if (convoke === null) return []
    return [{ phyrexianLife, convoke, labeled: payments.length > 1 }]
  })
}

const alternateCastCostGroups = (
  state: GameState,
  seat: PlayerId,
  effect: AlternateCastEffect,
  castObject: GameObject,
): ActionTargetGroup[] => {
  const groups: ActionTargetGroup[] = []
  if (effect.discard === 'land') {
    groups.push({
      label: 'Land card to discard',
      min: 1,
      max: 1,
      purpose: 'cost',
      targets: state.zoneOrder[seat].hand
        .map((objectId) => state.objects[objectId])
        .filter((object) => object?.types.includes('Land'))
        .map((object) => ({
          objectId: object.id,
          name: object.name,
          controller: object.controller,
        })),
    })
  }
  if (effect.sacrifice) {
    groups.push({
      label: `${effect.sacrifice.type}s to sacrifice`,
      min: effect.sacrifice.count,
      max: effect.sacrifice.count,
      purpose: 'cost',
      targets: Object.values(state.objects)
        .filter((object) =>
          object.zone === 'battlefield'
          && object.controller === seat
          && object.types.includes(effect.sacrifice!.type))
        .map((object) => ({
          objectId: object.id,
          name: object.name,
          controller: object.controller,
        })),
    })
  }
  if (effect.exileGraveyard) {
    groups.push({
      label: 'Other graveyard cards to exile',
      min: effect.exileGraveyard.count,
      max: effect.exileGraveyard.count,
      purpose: 'cost',
      targets: state.zoneOrder[seat].graveyard
        .map((objectId) => state.objects[objectId])
        .filter((object): object is GameObject =>
          Boolean(object)
          && (!effect.exileGraveyard?.other || object.id !== castObject.id))
        .map((object) => ({
          objectId: object.id,
          name: object.name,
          controller: object.controller,
        })),
    })
  }
  return groups
}

const bestowEffect = (object: GameObject) =>
  effectsOf(object).find((effect) => effect.op === 'bestow')

const castActions = (state: GameState, seat: PlayerId, object: GameObject): AvailableAction[] => {
  if (canPlayExiledWithLife(state, seat, object)) {
    const life = manaValueOf(object)
    if (state.players[seat].life >= life) {
      return [{
        kind: 'castSpell',
        objectId: object.id,
        name: object.name,
        castOption: 'exiledWithLife',
        castLabel: `Cast for ${life} life`,
      }]
    }
    return []
  }
  const tax = taxFor(state, seat, object)
  if (object.roomDoors) {
    const suffix = tax > 0 ? `{${tax}}` : ''
    return (['left', 'right'] as const).flatMap((door): AvailableAction[] => {
      const characteristics = roomDoor(object, door)
      if (!characteristics || !canFund(state, seat, `${characteristics.manaCost}${suffix}`)) {
        return []
      }
      return [{
        kind: 'castSpell',
        objectId: object.id,
        name: characteristics.name,
        door,
        castLabel: characteristics.name,
      }]
    })
  }
  if (isAdventureCard(object)) {
    const permanent = permanentFaceOf(object)
    const adventure = adventureFaceOf(object)
    const paysLifeX = effectsOf(object).some((effect) => effect.op === 'castCost' && effect.lifeX)
    const fundedForFace = (
      face: FaceCharacteristics,
      base: Extract<AvailableAction, { kind: 'castSpell' }>,
    ): AvailableAction[] => {
      if (!canCastAtTiming(state, seat, object, false, face)) return []
      const spell = { ...object, ...face }
      const cost = spellCost(state, spell, { additionalGeneric: tax, seat })
      return fundedCasts(state, seat, object, cost).map((funded) => ({
        ...base,
        ...(funded.labeled ? { phyrexianLife: funded.phyrexianLife } : {}),
        ...(funded.convoke ? { convoke: funded.convoke } : {}),
      }))
    }
    const actions: AvailableAction[] = []
    if (permanent && castFaceOf(object) && object.zone === 'hand') {
      actions.push(...fundedForFace(permanent, {
        kind: 'castSpell',
        objectId: object.id,
        name: object.name,
        castLabel: object.name,
      }))
    }
    if (adventure && object.zone === 'hand') {
      const adventureLabel = object.name.split(' // ')[1] ?? 'Adventure'
      actions.push(...fundedForFace(adventure, {
        kind: 'castSpell',
        objectId: object.id,
        name: adventureLabel,
        adventureCast: true,
        castLabel: adventureLabel,
      }))
    }
    if (permanent && object.adventured && object.zone === 'exile') {
      actions.push(...fundedForFace(permanent, {
        kind: 'castSpell',
        objectId: object.id,
        name: object.name,
        castLabel: `${object.name} from exile`,
      }))
    }
    if (paysLifeX || object.manaCost.includes('{X}')) return actions
    return actions
  }
  if (!canCastAtTiming(state, seat, object)) return []
  const alternatives = availableAlternateCastEffects(state, seat, object)
  const paysLifeX = effectsOf(object).some((effect) => effect.op === 'castCost' && effect.lifeX)
  const face = castFaceOf(object)
  const spell = face ? { ...object, ...face } : object
  const hasTargetReduction = effectsOf(object).some((effect) =>
    effect.op === 'castCost'
    && effect.reduceGeneric?.if.kind === 'target')
  const withKicker = (
    action: Extract<AvailableAction, { kind: 'castSpell' }>,
    options: { castOption?: string; x?: number } = {},
  ): AvailableAction[] => {
    const multikicker = multikickerCostOf(object)
    if (multikicker) {
      const variants: AvailableAction[] = []
      for (let timesKicked = 0; timesKicked < 100; timesKicked += 1) {
        const cost = spellCost(state, spell, {
          additionalGeneric: tax,
          x: options.x ?? action.x,
          castOption: options.castOption ?? action.castOption,
          timesKicked,
          seat,
        })
        if (!canFund(state, seat, cost)) {
          if (timesKicked === 0) break
          break
        }
        variants.push({
          ...action,
          timesKicked,
          ...(timesKicked > 0 ? { kicked: true } : {}),
          castLabel: kickCastLabel(action.castLabel, timesKicked),
        })
      }
      return variants
    }
    if (!kickerCostOf(object)) return [action]
    return [
      action,
      {
        ...action,
        kicked: true,
        timesKicked: 1,
        castLabel: kickCastLabel(action.castLabel, 1),
      },
    ]
  }
  const withGift = (
    action: Extract<AvailableAction, { kind: 'castSpell' }>,
  ): AvailableAction[] => {
    const spec = giftSpecOf(object)
    if (!spec) return [action]
    const label = spec.label ?? 'gift'
    return [
      action,
      {
        ...action,
        giftPromised: true,
        castLabel: action.castLabel ? `${action.castLabel} — ${label}` : label,
      },
    ]
  }
  const withGiftRecipients = (
    actions: AvailableAction[],
  ): AvailableAction[] =>
    actions.flatMap((action) => {
      if (action.kind !== 'castSpell' || !action.giftPromised) return [action]
      const opponents = state.playerOrder.filter((player) =>
        player !== seat && !state.players[player].lost)
      const funded = opponents.map((opponent) => ({
        ...action,
        giftRecipientId: opponent,
        castLabel: [action.castLabel, `to ${opponent}`].filter(Boolean).join(' '),
      }))
      return funded.length > 0 ? funded : [action]
    })
  const withSpree = (
    action: Extract<AvailableAction, { kind: 'castSpell' }>,
  ): AvailableAction[] => {
    const modes = spreeModesOf(spell)
    if (!modes || modes.length === 0) return [action]
    return spreeSubsetActions(modes).map((spreeModes) => {
      const label = spreeModes
        .map((id) => modes.find((mode) => mode.id === id)?.label ?? id)
        .join(' + ')
      return {
        ...action,
        spreeModes,
        castLabel: [action.castLabel, label].filter(Boolean).join(' — '),
      }
    })
  }
  const fundedVariants = (
    base: Extract<AvailableAction, { kind: 'castSpell' }>,
    options: { castOption?: string; x?: number } = {},
  ) => withGiftRecipients(
    withKicker(base, options).flatMap((action) =>
      action.kind === 'castSpell' ? withSpree(action) : [action]).flatMap((action) => {
      if (action.kind !== 'castSpell') return []
      const cost = spellCost(state, spell, {
        additionalGeneric: tax,
        x: options.x ?? action.x,
        castOption: options.castOption ?? action.castOption,
        kicked: action.kicked,
        spreeModes: action.spreeModes,
        timesKicked: action.timesKicked,
        seat,
      })
      if (hasTargetReduction) return [action]
      return fundedCasts(state, seat, object, cost).map((funded) => {
        const phyrexianLabel = funded.labeled
          ? phyrexianCastLabel(cost, funded.phyrexianLife)
          : undefined
        const castLabel = [action.castLabel, phyrexianLabel].filter(Boolean).join(' — ')
        return {
          ...action,
          ...(funded.labeled ? { phyrexianLife: funded.phyrexianLife } : {}),
          ...(funded.convoke ? { convoke: funded.convoke } : {}),
          ...(castLabel ? { castLabel } : {}),
        }
      })
    }).flatMap((action) => action.kind === 'castSpell' ? withGift(action) : [action]),
  )
  if (!object.manaCost.includes('{X}') && !paysLifeX) {
    const adventure = alternatives.some((effect) => effect.id === 'adventure')
    const actions: AvailableAction[] = state.castableZones.includes(object.zone) && !adventure
      ? fundedVariants({
          kind: 'castSpell',
          objectId: object.id,
          name: object.name,
        })
      : []
    for (const alternative of alternatives) {
      if (!canChooseAlternateCast(state, seat, alternative, object)) continue
      const targetGroups = alternateCastCostGroups(state, seat, alternative, object)
      actions.push(...fundedVariants({
        kind: 'castSpell',
        objectId: object.id,
        name: object.name,
        castOption: alternative.id,
        castLabel: alternative.label,
        ...(targetGroups.length > 0 ? { targetGroups } : {}),
      }, { castOption: alternative.id }))
    }
    const bestow = bestowEffect(object)
    if (bestow) {
      actions.push(...fundedVariants({
        kind: 'castSpell',
        objectId: object.id,
        name: object.name,
        castOption: 'bestow',
        castLabel: `Bestow ${bestow.cost}`,
      }, { castOption: 'bestow' }))
    }
    return actions
  }
  const sourceMana = Object.values(state.objects)
    .filter((source) => sourceCanTap(source, seat, state))
    .reduce((total, source) => total + Math.max(
      0,
      ...manaModes(source, state).map((mode) => poolTotal({ ...emptyMana(), ...mode })),
    ), 0)
  const convokeUpper = hasConvoke(object)
    ? Object.values(state.objects).filter((candidate) =>
        candidate.zone === 'battlefield'
        && candidate.controller === seat
        && candidate.types.includes('Creature')
        && !candidate.tapped).length
    : 0
  const manaUpper = poolTotal(state.players[seat].mana) + sourceMana + convokeUpper
  const upper = paysLifeX && !object.manaCost.includes('{X}')
    ? state.players[seat].life
    : paysLifeX
      ? Math.min(manaUpper, state.players[seat].life)
      : manaUpper
  if (!state.castableZones.includes(object.zone)) return []
  return Array.from({ length: upper + 1 }, (_, x) => x)
    .flatMap((x): AvailableAction[] => fundedVariants({
      kind: 'castSpell',
      objectId: object.id,
      name: object.name,
      x,
    }, { x }))
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

const cardRuleActions = (state: GameState, object: GameObject, seat: PlayerId) => {
  if (object.controller !== seat) return []
  if (object.zone === 'graveyard' && object.owner !== seat) return []
  const objectZone = object.zone
  if (objectZone === 'battlefield' && isPhasedOut(object)) return []
  if (
    objectZone !== 'battlefield'
    && objectZone !== 'graveyard'
    && objectZone !== 'hand'
  ) return []
  return effectsOf(object).flatMap((effect): AvailableAction[] => {
    if (effect.op === 'activate' && !effect.manaAbility) {
      const requiredZone = effect.zone ?? 'battlefield'
      if (objectZone !== requiredZone) return []
      const loyalty = effect.costs.loyalty
      if (
        !canPayActivateCosts(state, object, seat, effect.costs)
        || !conditionHolds(effect.if, state, object)
        || (
          (loyalty !== undefined || effect.sorcery)
          && (
            state.active !== seat
            || !MAIN_STEPS.has(state.step)
            || state.stack.length > 0
            || (
              loyalty !== undefined
              && (
                object.loyaltyActivatedTurn === state.turn
                || (loyalty < 0 && (object.counters.loyalty ?? 0) < -loyalty)
              )
            )
          )
        )
      ) {
        return []
      }
      if (effect.targets === 'room') {
        const rooms = Object.values(state.objects).filter((candidate) =>
          candidate.zone === 'battlefield'
          && candidate.controller === seat
          && candidate.roomDoors)
        return rooms.flatMap((room) =>
          (['left', 'right'] as const).flatMap((door): AvailableAction[] => {
            const characteristics = roomDoor(room, door)
            if (!characteristics) return []
            return [{
              kind: 'activateAbility',
              objectId: object.id,
              name: object.name,
              text: `Lock or unlock ${characteristics.name}`,
              abilityId: effect.id,
              targetObjectIds: [room.id],
              door,
            }]
          }))
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
      objectZone === 'battlefield'
      && effect.op === 'search'
      && effect.via === 'ability'
      && object.zone === 'battlefield'
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
}

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
  const freeCast = pendingFreeCastFor(state, seat)
  if (freeCast) {
    const object = state.objects[freeCast.objectId]
    return [
      ...(object && canCastAtTiming(state, seat, object, true)
        ? [{
            kind: 'castSpell' as const,
            objectId: object.id,
            name: object.name,
            alternativeCost: 'withoutPayingMana' as const,
          }]
        : []),
      {
        kind: 'declineFreeCast',
        objectId: freeCast.objectId,
        name: object?.name ?? 'free cast',
      },
    ]
  }
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
    const playableLands = [
      ...hand,
      ...state.zoneOrder[seat].exile.filter((id) => state.objects[id]?.adventureReady),
    ]
    for (const id of playableLands) {
      const object = state.objects[id]
      if (object && (object.types.includes('Land') || landFaceOf(object))) {
        actions.push({ kind: 'playLand', objectId: id, name: object.name })
      }
      if (object && canForetellFromHand(state, seat, object)) {
        actions.push({ kind: 'foretell', objectId: id, name: object.name })
      }
    }
  }

  for (const object of Object.values(state.objects)) {
    actions.push(...castActions(state, seat, object))
    if (
      object.roomDoors
      && object.zone === 'battlefield'
      && object.controller === seat
      && state.active === seat
      && MAIN_STEPS.has(state.step)
      && state.stack.length === 0
    ) {
      for (const door of ['left', 'right'] as const) {
        const characteristics = roomDoor(object, door)
        if (
          characteristics
          && !object.unlockedDoors?.includes(door)
          && canFund(state, seat, characteristics.manaCost)
        ) {
          actions.push({
            kind: 'unlockDoor',
            objectId: object.id,
            name: object.name,
            door,
            doorName: characteristics.name,
          })
        }
      }
    }
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
        && !object.phasedOut
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
        if (object.zone !== 'battlefield' || object.phasedOut || !object.attacking) return false
        if (typeof object.attacking === 'string') return object.attacking === seat
        if (object.attacking.kind === 'player') return object.attacking.player === seat
        return state.objects[object.attacking.objectId]?.controller === seat
      })
      .map((object) => object.id)
    const objectIds = Object.values(state.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && !object.phasedOut
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
  if (source && action.castOption === 'bestow' && bestowEffect(source)) {
    return Object.values(state.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && object.types.includes('Creature'))
      .map((target) => ({
        ...action,
        targetObjectId: target.id,
        targetName: target.name,
      }))
  }
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
  const filter = targetedEffectFilter(effect, action.kicked === true)
  const count = effect.count ?? 1
  const objectMatches = Object.values(state.objects)
    .filter((object) =>
      validTargetRef(
        state,
        { kind: 'object', objectId: object.id },
        filter,
        seat,
        action.castOption,
      ))
  if (count > 1) {
    if (objectMatches.length < count) return []
    return [{
      ...action,
      targetGroups: [{
        label: 'Targets',
        min: count,
        max: count,
        targets: objectMatches.map((target) => ({
          objectId: target.id,
          name: target.name,
          controller: target.controller,
        })),
      }],
    }]
  }
  const objectTargets = objectMatches
    .map((target): AvailableAction => ({
      ...action,
      targetObjectId: target.id,
      targetName: target.name,
    }))
  const playerTargets = state.playerOrder
    .filter((player) =>
      validTargetRef(
        state,
        { kind: 'player', player },
        filter,
        seat,
        action.castOption,
      ))
    .map((player): AvailableAction => ({
      ...action,
      targetPlayerId: player,
      targetName: player,
    }))
  return [...objectTargets, ...playerTargets].filter((candidate) => {
    if (candidate.kind !== 'castSpell') return false
    const face = castFaceOf(source)
    const spell = face ? { ...source, ...face } : source
    const targets = candidate.targetObjectId
      ? [{ kind: 'object' as const, objectId: candidate.targetObjectId }]
      : candidate.targetPlayerId
        ? [{ kind: 'player' as const, player: candidate.targetPlayerId }]
        : []
    return canFund(state, seat, spellCost(state, spell, {
      additionalGeneric: taxFor(state, seat, source),
      castOption: candidate.castOption,
      kicked: candidate.kicked,
      timesKicked: candidate.timesKicked,
      targets,
      seat,
    }), {
      phyrexianLife: candidate.phyrexianLife ?? [],
      creatures: (candidate.convoke ?? [])
        .map((objectId) => state.objects[objectId])
        .filter((creature): creature is GameObject => Boolean(creature))
        .map(convokeColors),
    }, spell)
  })
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
  if (effect?.targets && typeof effect.targets === 'object') {
    const filter = 'filter' in effect.targets
      ? effect.targets.filter
      : effect.targets
    return {
      ...action,
      targetGroups: [
        ...costGroups,
        {
          label: 'Target',
          min: 1,
          max: 1,
          targets: Object.values(state.objects)
            .filter((object) => validTargetRef(
              state,
              { kind: 'object', objectId: object.id },
              filter,
              source?.controller ?? state.priority ?? '',
            ))
            .map((object) => ({
              objectId: object.id,
              name: object.name,
              controller: object.controller,
            })),
        },
      ],
    }
  }
  if (
    effect?.targets === 'creature'
    || effect?.targets === 'land'
    || effect?.targets === 'any'
    || effect?.targets === 'legendary'
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
          label: effect.targets === 'legendary' ? 'Legendary permanent' : type ?? 'Permanent',
          min: 1,
          max: 1,
          targets: targets
            .filter((object) =>
              effect.targets === 'legendary'
                ? object.supertypes.includes('Legendary')
                : !type || object.types.includes(type))
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
    targetObjectIds?: string[]
    targetPlayerId?: string
    x?: number
    kicked?: boolean
    timesKicked?: number
    giftPromised?: boolean
    giftRecipientId?: string
    spreeModes?: string[]
    castOption?: string
    phyrexianLife?: number[]
    alternativeCost?: 'withoutPayingMana'
    door?: RoomDoorId
    adventureCast?: boolean
    stackId?: string
    selectionId?: string
    triggerId?: string
  },
) => {
  if (left.kind !== right.kind) return false
  if ('objectId' in left && left.objectId !== right.objectId) return false
  if (left.kind === 'tapForMana') return left.mana === right.mana
  if (left.kind === 'activateAbility') {
    const samePickedTargets = (left.targetGroups?.length ?? 0) > 0
      || JSON.stringify(left.targetObjectIds ?? []) === JSON.stringify(right.targetObjectIds ?? [])
    return left.abilityId === right.abilityId
      && left.text === right.text
      && left.mana === right.mana
      && left.door === right.door
      && samePickedTargets
  }
  if (left.kind === 'castSpell') {
    return left.targetObjectId === right.targetObjectId
      && left.targetPlayerId === right.targetPlayerId
      && left.x === right.x
      && left.kicked === right.kicked
      && left.giftPromised === right.giftPromised
      && left.giftRecipientId === right.giftRecipientId
      && JSON.stringify(left.spreeModes ?? []) === JSON.stringify(right.spreeModes ?? [])
      && left.timesKicked === right.timesKicked
      && left.castOption === right.castOption
      && JSON.stringify(left.phyrexianLife ?? []) === JSON.stringify(right.phyrexianLife ?? [])
      && left.alternativeCost === right.alternativeCost
      && left.door === right.door
      && left.adventureCast === right.adventureCast
  }
  if (left.kind === 'unlockDoor') return left.door === right.door
  if (left.kind === 'foretell') return true
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
  extras: { creatures?: GameObject[]; phyrexianLife?: number[] } = {},
  spell?: GameObject,
): GameEvent[] | null => {
  const sources = Object.values(state.objects)
    .filter((object) => sourceCanTap(object, seat, state) && !excluded.has(object.id))
    .map((source) => {
      const modes = manaModes(source, state)
      const restricted = effectsOf(source).some((effect) => effect.op === 'restrictedMana')
      return {
        source,
        modes: restricted && !canUseRestrictedMana(state, seat, spell, source.chosenType)
          ? modes.filter((mode) => (mode.C ?? 0) > 0)
          : modes,
      }
    })
    .filter(({ modes }) => modes.length > 0)
  const available = { ...(state.players[seat]?.mana ?? emptyMana()) }
  for (const mana of state.players[seat]?.restrictedMana ?? []) {
    if (canUseRestrictedMana(state, seat, spell, mana.creatureType)) available[mana.mana] += 1
  }
  let plans = [{
    pool: available,
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
    .filter((plan) => payCost(plan.pool, cost, {
      creatures: (extras.creatures ?? []).map(convokeColors),
      phyrexianLife: extras.phyrexianLife ?? [],
    }))
    .sort((left, right) => left.events.length - right.events.length)[0]
    ?.events ?? null
}

const combinationsOf = <T>(values: T[], count: number) => {
  const combinations: T[][] = []
  const visit = (start: number, chosen: T[]) => {
    if (chosen.length === count) {
      combinations.push(chosen)
      return
    }
    for (let index = start; index < values.length; index += 1) {
      visit(index + 1, [...chosen, values[index]])
    }
  }
  visit(0, [])
  return combinations
}

const convokeFundingPlan = (
  state: GameState,
  seat: PlayerId,
  cost: string,
  phyrexianLife: number[] = [],
): { convoke: string[]; mana: GameEvent[] } | null => {
  const candidates = Object.values(state.objects).filter((object) =>
    object.zone === 'battlefield'
    && object.controller === seat
    && object.types.includes('Creature')
    && !object.tapped)
  const symbols = genericCostForAction(cost)
    + [...cost.matchAll(/\{[WUBRGC](?:\/[WUBRGC])?\}/g)].length
  for (let count = 1; count <= Math.min(symbols, candidates.length); count += 1) {
    for (const creatures of combinationsOf(candidates, count)) {
      const ids = creatures.map((creature) => creature.id)
      const mana = fundingEvents(state, seat, cost, new Set(ids), {
        creatures,
        phyrexianLife,
      })
      if (mana) return { convoke: ids, mana }
    }
  }
  return null
}

const genericCostForAction = (cost: string) =>
  [...cost.matchAll(/\{(\d+)\}/g)].reduce((total, match) => total + Number(match[1]), 0)

export const eventsForCombatDeclaration = (
  state: GameState,
  event:
    | { type: 'declareAttackers'; seat: PlayerId; attackers: AttackerDecl[] }
    | { type: 'declareBlockers'; seat: PlayerId; blockers: BlockerDecl[] },
): GameEvent[] | null => {
  if (event.type === 'declareAttackers') {
    const goadError = attackDeclarationError(state, event.seat, event.attackers)
    if (goadError) return null
  }
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
  if (action.kind === 'declineFreeCast') {
    return [{ type: 'declineFreeCast', seat, objectId: action.objectId }]
  }
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
    if (
      action.door
      && action.targetObjectIds?.[0]
    ) {
      const targeted = activateEffect(effectsOf(object), action.abilityId)
      if (targeted?.targets === 'room') {
        return [{
          type: 'activateAbility',
          abilityId: targeted.id,
          seat,
          objectId: object.id,
          targets: [{ kind: 'object', objectId: action.targetObjectIds[0] }],
          door: action.door,
        }]
      }
    }
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
  if (action.kind === 'unlockDoor') {
    const object = state.objects[action.objectId]
    const door = object && roomDoor(object, action.door)
    if (!object || !door) return null
    const mana = fundingEvents(state, seat, door.manaCost)
    if (!mana) return null
    return [
      ...mana,
      {
        type: 'unlockDoor',
        seat,
        objectId: object.id,
        door: action.door,
      },
    ]
  }
  if (action.kind === 'foretell') {
    const object = state.objects[action.objectId]
    if (!object || !canForetellFromHand(state, seat, object)) return null
    const mana = fundingEvents(state, seat, FORETELL_ACTION_COST)
    if (!mana) return null
    return [
      ...mana,
      {
        type: 'foretell',
        seat,
        objectId: object.id,
      },
    ]
  }
  if (action.kind !== 'castSpell') return null
  const card = state.objects[action.objectId]
  // CR 709.3b: only the chosen door is cast, so read this line off that door
  // rather than off the combined card.
  const door = card && action.door ? asRoomDoor(card, action.door) : undefined
  if (action.door && !door) return null
  const object = door ?? card
  const effects = object ? effectsOf(object) : []
  const targeted = effects.filter((effect) => effect.op === 'targetedResolve')
  // A door's enter and unlock triggers go on the stack like any other trigger,
  // so their printed wording is no reason to hand the cast to the judge.
  const doorTriggers = Boolean(action.door)
    && effects.some((effect) =>
      effect.op === 'trigger' && (effect.on === 'enters' || effect.on === 'unlock'))
  const resolvesThroughKernel = doorTriggers
    || (object
      ? effects.some((effect) =>
        (effect.op === 'trigger' && effect.on === 'resolve')
        || (effect.op === 'castCost' && effect.spree)
        || (effect.op === 'search' && effect.via === 'spell')
        || (
          effect.op === 'handler'
          && effect.pluginId === 'combatPreventionCards'
        )
        || effect.op === 'playerAuraDeal')
      : false)
  const playerAura = object
    ? effectsOf(object).some((effect) => effect.op === 'playerAuraDeal')
    : false
  const hasDeclarativeAdditionalCost = object
    ? effectsOf(object).some((effect) =>
        effect.op === 'castCost' && (effect.lifeX || effect.kicker || effect.gift || effect.spree || effect.multikicker))
    : false
  const hasAlternateCast = object ? alternateCastEffects(object).length > 0 : false
  const hasBestowCast = object ? Boolean(bestowEffect(object)) : false
  const foretoldCast = Boolean(
    object
    && action.castOption === FORETELL_CAST_ID
    && canCastForetold(state, object),
  )
  if (
    !object
    || (
      !foretoldCast
      && targeted.length === 0
      && !object.types.some((type) => SIMPLE_PERMANENT.has(type))
      && !resolvesThroughKernel
    )
    || targeted.length > 1
    || (targeted.length === 0 && !playerAura && /\btarget\b/i.test(object.oracleText))
    || (
      !hasAlternateCast
      && !hasBestowCast
      && !doorTriggers
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
  const bestowing = action.castOption === 'bestow' && hasBestowCast
  const requiredTargets = targeted.length === 1 ? (targeted[0].count ?? 1) : targeted.length
  if (requiredTargets > 1) {
    if ((action.targetObjectIds?.length ?? 0) !== requiredTargets) return null
  } else if ((targeted.length === 1 || playerAura || bestowing) && !action.targetObjectId) {
    return null
  }
  const blinkTargets = action.targetObjectIds
    ?? (action.targetObjectId ? [action.targetObjectId] : [])
  if (
    ['Ephemerate', 'Vanish into Memory'].includes(object.name)
    && blinkTargets.length !== 1
  ) return null
  if (object.name === 'Ghostly Flicker' && blinkTargets.length !== 2) return null
  const tax = taxFor(state, seat, object)
  const face = resolveCastFace(object, {
    door: action.door,
    adventureCast: action.adventureCast,
  })
  const casting = face ? { ...object, ...face } : object
  const alternative = action.castOption
    ? availableAlternateCastEffect(state, seat, object, action.castOption)
    : undefined
  const targets = action.targetObjectId || action.targetObjectIds
    ? (
        playerAura
          ? [{ kind: 'player' as const, player: action.targetObjectId! }]
          : blinkTargets.map((objectId) => ({
              kind: 'object' as const,
              objectId,
            }))
      )
    : action.targetPlayerId
      ? [{ kind: 'player' as const, player: action.targetPlayerId }]
      : []
  const cost = spellCost(state, casting, {
    additionalGeneric: tax,
    x: action.x,
    castOption: alternative?.id ?? action.castOption,
    kicked: action.kicked,
    spreeModes: action.spreeModes,
    timesKicked: action.timesKicked,
    targets,
    seat,
    withoutPayingMana: action.alternativeCost === 'withoutPayingMana',
  })
  const convoke = (action.convoke ?? [])
    .map((objectId) => state.objects[objectId])
    .filter((creature): creature is GameObject => Boolean(creature))
  const mana = fundingEvents(
    state,
    seat,
    cost,
    new Set(convoke.map((creature) => creature.id)),
    { creatures: convoke, phyrexianLife: action.phyrexianLife },
    casting,
  )
  if (!mana) return null
  return [
    ...mana,
    {
      type: 'castSpell',
      seat,
      objectId: object.id,
      ...(action.alternativeCost ? { alternativeCost: action.alternativeCost } : {}),
      ...(action.castOption ? { castOption: action.castOption } : {}),
      ...(action.convoke ? { convoke: action.convoke } : {}),
      ...(action.phyrexianLife ? { phyrexianLife: action.phyrexianLife } : {}),
      ...(action.kicked ? { kicked: true } : {}),
      ...(action.giftPromised ? { giftPromised: true } : {}),
      ...(action.giftRecipientId ? { giftRecipient: action.giftRecipientId } : {}),
      ...(action.spreeModes && action.spreeModes.length > 0
        ? { spreeModes: action.spreeModes }
        : {}),
      ...(action.timesKicked !== undefined ? { timesKicked: action.timesKicked } : {}),
      ...(action.door ? { door: action.door } : {}),
      ...(action.adventureCast ? { adventureCast: true } : {}),
      ...(action.targetObjectIds && alternative?.discard
        ? { discard: action.targetObjectIds.slice(0, 1) }
        : {}),
      ...(action.targetObjectIds && alternative?.sacrifice
        ? { sacrifice: action.targetObjectIds.slice(0, alternative.sacrifice.count) }
        : {}),
      ...(action.targetObjectIds && alternative?.exileGraveyard
        ? { exile: action.targetObjectIds.slice(0, alternative.exileGraveyard.count) }
        : {}),
      ...(targets.length > 0 ? { targets } : {}),
      ...(action.x !== undefined ? { x: action.x } : {}),
    },
  ]
}
