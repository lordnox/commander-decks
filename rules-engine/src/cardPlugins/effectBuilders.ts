import type { TriggerBindingIf, ZoneId } from '../types'
import type {
  ActivateCost,
  CardCondition,
  CastCostCondition,
  CardEffect,
  CardInstruction,
  ModalMode,
  ModalSpec,
  SpreeMode,
  SearchSpec,
  RevealUntilNonMatch,
  TargetFilter,
  GiftSpec,
  TokenSpec,
} from './effectDefinitions'
import { basicLand } from './effectRuntime'

export const selfMill = (count: number): CardInstruction => ({ kind: 'selfMill', count })

export const dredge = (count: number): CardEffect => ({ op: 'dredge', count })

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

export const onBecomesMonstrous = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'becomesMonstrous',
  do: instructions,
})

export const enters = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'enters',
  do: instructions,
})

export const entersIfCastOption = (
  castOption: string,
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'trigger',
  on: 'enters',
  do: instructions,
  if: { kind: 'castOption', id: castOption },
})

export const entersTargetingOpponent = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'enters',
  targets: 'opponent',
  do: instructions,
})

export const entersTarget = (
  filter: TargetFilter,
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'trigger',
  on: 'enters',
  targets: { filter },
  do: instructions,
})

export type BlinkOptions = {
  returnController?: 'owner' | 'controller'
  when?: 'immediate' | 'nextEndStep'
  plusCounters?: number
  targetIndex?: number
  optional?: boolean
  filter?: TargetFilter
  prompt?: string
}

export const blink = (options: BlinkOptions = {}): CardInstruction => ({
  kind: 'blink',
  returnController: 'owner',
  when: 'immediate',
  ...options,
})

export const dies = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'dies',
  do: instructions,
})

/** When this dies as a creature, return under its owner's control as a noncreature enchantment. */
export const diesReturnAsEnchantment = (): CardEffect => ({
  op: 'trigger',
  on: 'dies',
  if: { kind: 'wasCreature' },
  do: [{ kind: 'returnSelfAsEnchantment' }],
})

export const leaves = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'leaves',
  do: instructions,
})

export const landfall = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'landfall',
  do: instructions,
})

export const landfallOnceEachTurn = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'landfall',
  do: instructions,
  onceEachTurn: true,
})

export const landfallResolveNth = (
  nth: number,
  base: CardInstruction[],
  alternate: CardInstruction[],
): CardEffect => ({
  op: 'trigger',
  on: 'landfall',
  do: base,
  whenResolvedNth: { nth, do: alternate },
})

export const onResolve = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'resolve',
  do: instructions,
})

export const entersTapped = (condition?: CardCondition): CardEffect => ({
  op: 'replacement',
  on: 'enters',
  do: 'tapSelf',
  ...(condition ? { if: condition } : {}),
})

export const otherLands = (
  bounds: { min?: number; max?: number; subtype?: string },
): CardCondition => ({ kind: 'otherLands', ...bounds })

export const controlledLands = (bounds: { min?: number; max?: number }): CardCondition => ({
  kind: 'controlledLands',
  ...bounds,
})

export const controlledBasicLands = (
  bounds: { min?: number; max?: number },
): CardCondition => ({
  kind: 'controlledBasicLands',
  ...bounds,
})

export const uniqueLandNames = (min: number): CardCondition => ({
  kind: 'uniqueLandNames',
  min,
})

export const controlledCreaturePower = (min: number): CardCondition => ({
  kind: 'controlledCreaturePower',
  min,
})

export const graveyardCards = (min: number): CardCondition => ({
  kind: 'graveyardCards',
  min,
})

export const graveyardPermanentCards = (min: number): CardCondition => ({
  kind: 'graveyardPermanentCards',
  min,
})

export const graveyardCardTypes = (min: number): CardCondition => ({
  kind: 'graveyardCardTypes',
  min,
})

export const extraLandPlays = (count: number): CardInstruction => ({
  kind: 'extraLandPlays',
  count,
})

export const surveil = (count: number): CardInstruction => ({ kind: 'surveil', count })

export const scry = (count: number): CardInstruction => ({ kind: 'scry', count })

export const putLandFromHand = (tapped = false): CardInstruction => ({
  kind: 'putLandFromHand',
  tapped,
})

export const bounceChosenLand = (): CardInstruction => ({ kind: 'bounceChosenLand' })

export const revealPick = (
  count: number,
  extra: { type?: string; permanent?: boolean } = {},
): CardInstruction => ({ kind: 'revealPick', count, ...extra })

export const copyControlledCreature = (extra: {
  notLegendary?: boolean
  plusCounters?: number
  keepName?: boolean
} = {}): CardInstruction => ({ kind: 'copyControlledCreature', ...extra })

export const copyTargetCreature = (extra: {
  notLegendary?: boolean
  flying?: boolean
} = {}): CardInstruction => ({ kind: 'copyTargetCreature', ...extra })

export const becomeCopyOfTarget = (extra: {
  filter: TargetFilter
  keepAbility?: boolean
}): CardInstruction => ({ kind: 'becomeCopyOfTarget', ...extra })

export const returnTargetFromGraveyard = (
  to: 'hand' | 'battlefield',
  tapped = false,
  optional = false,
): CardInstruction => ({
  kind: 'returnTargetFromGraveyard',
  to,
  tapped,
  optional,
})

export const pump = (power: number, toughness: number): CardInstruction => ({
  kind: 'pump',
  power,
  toughness,
})

export const pumpTargetX = (multiplier = 1): CardInstruction => ({
  kind: 'pumpTargetX',
  multiplier,
})

export const pumpSelf = (power: number, toughness: number): CardInstruction => ({
  kind: 'pumpSelf',
  power,
  toughness,
})

export const animateUntilEot = (power: number, toughness: number): CardInstruction => ({
  kind: 'animateUntilEot',
  power,
  toughness,
})

export const grantUntilEot = (...keywords: string[]): CardInstruction => ({
  kind: 'grantUntilEot',
  keywords,
})

export const goadTarget = (): CardInstruction => ({ kind: 'goadTargets' })

export const goadTargetUntilEot = (): CardInstruction => ({
  kind: 'goadTargets',
  untilEndOfTurn: true,
export const phaseOutControlled = (): CardInstruction => ({ kind: 'phaseOutControlled' })

export const grantProtectionFromEverything = (): CardInstruction => ({
  kind: 'grantProtectionFromEverything',
})

export const lifeTotalCannotChange = (): CardInstruction => ({
  kind: 'lifeTotalCannotChange',
})

export const preventCombatDamage = (
  extra: { from?: 'target' | 'all'; toController?: boolean } = {},
): CardInstruction => ({
  kind: 'preventCombatDamage',
  from: extra.from ?? 'all',
  ...(extra.toController ? { toController: true } : {}),
})

export const untapTarget = (): CardInstruction => ({ kind: 'untapTarget' })

export const addManaPerSwamp = (basic = false): CardInstruction => ({
  kind: 'addManaPerSwamp',
  basic,
})

export const revealDrawLoseLife = (): CardInstruction => ({ kind: 'revealDrawLoseLife' })

export const gainLifeTargetPower = (): CardInstruction => ({ kind: 'gainLifeTargetPower' })

export const addUntilCleanupRule = (
  pluginId: string,
  params: Record<string, unknown> = {},
): CardInstruction => ({
  kind: 'addUntilCleanupRule',
  pluginId,
  params,
})

export const copyTargetForEachOtherPlayer = (): CardInstruction => ({
  kind: 'copyTargetForEachOtherPlayer',
})

export const combatDialogueUntilEot = (): CardInstruction => ({
  kind: 'combatDialogueUntilEot',
})

export const councilVote = (
  prompt: string,
  filter: TargetFilter,
): CardEffect => ({
  op: 'vote',
  prompt,
  filter,
  outcome: 'exile-most',
})

export const targetingRequirement = (
  kind: Extract<CardEffect, { op: 'targetingRequirement' }>['kind'],
): CardEffect => ({ op: 'targetingRequirement', kind })

export const playerAuraDeal = (): CardEffect => ({
  op: 'playerAuraDeal',
  drawAtEnchantedEnd: 1,
  breakOnMutualAttack: true,
})

export const attachedCopyOrToken = (
  cost: string,
  token: TokenSpec,
): CardInstruction => ({
  kind: 'attachedCopyOrToken',
  cost,
  token,
})

export const createXTokens = (token: TokenSpec): CardInstruction => ({
  kind: 'createXTokens',
  token,
})

export const optionalMill = (count: number): CardInstruction => ({ kind: 'optionalMill', count })

export const mayDraw = (count: number): CardInstruction => ({ kind: 'mayDraw', count })

export const chooseModes = (
  choose: 'one' | 'any',
  modes: ModalMode[],
): CardInstruction => ({ kind: 'chooseModes', choose, modes })

export const eachPlayerDiscard = (count = 1): CardInstruction => ({
  kind: 'eachPlayerDiscard',
  count,
})

export const eachPlayerDraw = (count: number): CardInstruction => ({
  kind: 'eachPlayerDraw',
  count,
})

export const eachPlayerLoseLife = (amount: number): CardInstruction => ({
  kind: 'eachPlayerLoseLife',
  amount,
})

export const eachPlayerSacrifice = (type: string): CardInstruction => ({
  kind: 'eachPlayerSacrifice',
  type,
})

export const returnChosenLandFromGraveyard = (tapped = true): CardInstruction => ({
  kind: 'returnChosenLandFromGraveyard',
  tapped,
})

export const returnCreatureManaValueX = (
  minimumX = 0,
  tapped = false,
): CardInstruction => ({ kind: 'returnCreatureManaValueX', minimumX, tapped })

export const drawAtNextUpkeep = (
  count: number,
  who: 'you' | 'targetController' = 'you',
  optional = false,
): CardInstruction => ({ kind: 'drawAtNextUpkeep', count, who, optional })

export const copyAllCreaturesUntilEot = (notLegendary = true): CardInstruction => ({
  kind: 'copyAllCreaturesUntilEot',
  notLegendary,
})

export const chooseCreatureType = (
  action: Extract<CardInstruction, { kind: 'chooseCreatureType' }>['action'],
): CardInstruction => ({ kind: 'chooseCreatureType', action })

export const tapUnlessPayLife = (life: number): CardEffect => ({
  op: 'replacement',
  on: 'enters',
  do: 'tapUnlessPayLife',
  life,
})

export const tapUnlessRevealSubtype = (...subtypes: string[]): CardEffect => ({
  op: 'replacement',
  on: 'enters',
  do: 'tapUnlessRevealSubtype',
  subtypes,
})

export const extraLandfall = (count = 1): CardEffect => ({
  op: 'static',
  extraLandfall: count,
})

export const extraEnters = (count = 1): CardEffect => ({
  op: 'static',
  extraEnters: count,
})

export const grantControlledSubtypeTrigger = (
  subtype: string,
  on: Extract<CardEffect, { op: 'trigger' }>['on'],
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'static',
  grantControlledSubtypeTrigger: { subtype, on, do: instructions },
})

export const playLandsFromGraveyard = (): CardEffect => ({
  op: 'static',
  playLandsFromGraveyard: true,
})

export const allCreatureTypes = (): CardEffect => ({
  op: 'static',
  allCreatureTypes: true,
})

export const legendRuleOff = (): CardEffect => ({
  op: 'static',
  legendRuleOff: true,
})

/** Layer 7a CDA: power and toughness each equal the chosen player's life total. */
export const ptEqualsLife = (options: { who: 'controller' | 'owner' }): CardEffect => ({
  op: 'static',
  ptEqualsLife: options,
})

export const bestow = (
  cost: string,
  bonus: { power: number; toughness: number },
): CardEffect => ({ op: 'bestow', cost, ...bonus })

export const attacks = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'attacks',
  do: instructions,
})

export const landToGraveyard = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'landToGraveyard',
  do: instructions,
})

export const landToGraveyardOnce = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'landToGraveyard',
  do: instructions,
  firstTimeEachTurn: true,
})

export const putMilledLandTapped = (): CardInstruction => ({ kind: 'putMilledLandTapped' })

export const draw = (count: number): CardInstruction => ({ kind: 'draw', count })

export const discardCards = (
  count: number,
  who: 'controller' | 'target' = 'controller',
): CardInstruction => ({ kind: 'discardCards', count, who })

export const discardHandsThenDrawGreatest = (): CardInstruction => ({
  kind: 'discardHandsThenDrawGreatest',
})

export const returnOwnedGraveyardLands = (tapped = true): CardInstruction => ({
  kind: 'returnOwnedGraveyardLands',
  tapped,
})

export const bounceSelf = (): CardInstruction => ({ kind: 'bounceSelf' })

export const createTokenInstruction = (token: TokenSpec): CardInstruction => ({
  kind: 'createToken',
  token,
})

export const copySelf = (): CardInstruction => ({ kind: 'copySelf' })

export const doublePlusCounters = (): CardInstruction => ({ kind: 'doublePlusCounters' })

export const branch = (
  condition: CardCondition,
  whenTrue: CardInstruction[],
  whenFalse?: CardInstruction[],
): CardInstruction => ({
  kind: 'if',
  if: condition,
  whenTrue,
  ...(whenFalse ? { whenFalse } : {}),
})

export const staticGrant = (pluginId: string): CardEffect => ({
  op: 'static',
  pluginId,
})

export const attackTax = (
  amount: number,
  options: { whileUntapped?: boolean } = {},
): CardEffect => ({
  op: 'static',
  attackTax: { amount, ...options },
})

export const blockTax = (
  amount: number,
  options: { whileAttacking?: boolean } = {},
): CardEffect => ({
  op: 'static',
  blockTax: { amount, ...options },
})

export const staticExtraLandPlays = (count: number): CardEffect => ({
  op: 'static',
  extraLandPlays: count,
})

export const staticRevealLibraryTop = (): CardEffect => ({
  op: 'static',
  revealLibraryTop: true,
})

export const staticPlayLandsFromLibraryTop = (): CardEffect => ({
  op: 'static',
  playLandsFromLibraryTop: true,
})

export const linkedExileUntilLeaves = (
  returnTo: 'battlefield' | 'hand' = 'battlefield',
): CardEffect => ({
  op: 'static',
  linkedExileUntilLeaves: { returnTo },
})

export const linkExile = (
  filter: TargetFilter,
  options: {
    min?: number
    max?: number
    optional?: boolean
    controlled?: boolean
    perOpponent?: { max: number }
  } = {},
): CardInstruction => ({
  kind: 'linkExile',
  filter,
  ...options,
})

export const returnLinkedExile = (
  returnTo?: 'battlefield' | 'hand',
): CardInstruction => ({
  kind: 'returnLinkedExile',
  ...(returnTo ? { returnTo } : {}),
})

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

export const getEnergy = (count: number): CardInstruction => ({ kind: 'getEnergy', count })

export const payEnergy = (count: number): CardInstruction => ({ kind: 'payEnergy', count })

export const gainLife = (count: number | 'triggerAmount'): CardInstruction => ({
  kind: 'gainLife',
  count,
})

export const drainOpponentsX = (multiplier = 1): CardInstruction => ({
  kind: 'drainOpponentsX',
  multiplier,
})

export const drawX = (): CardInstruction => ({ kind: 'drawX' })

export const dealDamageTargetX = (): CardInstruction => ({ kind: 'dealDamageTargetX' })

export const setAllLifeToLowest = (): CardInstruction => ({ kind: 'setAllLifeToLowest' })

export const gainLifeLostThisTurn = (
  who: 'controller' | 'all' = 'controller',
): CardInstruction => ({ kind: 'gainLifeLostThisTurn', who })

export const exchangeLifeWithOpponent = (
  options: { optional?: boolean; drawLifeLost?: boolean } = {},
): CardInstruction => ({ kind: 'exchangeLifeWithOpponent', ...options })

export const winGame = (): CardInstruction => ({ kind: 'winGame' })

export const addPlusCountersInstruction = (count: number): CardInstruction => ({
  kind: 'addPlusCounters',
  count,
})

export const pumpAllCreaturesByX = (multiplier = -1): CardInstruction => ({
  kind: 'pumpAllCreaturesByX',
  multiplier,
})

export const revealUntil = (
  count: number | 'opponentCount',
  match: TargetFilter,
  destination: 'hand' | 'battlefield',
  nonMatch: RevealUntilNonMatch,
): CardInstruction => ({ kind: 'revealUntil', count, match, destination, nonMatch })

export const revealUntilBasicLand = (): CardInstruction =>
  revealUntil(1, { type: 'Land', supertype: 'Basic' }, 'hand', 'mill')

export const revealMatchingToHand = (count: number, type: string): CardInstruction => ({
  kind: 'revealMatchingToHand',
  count,
  type,
})

export const lockOrUnlockDoor = (): CardInstruction => ({ kind: 'lockOrUnlockDoor' })

export const sacrificePermanentsThenDraw = (types?: string[]): CardInstruction => ({
  kind: 'sacrificePermanentsThenDraw',
  ...(types ? { types } : {}),
})

export const opponentsSacrifice = (type: string, count: number): CardInstruction => ({
  kind: 'opponentsSacrifice',
  type,
  count,
})

export const reanimateCreatureFromGraveyards = (
  addSubtype?: string,
): CardInstruction => ({
  kind: 'reanimateCreatureFromGraveyards',
  ...(addSubtype ? { addSubtype } : {}),
})

export const payLifeX = (
  options: { timing?: 'yourEndStep' } = {},
): CardEffect => ({ op: 'castCost', lifeX: true, ...options })

export const convoke = (): CardEffect => ({ op: 'castCost', convoke: true })

export const kicker = (cost: string): CardEffect => ({
  op: 'castCost',
  kicker: cost,
})

export const gift = (spec: GiftSpec): CardEffect => ({
  op: 'castCost',
  gift: spec,
})

export const ifGiftPromised = (...whenTrue: CardInstruction[]): CardInstruction => ({
  kind: 'if',
  if: { kind: 'giftPromised' },
  whenTrue,
})

export const ifGiftNotPromised = (...whenTrue: CardInstruction[]): CardInstruction => ({
  kind: 'if',
  if: { kind: 'giftNotPromised' },
  whenTrue,
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
export const foretell = (manaCost: string): CardEffect => ({
  op: 'foretell',
  manaCost,
})

export const grantRetrace = (): CardEffect => ({
  op: 'static',
  grantRetrace: {
    nonlandPermanent: true,
    duringYourTurn: true,
    other: true,
  },
})

export const uncounterable = (): CardEffect => ({ op: 'spellTrait', uncounterable: true })

export const cumulativeUpkeepOpponentLife = (): CardInstruction => ({
  kind: 'cumulativeUpkeepOpponentLife',
})

export const xMana = (color: 'generic' | 'black' = 'generic'): CardEffect => ({
  op: 'castCost',
  xMana: color,
})

export const loseLife = (
  amount: number | 'triggerAmount',
  who: 'triggeringPlayer' | 'controller',
): CardInstruction => ({ kind: 'loseLife', amount, who })

/** Declarative trigger on a kernel event type (`discard`, `draw`, `end`, …). */
export const triggerOn = (
  on: 'discard' | 'cycle' | 'draw' | 'end' | 'combatDamage' | 'dealtCombatDamage' | 'playLand',
  options: { if?: TriggerBindingIf | CardCondition; do: CardInstruction[] },
): CardEffect => ({
  op: 'trigger',
  on,
  do: options.do,
  ...(options.if ? { if: options.if } : {}),
})

export const loseLifeTargetManaValue = (): CardInstruction => ({
  kind: 'loseLifeTargetManaValue',
})

export const loseLifeTargetController = (amount: number): CardInstruction => ({
  kind: 'loseLifeTargetController',
  amount,
})

export const teferiSunsetPlusOne = (): CardInstruction => ({
  kind: 'teferiSunsetPlusOne',
})

export const lookTopChooseOne = (count: number): CardInstruction => ({
  kind: 'lookTopChooseOne',
  count,
})

export const teferiSunsetEmblem = (): CardInstruction => ({
  kind: 'teferiSunsetEmblem',
})

export const dealDamageToChosenTarget = (amount: number): CardInstruction => ({
  kind: 'dealDamageToChosenTarget',
  amount,
})

export const exileColoredPermanentsAtMostX = (): CardInstruction => ({
  kind: 'exileColoredPermanentsAtMostX',
})

export const becomeMonarch = (): CardInstruction => ({ kind: 'becomeMonarch' })

export const exileUntilOpponentBecomesMonarch = (
  filter: TargetFilter,
  options: { min?: number; max?: number; optional?: boolean } = {},
): CardInstruction => ({
  kind: 'exileUntilOpponentBecomesMonarch',
  filter,
  ...options,
})

export const putPermanentsFromHand = (max: number): CardInstruction => ({
  kind: 'putPermanentsFromHand',
  max,
})

export const putFromHand = (
  who: 'each' | 'active' | 'controller',
  extra: { max?: number; types?: string[]; repeat?: boolean; optional?: boolean } = {},
): CardInstruction => ({
  kind: 'putFromHand',
  who,
  max: extra.max ?? 1,
  optional: extra.optional ?? true,
  ...(extra.types ? { types: extra.types } : {}),
  ...(extra.repeat ? { repeat: true } : {}),
})

export const secretCouncil = (): CardInstruction => ({ kind: 'secretCouncil' })

export const fight = (withTargets: 'self-target' | 'two-targets'): CardInstruction => ({
  kind: 'fight',
  with: withTargets,
})

export const fightUpToOne = (): CardInstruction => ({ kind: 'fightUpToOne' })

export const exchangeControlUntilEot = (): CardInstruction => ({
  kind: 'exchangeControlUntilEot',
})

export const gainControlPermanent = (): CardInstruction => ({ kind: 'gainControlPermanent' })

export const pairDonateToOpponents = (
  objectIds: string[],
  distinctWhenBalanced = true,
): CardInstruction => ({
  kind: 'pairDonateToOpponents',
  objectIds,
  distinctWhenBalanced,
})

export const bounceAttacking = (): CardInstruction => ({ kind: 'bounceAttacking' })

export const chooseVotesThisTurn = (): CardInstruction => ({ kind: 'chooseVotesThisTurn' })

export const upkeep = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'upkeep',
  do: instructions,
})

export const yourUpkeep = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'upkeep',
  do: instructions,
  if: { kind: 'controllerIsActive' },
})

export const yourUpkeepTarget = (
  filter: TargetFilter,
  instructions: CardInstruction[],
): CardEffect => ({
  op: 'trigger',
  on: 'upkeep',
  do: instructions,
  if: { kind: 'controllerIsActive' },
  targets: { filter },
})

export const yourUpkeepIf = (
  condition: CardCondition,
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'trigger',
  on: 'upkeep',
  do: instructions,
  if: condition,
})

export const controllerLife = (min: number): CardCondition => ({
  kind: 'controllerLife',
  min,
})

export const lacksControlledSubtype = (...subtypes: string[]): CardCondition => ({
  kind: 'lacksControlledSubtype',
  subtypes,
})

export const opponentsAtMost = (max: number): CardCondition => ({
  kind: 'opponentsAtMost',
  max,
})

export const opponentLostLifeThisTurn = (min: number): CardCondition => ({
  kind: 'opponentLostLifeThisTurn',
  min,
})

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
): CardEffect => ({
  op: 'targetedResolve',
  target: 0,
  filter,
  action,
  ...(instructions.length > 0 ? { do: instructions } : {}),
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

export const createTreasures = (
  count: number,
  who: 'you' | 'targetController',
): CardInstruction => ({ kind: 'createTreasures', count, who })

export const drawGreatestPower = (options: { nonHuman?: boolean } = {}): CardInstruction => ({
  kind: 'drawGreatestPower',
  ...options,
})

export const pumpControlled = (
  power: number,
  toughness: number,
  options: {
    trample?: boolean
    powerFromGreatest?: boolean
    nonHuman?: boolean
    other?: boolean
  } = {},
): CardInstruction => ({
  kind: 'pumpControlled',
  power,
  toughness,
  ...options,
})

export const pumpControlledNonHuman = (power: number, toughness: number) =>
  pumpControlled(power, toughness, { nonHuman: true })

export const grantControlledUntilEot = (
  ...keywords: string[]
): CardInstruction => ({ kind: 'grantControlled', keywords })

export const searchLibrary = (spec: SearchSpec): CardInstruction => ({
  kind: 'searchLibrary',
  spec,
})

export const fightOwnedVsOpponent = (): CardInstruction => ({ kind: 'fightOwnedVsOpponent' })

export const counterUnlessPay = (amount: number): CardInstruction => ({
  kind: 'counterUnlessPay',
  amount,
})

export const modalChooseOne = (...modes: ModalMode[]): CardEffect => ({
  op: 'modal',
  choose: 'one',
  modes,
})

export const casts = (
  ...args: Array<CardInstruction | { creatureOnly?: boolean }>
): CardEffect => {
  const last = args[args.length - 1]
  const options = last && typeof last === 'object' && 'creatureOnly' in last
    ? (args.pop() as { creatureOnly?: boolean })
    : undefined
  return {
    op: 'trigger',
    on: 'cast',
    do: args as CardInstruction[],
    ...(options?.creatureOnly ? { creatureOnly: true } : {}),
  }
}

export const castModal = (
  modal: ModalSpec,
  options: { creatureOnly?: boolean } = {},
): CardEffect => ({
  op: 'trigger',
  on: 'cast',
  do: [],
  modal,
  ...(options.creatureOnly ? { creatureOnly: true } : {}),
})
