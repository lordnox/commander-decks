import { gameObjectFieldDefaults, isPermanentType } from '../definitions'
import type Draft from '../draft'
import { lifeLostThisTurn } from '../plugins/damage'
import type {
  GameObject,
  GameState,
  ManaPool,
  PlayerId,
  TriggerBindingIf,
  ZoneId,
} from '../types'

export const RANDOM_EXILE_COPY_CARD_CHOSEN = 'randomExileCopy.cardChosen'
export const RANDOM_EXILE_COPY_FINISH = 'randomExileCopy.finish'

export type CardCondition =
  | { kind: 'otherLands'; min?: number; max?: number; subtype?: string }
  | { kind: 'controlledLands'; min?: number; max?: number }
  | { kind: 'controlledBasicLands'; min?: number; max?: number }
  | { kind: 'uniqueLandNames'; min: number }
  | { kind: 'notActivePlayer' }
  | { kind: 'controlledCreaturePower'; min: number }
  | { kind: 'graveyardCards'; min: number }
  | { kind: 'graveyardPermanentCards'; min: number }
  | { kind: 'graveyardCardTypes'; min: number }
  | { kind: 'lacksControlledSubtype'; subtypes: string[] }
  | { kind: 'opponentsAtMost'; max: number }
  | { kind: 'opponentLostLifeThisTurn'; min: number }
  | { kind: 'controllerIsActive' }
  | { kind: 'controllerUpkeep' }
  | { kind: 'controllerLife'; min: number }

export type TokenSpec = {
  name: string
  types: string[]
  subtypes?: string[]
  power?: number | null
  toughness?: number | null
  oracleText?: string
}

export type CardInstruction =
  | { kind: 'selfMill'; count: number }
  | { kind: 'bounceSelf' }
  | { kind: 'tap' }
  | { kind: 'payMana'; cost: string }
  | { kind: 'sacrificeSelf' }
  | { kind: 'addMana'; mana: Partial<ManaPool> }
  | { kind: 'addManaToEachPlayer'; mana: Partial<ManaPool> }
  | { kind: 'draw'; count: number }
  | { kind: 'discardCards'; count: number; who?: 'controller' | 'target' }
  | { kind: 'gainLife'; count: number | 'triggerAmount' }
  | { kind: 'drainOpponentsX'; multiplier: number }
  | { kind: 'drawX' }
  | { kind: 'dealDamageTargetX' }
  | { kind: 'setAllLifeToLowest' }
  | { kind: 'gainLifeLostThisTurn'; who: 'controller' | 'all' }
  | { kind: 'exchangeLifeWithOpponent'; optional?: boolean; drawLifeLost?: boolean }
  | { kind: 'winGame' }
  | { kind: 'pumpSelf'; power: number; toughness: number }
  | { kind: 'addPlusCounters'; count: number }
  | { kind: 'pumpAllCreaturesByX'; multiplier: number }
  | { kind: 'revealUntilBasicLand' }
  | { kind: 'sacrificePermanentsThenDraw'; types?: string[] }
  | { kind: 'opponentsSacrifice'; type: string; count: number }
  | { kind: 'reanimateCreatureFromGraveyards'; addSubtype?: string }
  | {
      kind: 'loseLife'
      amount: number | 'triggerAmount'
      who: 'triggeringPlayer' | 'controller'
    }
  | { kind: 'loseLifeTargetPlayer'; amount: number }
  | { kind: 'loseLifeTargetManaValue' }
  | { kind: 'dealDamageToChosenTarget'; amount: number }
  | { kind: 'teferiSunsetPlusOne' }
  | { kind: 'lookTopChooseOne'; count: number }
  | { kind: 'teferiSunsetEmblem' }
  | { kind: 'exileColoredPermanentsAtMostX' }
  | { kind: 'putPermanentsFromHand'; max: number }
  | { kind: 'discardHandsThenDrawGreatest' }
  | { kind: 'extraLandPlays'; count: number }
  | { kind: 'returnOwnedGraveyardLands'; tapped?: boolean }
  | { kind: 'createToken'; token: TokenSpec }
  | { kind: 'copySelf' }
  | { kind: 'doublePlusCounters' }
  | { kind: 'if'; if: CardCondition; whenTrue: CardInstruction[]; whenFalse?: CardInstruction[] }
  | { kind: 'surveil'; count: number }
  | { kind: 'scry'; count: number }
  | { kind: 'putLandFromHand'; tapped?: boolean }
  | { kind: 'bounceChosenLand' }
  | { kind: 'revealPick'; count: number; type?: string; permanent?: boolean }
  | { kind: 'copyControlledCreature'; notLegendary?: boolean; plusCounters?: number; keepName?: boolean }
  | { kind: 'copyTargetCreature'; notLegendary?: boolean; flying?: boolean }
  | { kind: 'returnTargetFromGraveyard'; to: 'hand' | 'battlefield'; tapped?: boolean }
  | { kind: 'pump'; power: number; toughness: number }
  | { kind: 'grantUntilEot'; keywords: string[] }
  | { kind: 'createXTokens'; token: TokenSpec }
  | { kind: 'dealDamageToSelf'; amount: number }
  | { kind: 'addChosenColorMana' }
  | { kind: 'optionalMill'; count: number }
  | { kind: 'mayDraw'; count: number }
  | { kind: 'chooseModes'; choose: 'one' | 'any'; modes: ModalMode[] }
  | { kind: 'eachPlayerDiscard'; count: number }
  | { kind: 'eachPlayerDraw'; count: number }
  | { kind: 'eachPlayerLoseLife'; amount: number }
  | { kind: 'eachPlayerSacrifice'; type: string }
  | { kind: 'returnChosenLandFromGraveyard'; tapped?: boolean }
  | { kind: 'drawAtNextUpkeep'; count: number; who: 'you' | 'targetController'; optional?: boolean }
  | { kind: 'putMilledLandTapped' }
  | { kind: 'copyAllCreaturesUntilEot'; notLegendary?: boolean }
  | {
      kind: 'putFromHand'
      who: 'each' | 'active' | 'controller'
      max: number
      types?: string[]
      repeat?: boolean
      optional?: boolean
    }
  | { kind: 'secretCouncil' }
  | { kind: 'fight'; with: 'self-target' | 'two-targets' }
  | { kind: 'fightUpToOne' }
  | { kind: 'exchangeControlUntilEot' }
  | { kind: 'bounceAttacking' }
  | { kind: 'chooseVotesThisTurn' }
  | { kind: 'createTreasures'; count: number; who: 'you' | 'targetController' }
  | { kind: 'drawGreatestPower'; nonHuman?: boolean }
  | {
      kind: 'pumpControlled'
      power: number
      toughness: number
      trample?: boolean
      powerFromGreatest?: boolean
      nonHuman?: boolean
      other?: boolean
    }
  | { kind: 'searchLibrary'; spec: SearchSpec }
  | { kind: 'fightOwnedVsOpponent' }
  | { kind: 'counterUnlessPay'; amount: number }
  | { kind: 'copyTargetSpell' }
  | { kind: 'destroyTargetPermanent'; types: string[] }
  | { kind: 'lookTopPutLand'; count: number }
  | { kind: 'grantControlled'; keywords: string[]; other?: boolean; nonHuman?: boolean }
  | { kind: 'preventCombatDamage'; from?: 'target' | 'all'; toController?: boolean }
  | { kind: 'untapTarget' }
  | { kind: 'addManaPerSwamp'; basic?: boolean }
  | { kind: 'revealDrawLoseLife' }
  | { kind: 'gainLifeTargetPower' }
  | { kind: 'addUntilCleanupRule'; pluginId: string; params?: Record<string, unknown> }
  | { kind: 'randomExileCopyWhile'; repeatWhileType: string; tapped?: boolean }

export type ModalMode = { id: string; label: string; do: CardInstruction[] }

export type ModalSpec = {
  choose: 'one' | 'any'
  modes: ModalMode[]
}

export type ActivateCost = {
  tap?: boolean
  mana?: string
  mill?: number
  life?: number
  sacrifice?: 'self'
  discard?: 'self' | 'land' | 'any'
  sacrificeTarget?: 'creature' | 'land'
  /** Signed loyalty change paid before the ability goes on the stack. */
  loyalty?: number
  /** Use the activation event's chosen X as a negative loyalty cost. */
  loyaltyX?: boolean
}

export type SearchDestination = 'hand' | 'battlefield' | 'graveyard'

export type TargetFilter = {
  zone?: ZoneId
  zones?: ZoneId[]
  type?: string
  types?: string[]
  nonland?: boolean
  noncreature?: boolean
  nonblack?: boolean
  controller?: 'you' | 'opponent'
  spellTargetsControlledPermanent?: boolean
  players?: 'any' | 'opponent'
}

export type SearchSpec = {
  prompt: string
  match: (object: GameObject) => boolean
  kickedMatch?: (object: GameObject) => boolean
  kickedPrompt?: string
  destination: SearchDestination
  tapped?: boolean
  min: number
  max: number
  reveal?: boolean
  gainLife?: number
  validateSelection?: (objects: GameObject[]) => string | void
  untapWithFourLands?: boolean
  /** Sacrificed while casting, as Harrow's printed additional cost. */
  sacrificeLands?: number
  /** Sacrificed while resolving, as Scapeshift's first sentence. */
  sacrificeOnResolve?: 'any'
  empoweredMax?: number
  empoweredIf?: CardCondition
  split?: {
    battlefield: { min: number; max: number; tapped?: boolean }
    hand: { min: number; max: number }
    totalMax: number
    paired?: boolean
  }
  /** Hideouts default sacrifice when gainLife or sacrificeSource !== false. */
  sacrificeSource?: boolean
  optionalEnter?: boolean
}

export type CardEffect =
  | {
      op: 'replacement'
      on: 'enters'
      do: 'tapSelf' | 'tapUnlessPayLife' | 'tapUnlessRevealSubtype'
      life?: number
      subtypes?: string[]
      if?: CardCondition
    }
  | {
      op: 'trigger'
      on:
        | 'enters'
        | 'leaves'
        | 'dies'
        | 'landfall'
        | 'attacks'
        | 'resolve'
        | 'landToGraveyard'
        | 'upkeep'
        | 'cast'
        | 'discard'
        | 'draw'
        | 'end'
        | 'combatDamage'
        | 'dealtCombatDamage'
        | 'playLand'
      do: CardInstruction[]
      if?: CardCondition | TriggerBindingIf
      creatureOnly?: boolean
      modal?: ModalSpec
      targets?: 'opponent'
    }
  | { op: 'modal'; choose: 'one' | 'any'; modes: ModalMode[] }
  | {
      op: 'activate'
      id: string
      manaAbility?: boolean
      targets?: 'any' | 'opponent' | 'teferiSunsetPlusOne' | 'creature' | 'land'
      zone?: ZoneId
      costs: ActivateCost
      if?: CardCondition
      do: CardInstruction[]
    }
  | { op: 'search'; via: 'spell'; spec: SearchSpec }
  | { op: 'search'; via: 'ability'; spec: SearchSpec; costs: ActivateCost }
  | { op: 'search'; via: 'enters'; spec: SearchSpec }
  | {
      op: 'targetedResolve'
      target: number
      filter: TargetFilter
      action: 'destroy' | 'exile' | 'bounce' | 'counter' | 'copy' | 'reanimate' | 'select'
      do?: CardInstruction[]
    }
  | { op: 'mana'; if: CardCondition }
  | {
      op: 'static'
      pluginId?: string
      extraLandPlays?: number
      extraLandfall?: number
      extraEnters?: number
      playLandsFromGraveyard?: boolean
      playLandsFromLibraryTop?: boolean
      revealLibraryTop?: boolean
      allCreatureTypes?: boolean
      legendRuleOff?: boolean
    }
  | { op: 'handler'; pluginId: string }
  | {
      op: 'castCost'
      lifeX?: boolean
      xMana?: 'generic' | 'black'
      timing?: 'yourEndStep'
    }
  | { op: 'bestow'; cost: string }

export const selfMill = (count: number): CardInstruction => ({ kind: 'selfMill', count })

export const enters = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'enters',
  do: instructions,
})

export const entersTargetingOpponent = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'enters',
  targets: 'opponent',
  do: instructions,
})

export const dies = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'dies',
  do: instructions,
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

export const returnTargetFromGraveyard = (
  to: 'hand' | 'battlefield',
  tapped = false,
): CardInstruction => ({ kind: 'returnTargetFromGraveyard', to, tapped })

export const pump = (power: number, toughness: number): CardInstruction => ({
  kind: 'pump',
  power,
  toughness,
})

export const grantUntilEot = (...keywords: string[]): CardInstruction => ({
  kind: 'grantUntilEot',
  keywords,
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

export const drawAtNextUpkeep = (
  count: number,
  who: 'you' | 'targetController' = 'you',
  optional = false,
): CardInstruction => ({ kind: 'drawAtNextUpkeep', count, who, optional })

export const copyAllCreaturesUntilEot = (notLegendary = true): CardInstruction => ({
  kind: 'copyAllCreaturesUntilEot',
  notLegendary,
})

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

export const bestow = (cost: string): CardEffect => ({ op: 'bestow', cost })

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

export const handler = (pluginId: string): CardEffect => ({
  op: 'handler',
  pluginId,
})

export const activate = (effect: Omit<Extract<CardEffect, { op: 'activate' }>, 'op'>): CardEffect => ({
  op: 'activate',
  ...effect,
})

/** Compose one activated ability from a cost and reusable effect instructions. */
export const ability = (
  options: Omit<Extract<CardEffect, { op: 'activate' }>, 'op' | 'costs' | 'do'>,
  costs: ActivateCost,
  ...instructions: CardInstruction[]
): CardEffect => activate({ ...options, costs, do: instructions })

export const loyalty = (amount: number): ActivateCost => ({ loyalty: amount })

export const loyaltyX = (): ActivateCost => ({ loyalty: 0, loyaltyX: true })

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

export const pumpSelf = (power: number, toughness: number): CardInstruction => ({
  kind: 'pumpSelf',
  power,
  toughness,
})

export const addPlusCountersInstruction = (count: number): CardInstruction => ({
  kind: 'addPlusCounters',
  count,
})

export const pumpAllCreaturesByX = (multiplier = -1): CardInstruction => ({
  kind: 'pumpAllCreaturesByX',
  multiplier,
})

export const revealUntilBasicLand = (): CardInstruction => ({ kind: 'revealUntilBasicLand' })

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
  on: 'discard' | 'draw' | 'end' | 'combatDamage' | 'dealtCombatDamage' | 'playLand',
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

export const basicLand = (object: GameObject) =>
  object.types.includes('Land') && object.supertypes.includes('Basic')

export const hasSubtype = (...subtypes: string[]) => (object: GameObject) =>
  object.types.includes('Land') && subtypes.some((subtype) => object.subtypes.includes(subtype))

export const sharedBasicLandType = (objects: GameObject[]) => {
  if (objects.length < 2) return
  const basicTypes = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']
  if (!basicTypes.some((type) => objects.every((object) => object.subtypes.includes(type)))) {
    return 'The chosen basic lands must share a land type.'
  }
}

const otherControlledLands = (state: GameState, object: GameObject) =>
  Object.values(state.objects).filter((candidate) =>
    candidate.id !== object.id
    && candidate.zone === 'battlefield'
    && candidate.controller === object.controller
    && candidate.types.includes('Land'))

const controlledLandList = (draft: Draft | GameState, seat: PlayerId) =>
  Object.values(draft.objects).filter((candidate) =>
    candidate.zone === 'battlefield'
    && candidate.controller === seat
    && candidate.types.includes('Land'))

const tokenDefaults = (): Omit<GameObject, 'id' | 'name' | 'owner' | 'controller'> => ({
  ...gameObjectFieldDefaults(),
  zone: 'battlefield',
  summoningSickness: true,
  token: true,
  effects: [],
})

/** Tokens are created by an effect rather than moved from another zone. */
export const createToken = (
  draft: Draft,
  controller: PlayerId,
  template: Partial<GameObject> & { name: string },
  emitEntry = true,
) => {
  const id = draft.allocId('tok')
  const token: GameObject = {
    ...tokenDefaults(),
    ...template,
    id,
    owner: controller,
    controller,
    zone: 'battlefield',
    token: true,
    effects: template.effects ?? [],
  }
  draft.objects[id] = token
  draft.zoneOrder[controller].battlefield.push(id)
  draft.zoneCounts[controller].battlefield += 1
  for (const pluginId of token.grantedRules) {
    draft.rules.push({
      instanceId: draft.allocId('rule'),
      pluginId,
      sourceId: id,
      timestamp: draft.allocTs(),
      params: {},
    })
  }
  draft.note(`${controller} creates ${token.name}`)
  if (emitEntry) {
    draft.enqueue({
      type: 'custom',
      name: 'cardPlugins.permanentEntered',
      seat: controller,
      payload: { objectId: id },
    })
  }
  return token
}

export const copyTokenTemplate = (
  card: GameObject,
  extra: {
    notLegendary?: boolean
    flying?: boolean
    tapped?: boolean
  } = {},
): Partial<GameObject> & { name: string } => ({
  name: card.name,
  // Leaving `tapped` out keeps createToken's untapped default instead of undefined.
  ...(extra.tapped ? { tapped: true } : {}),
  summoningSickness: card.types.includes('Creature'),
  counters: card.printedLoyalty === null ? {} : { loyalty: card.printedLoyalty },
  types: [...card.types],
  subtypes: [...card.subtypes],
  supertypes: extra.notLegendary
    ? card.supertypes.filter((entry) => entry !== 'Legendary')
    : [...card.supertypes],
  manaCost: card.manaCost,
  manaValue: card.manaValue,
  colors: [...card.colors],
  power: card.power,
  toughness: card.toughness,
  printedLoyalty: card.printedLoyalty,
  oracleText: extra.flying && !card.oracleText.toLowerCase().includes('flying')
    ? `${card.oracleText}\nFlying`
    : card.oracleText,
  grantedRules: [...card.grantedRules],
  tags: [],
  tapProduces: card.tapProduces ? { ...card.tapProduces } : undefined,
  effects: card.effects ? [...card.effects] : [],
})

export const addPlusCounters = (object: GameObject, amount: number) => {
  if (amount === 0) return
  object.counters['+1/+1'] = (object.counters['+1/+1'] ?? 0) + amount
  if (object.power !== null) object.power += amount
  if (object.toughness !== null) object.toughness += amount
}

export const conditionHolds = (
  condition: CardCondition | undefined,
  state: GameState,
  object: GameObject,
) => {
  if (!condition) return true
  if (condition.kind === 'notActivePlayer') return state.active !== object.controller
  if (condition.kind === 'otherLands') {
    const lands = otherControlledLands(state, object).filter((land) =>
      !condition.subtype || land.subtypes.includes(condition.subtype))
    if (condition.min !== undefined && lands.length < condition.min) return false
    if (condition.max !== undefined && lands.length > condition.max) return false
    return true
  }
  if (condition.kind === 'controlledLands') {
    const lands = controlledLandList(state, object.controller)
    if (condition.min !== undefined && lands.length < condition.min) return false
    if (condition.max !== undefined && lands.length > condition.max) return false
    return true
  }
  if (condition.kind === 'controlledBasicLands') {
    const lands = controlledLandList(state, object.controller)
      .filter((land) => land.supertypes.includes('Basic'))
    if (condition.min !== undefined && lands.length < condition.min) return false
    if (condition.max !== undefined && lands.length > condition.max) return false
    return true
  }
  if (condition.kind === 'controlledCreaturePower') {
    return Object.values(state.objects).some((candidate) =>
      candidate.zone === 'battlefield'
      && candidate.controller === object.controller
      && candidate.types.includes('Creature')
      && (candidate.power ?? 0) >= condition.min)
  }
  if (condition.kind === 'graveyardCards') {
    return (state.zoneOrder[object.controller]?.graveyard.length ?? 0) >= condition.min
  }
  if (condition.kind === 'graveyardPermanentCards') {
    return Object.values(state.objects).filter((candidate) =>
      candidate.owner === object.controller
      && candidate.zone === 'graveyard'
      && isPermanentType(candidate.types)).length >= condition.min
  }
  if (condition.kind === 'graveyardCardTypes') {
    const types = new Set(
      Object.values(state.objects)
        .filter((candidate) =>
          candidate.owner === object.controller && candidate.zone === 'graveyard')
        .flatMap((candidate) => candidate.types),
    )
    return types.size >= condition.min
  }
  if (condition.kind === 'lacksControlledSubtype') {
    return !Object.values(state.objects).some((candidate) =>
      candidate.zone === 'battlefield'
      && candidate.controller === object.controller
      && candidate.id !== object.id
      && condition.subtypes.some((subtype) => candidate.subtypes.includes(subtype)))
  }
  if (condition.kind === 'opponentsAtMost') {
    const opponents = state.playerOrder.filter((seat) =>
      seat !== object.controller && !state.players[seat].lost).length
    return opponents <= condition.max
  }
  if (condition.kind === 'opponentLostLifeThisTurn') {
    return state.playerOrder.some((seat) =>
      seat !== object.controller
      && lifeLostThisTurn(state.players[seat]) >= condition.min)
  }
  if (condition.kind === 'controllerIsActive') return state.active === object.controller
  if (condition.kind === 'controllerUpkeep') {
    return state.active === object.controller && state.step === 'upkeep'
  }
  if (condition.kind === 'controllerLife') {
    return state.players[object.controller].life >= condition.min
  }
  if (condition.kind === 'uniqueLandNames') {
    const names = new Set(controlledLandList(state, object.controller).map((land) => land.name))
    return names.size >= condition.min
  }
  return false
}

/** CR 701.13b: a player asked to mill more cards than they have mills their whole library. */
export const millLibrary = (draft: Draft, seat: PlayerId, count: number) => {
  for (const objectId of draft.zoneOrder[seat].library.slice(0, count)) {
    draft.enqueue({ type: 'move', objectId, to: 'graveyard' })
  }
}

export const returnOwnedLands = (draft: Draft, seat: PlayerId, tapped: boolean) => {
  for (const object of Object.values(draft.objects)) {
    if (object.owner !== seat || object.zone !== 'graveyard' || !object.types.includes('Land')) {
      continue
    }
    draft.enqueue({ type: 'move', objectId: object.id, to: 'battlefield' })
    if (tapped) draft.enqueue({ type: 'tap', objectId: object.id })
  }
}

export const extraTriggerCount = (
  state: GameState,
  seat: PlayerId,
  kind: 'landfall' | 'enters',
  source?: GameObject,
) =>
  Object.values(state.objects).reduce((total, object) => {
    if (object.zone !== 'battlefield' || object.controller !== seat) return total
    const staticCount = (object.effects ?? []).reduce((sum, effect) => {
      if (effect.op !== 'static') return sum
      if (kind === 'landfall') return sum + (effect.extraLandfall ?? 0)
      return sum + (effect.extraEnters ?? 0)
    }, 0)
    const throne = object.chosenType
      && source?.types.includes('Creature')
      && source.subtypes.includes(object.chosenType)
      ? 1
      : 0
    return total + staticCount + (kind === 'landfall' || kind === 'enters' ? throne : 0)
  }, 0)


export function applyCopy (
  object: GameObject,
  copied: GameObject,
  extra: { notLegendary?: boolean; plusCounters?: number; keepName?: boolean } = {},
) {
  const keptStatic = extra.keepName
    ? (object.effects ?? []).filter((effect) => effect.op === 'static')
    : []
  if (!extra.keepName && object.name !== copied.name) {
    // The table still needs to read the card underneath: a clone is answered
    // differently once you know it is a Spark Double wearing someone's face.
    object.printedName = object.printedName ?? object.name
    object.name = copied.name
  }
  object.types = [...copied.types]
  object.subtypes = [...copied.subtypes]
  object.supertypes = extra.notLegendary
    ? copied.supertypes.filter((entry) => entry !== 'Legendary')
    : [...copied.supertypes]
  object.manaCost = copied.manaCost
  object.power = copied.power
  object.toughness = copied.toughness
  object.oracleText = copied.oracleText
  object.grantedRules = [...copied.grantedRules]
  object.tapProduces = copied.tapProduces ? { ...copied.tapProduces } : undefined
  object.effects = copied.effects ? [...copied.effects] : []
  if (keptStatic.length > 0) object.effects = [...object.effects, ...keptStatic]
  if (extra.plusCounters && extra.plusCounters > 0) addPlusCounters(object, extra.plusCounters)
}

export const replacementTaps = (effects: CardEffect[]) =>
  effects.find((effect): effect is Extract<CardEffect, { op: 'replacement' }> =>
    effect.op === 'replacement' && effect.do === 'tapSelf')

export const activateEffect = (effects: CardEffect[], abilityId: string) =>
  effects.find((effect): effect is Extract<CardEffect, { op: 'activate' }> =>
    effect.op === 'activate' && effect.id === abilityId)

export const searchEffect = (effects: CardEffect[]) =>
  effects.find((effect): effect is Extract<CardEffect, { op: 'search' }> => effect.op === 'search')

/** Game state is structuredClone'd; drop matchers so search specs stay in CARD_RULES. */
export const serializableEffects = (effects: CardEffect[]): CardEffect[] =>
  JSON.parse(JSON.stringify(effects, (_key, value) =>
    typeof value === 'function' ? undefined : value)) as CardEffect[]

export const triggerEffects = (
  effects: CardEffect[],
  on: Extract<CardEffect, { op: 'trigger' }>['on'],
) =>
  effects.filter((effect): effect is Extract<CardEffect, { op: 'trigger' }> =>
    effect.op === 'trigger' && effect.on === on)

const flattenInstructions = (instructions: CardInstruction[]): CardInstruction[] =>
  instructions.flatMap((instruction) => {
    if (instruction.kind === 'chooseModes') {
      return [instruction, ...flattenInstructions(instruction.modes.flatMap((mode) => mode.do))]
    }
    if (instruction.kind === 'if') {
      return [
        instruction,
        ...flattenInstructions(instruction.whenTrue),
        ...flattenInstructions(instruction.whenFalse ?? []),
      ]
    }
    return [instruction]
  })

const CHOICE_KINDS = new Set([
  'surveil', 'scry', 'putLandFromHand', 'bounceChosenLand', 'revealPick',
  'copyControlledCreature', 'copyTargetCreature', 'optionalMill', 'mayDraw',
  'returnChosenLandFromGraveyard', 'copyAllCreaturesUntilEot',
  'drawAtNextUpkeep', 'grantUntilEot', 'pump', 'createXTokens',
  'putFromHand', 'secretCouncil', 'fight', 'fightUpToOne',
  'exchangeControlUntilEot', 'bounceAttacking', 'chooseVotesThisTurn',
  'createTreasures', 'drawGreatestPower', 'pumpControlled', 'searchLibrary',
  'fightOwnedVsOpponent', 'counterUnlessPay', 'copyTargetSpell',
  'destroyTargetPermanent', 'lookTopPutLand', 'grantControlled',
  'eachPlayerDiscard', 'eachPlayerSacrifice',
])

const hasKind = (instructions: CardInstruction[], ...kinds: string[]) =>
  instructions.some((instruction) => kinds.includes(instruction.kind))

export const handlerIdsFromEffects = (effects: CardEffect[]) => {
  const ids = new Set<string>()
  for (const effect of effects) {
    if (effect.op === 'replacement') ids.add('entersTapped')
    if (effect.op === 'trigger' && effect.on === 'cast') {
      ids.add('castTriggers')
      if (effect.modal) ids.add('choiceEffects')
    }
    if (effect.op === 'modal') ids.add('modalSpell')
    if (effect.op === 'trigger' && effect.on === 'resolve') ids.add('onResolve')
    if (effect.op === 'activate') {
      ids.add(effect.costs.loyalty !== undefined || effect.costs.loyaltyX
        ? 'planeswalker'
        : 'activated')
    }
    if (effect.op === 'mana') ids.add('activated')
    if (effect.op === 'search') ids.add('librarySearch')
    if (effect.op === 'targetedResolve') {
      ids.add('targetedResolve')
      if (effect.action === 'copy') ids.add('copySpell')
    }
    if (effect.op === 'static' && effect.extraLandPlays) ids.add('additionalLandPlay')
    if (effect.op === 'static' && (effect.revealLibraryTop || effect.playLandsFromLibraryTop)) {
      ids.add('courserOfKruphix')
    }
    if (effect.op === 'bestow') ids.add('bestow')
    if (effect.op === 'castCost') ids.add('castCosts')
    if (effect.op === 'handler') ids.add(effect.pluginId)
    const listed = effect.op === 'trigger' || effect.op === 'activate' || effect.op === 'modal'
      ? flattenInstructions(
        effect.op === 'modal'
          ? effect.modes.flatMap((mode) => mode.do)
          : effect.do,
      )
      : []
    if (hasKind(listed, 'chooseModes')) ids.add('modalSpell')
    if (listed.some((instruction) => CHOICE_KINDS.has(instruction.kind))) {
      ids.add('choiceEffects')
      if (hasKind(listed, 'putFromHand')) ids.add('dumpFromHand')
      if (hasKind(listed, 'secretCouncil', 'chooseVotesThisTurn')) ids.add('secretCouncil')
      if (hasKind(listed, 'fight', 'fightUpToOne', 'fightOwnedVsOpponent')) ids.add('fight')
      if (hasKind(listed, 'searchLibrary')) ids.add('librarySearch')
      if (hasKind(listed, 'exchangeControlUntilEot')) ids.add('reinsOfPower')
    }
    if (hasKind(listed, 'randomExileCopyWhile')) ids.add('randomExileCopy')
    if (effect.op === 'activate' && hasKind(listed,
      'putLandFromHand',
      'bounceChosenLand',
      'copyTargetCreature',
      'addChosenColorMana',
      'fight',
      'putFromHand',
    )) {
      ids.add('choiceEffects')
      if (hasKind(listed, 'fight')) ids.add('fight')
    }
  }
  return [...ids]
}

export const pluginIdsFromEffects = (effects: CardEffect[]) =>
  effects.flatMap((effect) =>
    effect.op === 'static' && effect.pluginId ? [effect.pluginId] : [])

export { runInstructions } from './runInstructions'
