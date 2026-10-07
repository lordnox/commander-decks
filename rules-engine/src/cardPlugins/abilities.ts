import type { ZoneId } from '../types'
import type { ActivateCost, CardCondition, CardEffect, CardInstruction, CastCostCondition, GiftSpec, ModalMode, SagaChapter, SearchSpec, SpreeMode, TargetFilter } from './effectDefinitions'
import { basicLand } from './effectRuntime'
import { draw, pumpControlled, putPermanentFromGraveyard } from './instructions'
import { yourUpkeep } from './triggers'

export const unearth = (manaCost: string): CardEffect =>
  activate({
    id: 'unearth',
    zone: 'graveyard',
    sorcery: true,
    costs: { mana: manaCost },
    do: [{ kind: 'unearthSelf' }],
  })

export const MONSTROSITY_ABILITY = 'monstrosity'

export const monstrosity = (manaCost: string, count: number): CardEffect =>
  activate({
    id: MONSTROSITY_ABILITY,
    costs: { mana: manaCost },
    if: { kind: 'notMonstrous' },
    do: [{ kind: 'monstrosity', count }],
  })

export const onResolve = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'resolve',
  do: instructions,
})

export const onResolveIfCastOption = (
  castOption: string,
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'trigger',
  on: 'resolve',
  if: { kind: 'castOption', id: castOption },
  do: instructions,
})

export const targetingRequirement = (
  kind: Extract<CardEffect, { op: 'targetingRequirement' }>['kind'],
): CardEffect => ({ op: 'targetingRequirement', kind })

export const playerAuraDeal = (): CardEffect => ({
  op: 'playerAuraDeal',
  drawAtEnchantedEnd: 1,
  breakOnMutualAttack: true,
})

export const restrictedCreatureMana = (): CardEffect => ({
  op: 'restrictedMana',
  creatureOfChosenType: true,
  uncounterable: true,
})

export const restrictedLegendaryMana = (): CardEffect => ({
  op: 'restrictedMana',
  legendary: true,
  uncounterable: true,
})

export const bestow = (
  cost: string,
  bonus: { power: number; toughness: number },
): CardEffect => ({ op: 'bestow', cost, ...bonus })

export const handler = (pluginId: string): CardEffect => ({
  op: 'handler',
  pluginId,
})

export const activate = (effect: Omit<Extract<CardEffect, { op: 'activate' }>, 'op'>): CardEffect => ({
  op: 'activate',
  ...effect,
})

/** Cycling or typecycling from hand: discard self, pay mana, then draw or library-search on resolve. */
export const cycleHand = (
  id: string,
  mana: string,
  outcome: 'draw' | { subtype: string } = 'draw',
): CardEffect => activate({
  id,
  zone: 'hand',
  costs: { mana, discard: 'self' },
  do: outcome === 'draw'
    ? [draw(1)]
    : [{ kind: 'searchLibrary', subtype: outcome.subtype }],
  cycling: true,
})

export const typecycleHand = (
  id: string,
  mana: string,
  subtype: string,
): CardEffect => cycleHand(id, mana, { subtype })

export const crew = (power: number): CardEffect => activate({
  id: `crew.${power}`,
  costs: { crew: power },
  do: [{ kind: 'crewVehicle' }],
})

/** Compose one activated ability from a cost and reusable effect instructions. */
export const ability = (
  options: Omit<Extract<CardEffect, { op: 'activate' }>, 'op' | 'costs' | 'do'>,
  costs: ActivateCost,
  ...instructions: CardInstruction[]
): CardEffect => activate({ ...options, costs, do: instructions })

export const loyalty = (amount: number): ActivateCost => ({ loyalty: amount })

export const loyaltyX = (): ActivateCost => ({ loyalty: 0, loyaltyX: true })

export const energyCost = (amount: number): ActivateCost => ({ energy: amount })

export const payLifeX = (
  options: { timing?: 'yourEndStep' } = {},
): CardEffect => ({ op: 'castCost', lifeX: true, ...options })

export const convoke = (): CardEffect => ({ op: 'castCost', convoke: true })

export const delve = (): CardEffect => ({ op: 'castCost', delve: true })

export const kicker = (cost: string): CardEffect => ({
  op: 'castCost',
  kicker: cost,
})

export const gift = (spec: GiftSpec): CardEffect => ({
  op: 'castCost',
  gift: spec,
})

export const spreeMode = (
  id: string,
  label: string,
  extraCost: string,
  instructions: CardInstruction[],
): SpreeMode => ({ id, label, extraCost, do: instructions })

export const spree = (modes: SpreeMode[]): CardEffect => ({
  op: 'castCost',
  spree: modes,
})

export const multikicker = (cost: string): CardEffect => ({
  op: 'castCost',
  multikicker: cost,
})

export const reduceGenericIf = (
  amount: number,
  condition: CastCostCondition,
): CardEffect => ({
  op: 'castCost',
  reduceGeneric: { amount, if: condition },
})

export const alternateCast = (
  id: string,
  label: string,
  manaCost: string,
  extra: {
    life?: number
    controlledSubtype?: string
    fromZone?: ZoneId
    exileAfterUse?: boolean
    discard?: 'land'
    sacrifice?: { type: string; count: number }
    afterWarp?: boolean
    exileGraveyard?: { count: number; other?: boolean }
  } = {},
): CardEffect => ({ op: 'alternateCast', id, label, manaCost, ...extra })

export const cleave = (cost: string): CardEffect =>
  alternateCast('cleave', `Cleave ${cost}`, cost)

export const flashback = (
  label: string,
  manaCost: string,
  extra: { sacrifice?: { type: string; count: number } } = {},
): CardEffect => alternateCast('flashback', label, manaCost, {
  fromZone: 'graveyard',
  exileAfterUse: true,
  ...extra,
})

/** Warp from hand, exile at the next end step, then cast from exile for the printed cost. */
export const warp = (warpCost: string): CardEffect[] => [
  alternateCast('warp', `Warp ${warpCost}`, warpCost, { fromZone: 'hand' }),
  alternateCast('warp-from-exile', 'Cast from exile', '__printed__', {
    fromZone: 'exile',
    afterWarp: true,
  }),
]

/** Graveyard activated ability: one copy token per opponent, haste, encore attack restriction. */
export const encore = (manaCost: string): CardEffect => ability(
  { id: 'encore', zone: 'graveyard', sorcery: true },
  { mana: manaCost, exileSelf: true },
  { kind: 'encoreTokens' },
)

export const embalm = (
  manaCost: string,
  options: { colors: string[]; extraSubtypes: string[] },
): CardEffect => activate({
  id: 'embalm',
  zone: 'graveyard',
  sorcery: true,
  costs: { mana: manaCost, exileFromGraveyard: true },
  do: [{
    kind: 'embalmToken',
    colors: [...options.colors],
    extraSubtypes: [...options.extraSubtypes],
  }],
})

export const foretell = (manaCost: string): CardEffect => ({
  op: 'foretell',
  manaCost,
})

export const escape = (
  manaCost: string,
  exileCount: number,
): CardEffect => alternateCast(
  'escape',
  `Escape—${manaCost}, Exile ${exileCount} other cards from your graveyard.`,
  manaCost,
  {
    fromZone: 'graveyard',
    exileGraveyard: { count: exileCount, other: true },
  },
)

export const uncounterable = (): CardEffect => ({ op: 'spellTrait', uncounterable: true })

export const xMana = (color: 'generic' | 'black' = 'generic'): CardEffect => ({
  op: 'castCost',
  xMana: color,
})

export const yourUpkeepPutPermanentFromGraveyard = (): CardEffect =>
  yourUpkeep(putPermanentFromGraveyard())

export const manaIf = (condition: CardCondition): CardEffect => ({
  op: 'mana',
  if: condition,
})

export const manaFrom = (
  from: Extract<CardEffect, { op: 'manaCapability' }>['from'],
): CardEffect => ({
  op: 'manaCapability',
  from,
})

export const targetOnResolve = (
  action: Extract<CardEffect, { op: 'targetedResolve' }>['action'],
  filter: TargetFilter,
  ...instructions: CardInstruction[]
): Extract<CardEffect, { op: 'targetedResolve' }> => ({
  op: 'targetedResolve',
  target: 0,
  filter,
  action,
  ...(instructions.length > 0 ? { do: instructions } : {}),
})

export const targetsOnResolve = (
  action: Extract<CardEffect, { op: 'targetedResolve' }>['action'],
  filter: TargetFilter,
  options: {
    count?: number
    tapped?: boolean
    sacrificeThen?: { type: string }
  },
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'targetedResolve',
  target: 0,
  filter,
  action,
  ...(options.count !== undefined ? { count: options.count } : {}),
  ...(options.tapped ? { tapped: true } : {}),
  ...(options.sacrificeThen ? { sacrificeThen: options.sacrificeThen } : {}),
  ...(instructions.length > 0 ? { do: instructions } : {}),
})

export const optionalTargetOnResolve = (
  action: Extract<CardEffect, { op: 'targetedResolve' }>['action'],
  filter: TargetFilter,
  ...instructions: CardInstruction[]
): CardEffect => ({
  ...targetOnResolve(action, filter, ...instructions),
  optional: true,
  min: 0,
  max: 1,
})

export const upToTargetsOnResolve = (
  max: number,
  action: Extract<CardEffect, { op: 'targetedResolve' }>['action'],
  filter: TargetFilter,
  ...instructions: CardInstruction[]
): CardEffect => ({
  ...targetOnResolve(action, filter, ...instructions),
  optional: true,
  min: 0,
  max,
})

export const targetOnResolveKicked = (
  action: Extract<CardEffect, { op: 'targetedResolve' }>['action'],
  filter: TargetFilter,
  kickedFilter: TargetFilter,
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'targetedResolve',
  target: 0,
  filter,
  kickedFilter,
  action,
  ...(instructions.length > 0 ? { do: instructions } : {}),
})

export const targetOnResolveAt = (
  target: number,
  action: Extract<CardEffect, { op: 'targetedResolve' }>['action'],
  filter: TargetFilter,
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'targetedResolve',
  target,
  filter,
  action,
  ...(instructions.length > 0 ? { do: instructions } : {}),
})

export const searchSpell = (spec: SearchSpec): CardEffect => ({
  op: 'search',
  via: 'spell',
  spec,
})

export const searchAbility = (spec: SearchSpec, costs: ActivateCost): CardEffect => ({
  op: 'search',
  via: 'ability',
  spec,
  costs,
})

export const splitBasicLandSearch = (): SearchSpec => ({
  prompt: 'Search your library for up to two basic land cards. Put one onto the battlefield tapped and the other into your hand.',
  match: basicLand,
  destination: 'battlefield',
  min: 0,
  max: 2,
  split: {
    battlefield: { min: 0, max: 1, tapped: true },
    hand: { min: 0, max: 1 },
    totalMax: 2,
    paired: true,
  },
})

export const optionalBasicLandEnters = (): SearchSpec => ({
  prompt: 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
  match: basicLand,
  destination: 'battlefield',
  tapped: true,
  min: 0,
  max: 1,
  sacrificeSource: false,
  optionalEnter: true,
})

export const pumpControlledNonHuman = (power: number, toughness: number) =>
  pumpControlled(power, toughness, { nonHuman: true })

export const modalChooseOne = (...modes: ModalMode[]): CardEffect => ({
  op: 'modal',
  choose: 'one',
  modes,
})

export const modalChooseTwo = (...modes: ModalMode[]): CardEffect => ({
  op: 'modal',
  choose: 'two',
  modes,
})

export const modalCommanderChooseBoth = (...modes: ModalMode[]): CardEffect => ({
  op: 'modal',
  choose: 'one',
  commanderChooseBoth: true,
  modes,
})

export const sagaChapters = (...chapters: SagaChapter[]): CardEffect => ({
  op: 'saga',
  chapters,
})
