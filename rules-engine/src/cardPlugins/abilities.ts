import type { ZoneId } from '../types'
import type { ColorSet } from '../../../shared/cardColors'
import type { ActivateCost, CardCondition, CardEffect, CardInstruction, SagaChapter, SearchSpec, TargetFilter } from './effectDefinitions'
import { basicLand } from './effectRuntime'
import { draw, putPermanentFromGraveyard } from './instructions'
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

export const targetingRequirement = (
  kind: Extract<CardEffect, { op: 'targetingRequirement' }>['kind'],
): CardEffect => ({ op: 'targetingRequirement', kind })

export const playerAuraDeal = (): CardEffect => ({
  op: 'playerAuraDeal',
  drawAtEnchantedEnd: 1,
  breakOnMutualAttack: true,
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
  options: { colors: ColorSet; extraSubtypes: string[] },
): CardEffect => activate({
  id: 'embalm',
  zone: 'graveyard',
  sorcery: true,
  costs: { mana: manaCost, exileFromGraveyard: true },
  do: [{
    kind: 'embalmToken',
    colors: options.colors,
    extraSubtypes: [...options.extraSubtypes],
  }],
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

export const sagaChapters = (...chapters: SagaChapter[]): CardEffect => ({
  op: 'saga',
  chapters,
})
