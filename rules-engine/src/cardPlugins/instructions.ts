import type { DelayedTriggerCondition, ManaId, ManaPool } from '../types'
import type { CardCondition, CardInstruction, InstructionCount, ModalMode, PlayerSelector, RevealUntilNonMatch, SearchSpec, TargetFilter, TokenSpec, VoteOptions, VoterGroup } from './effectDefinitions'
import { players } from './selectors'

export const selfMill = (count: number): CardInstruction => ({ kind: 'selfMill', count })

export const millTarget = (count: number): CardInstruction => ({ kind: 'millTarget', count })

export const damage = (options: { amount: number; to: PlayerSelector }): CardInstruction => ({
  kind: 'damage', ...options,
})

export type BlinkOptions = {
  returnController?: 'owner' | 'controller'
  when?: 'immediate' | 'nextEndStep'
  plusCounters?: number
  tapped?: true
  self?: true
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

/** Exile this permanent, then return it (immediately or at the next end step). */
export const blinkSelf = (
  options: Pick<BlinkOptions, 'when' | 'tapped' | 'returnController'> = {},
): CardInstruction => blink({ ...options, self: true })

export const addManaChoice = (...options: Array<Partial<ManaPool>>): CardInstruction => ({
  kind: 'addManaChoice',
  options,
})

export const extraLandPlays = (count: number): CardInstruction => ({
  kind: 'extraLandPlays',
  count,
})

export const surveil = (count: number): CardInstruction => ({ kind: 'surveil', count })

export const scry = (count: InstructionCount): CardInstruction => ({ kind: 'scry', count })

export const opponentPiles = (
  count: number,
  options: {
    reveal: 'public' | 'look'
    piles: 'public' | 'facedown-faceup'
  },
): CardInstruction => ({
  kind: 'opponentPiles',
  count,
  reveal: options.reveal,
  piles: options.piles,
})

export const putLandFromHand = (tapped = false): CardInstruction => ({
  kind: 'putLandFromHand',
  tapped,
})

export const millThenRecover = (
  count: number,
  cost: { mana?: string; life?: number } = {},
): CardInstruction => ({
  kind: 'millThenRecover',
  count,
  ...cost,
})

export const repeatIf = (
  condition: CardCondition,
  ...process: CardInstruction[]
): CardInstruction => ({
  kind: 'repeatIf',
  if: condition,
  do: process,
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

export const pumpTargetX = (multiplier = 1, toughnessMultiplier = multiplier): CardInstruction => ({
  kind: 'pumpTargetX',
  multiplier,
  ...(toughnessMultiplier !== multiplier ? { toughnessMultiplier } : {}),
})

export const pumpSelf = (power: number, toughness: number): CardInstruction => ({
  kind: 'pumpSelf',
  power,
  toughness,
})

export const animateUntilEot = (
  power: number,
  toughness: number,
  extra: { fromX?: boolean } = {},
): CardInstruction => ({
  kind: 'animateUntilEot',
  power,
  toughness,
  ...extra,
})

export const grantUntilEot = (...keywords: string[]): CardInstruction => ({
  kind: 'grantUntilEot',
  keywords,
})

export const goadTarget = (): CardInstruction => ({ kind: 'goadTargets' })

export const goadObjectIds = (objectIds: string[]): CardInstruction => ({
  kind: 'goadObjectIds',
  objectIds,
})

export const goadRevealUntilMatches = (): CardInstruction => ({
  kind: 'goadObjectIds',
  objectIds: [],
  objectIdsFromRevealUntil: true,
})

export const goadTargetUntilEot = (): CardInstruction => ({
  kind: 'goadTargets',
  untilEndOfTurn: true,
})

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

export const tapAll = (
  filter: TargetFilter,
  extra: { ofTargetPlayer?: boolean; skipNextUntap?: boolean } = {},
): CardInstruction => ({
  kind: 'tapAll',
  filter,
  ...(extra.ofTargetPlayer ? { ofTargetPlayer: true } : {}),
  ...(extra.skipNextUntap ? { skipNextUntap: true } : {}),
})

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

/** Every player votes, starting with the controller; `outcome` runs once the votes are in. */
export const vote = (
  prompt: string,
  options: VoteOptions,
  outcome: CardInstruction[],
  secret = false,
): CardInstruction => ({ kind: 'vote', prompt, options, secret, outcome })

export const ifVoteLeads = (
  option: string,
  whenTrue: CardInstruction[],
  whenFalse?: CardInstruction[],
): CardInstruction => ({
  kind: 'ifVoteLeads',
  option,
  whenTrue,
  ...(whenFalse ? { whenFalse } : {}),
})

export const forEachVoter = (
  who: VoterGroup,
  ...instructions: CardInstruction[]
): CardInstruction => ({ kind: 'forEachVoter', who, do: instructions })

export const forEachVotedOption = (...instructions: CardInstruction[]): CardInstruction => ({
  kind: 'forEachVotedOption',
  do: instructions,
})

export const exileVoteWinners = (): CardInstruction => ({ kind: 'exileVoteWinners' })

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

export const mayPayLifeDraw = (): CardInstruction => ({ kind: 'mayPayLifeDraw' })

export const chooseModes = (
  choose: 'one' | 'any' | 'two',
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

export const eachPlayerDrawDamageDealtToSource = (): CardInstruction => ({
  kind: 'eachPlayerDrawDamageDealtToSource',
})

/** Must be the last instruction in its list: option choices do not resume later instructions. */
export const eachPlayerMayWheel = (count: number): CardInstruction => ({
  kind: 'eachPlayerMayWheel',
  count,
})

export const eachPlayerLoseLife = (amount: number): CardInstruction =>
  loseLife({ amount, to: players('any') })

export const eachPlayerSacrifice = (type: string): CardInstruction => ({
  kind: 'eachPlayerSacrifice',
  type,
})

export const returnChosenLandFromGraveyard = (
  tapped = true,
  extra: {
    count?: number
    min?: number
    max?: number
    to?: 'hand' | 'battlefield'
    filter?: TargetFilter
  } = {},
): CardInstruction => ({
  kind: 'returnChosenLandFromGraveyard',
  tapped,
  ...extra,
})

export const sacrificeControlled = (
  count: number,
  types?: string[],
): CardInstruction => ({
  kind: 'sacrificeControlled',
  count,
  ...(types ? { types } : {}),
})

export const putTargetOnLibraryTop = (): CardInstruction => ({ kind: 'putTargetOnLibraryTop' })

export const destroyAll = (filter: TargetFilter): CardInstruction => ({ kind: 'destroyAll', filter })

export const destroyAllCreatures = (): CardInstruction => destroyAll({ type: 'Creature' })

export const bounceAll = (filter: TargetFilter): CardInstruction => ({ kind: 'bounceAll', filter })

export const millHalfTargetPlayers = (): CardInstruction => ({ kind: 'millHalfTargetPlayers' })

export const untapUpToLands = (count: number): CardInstruction => ({
  kind: 'untapUpToLands',
  count,
})

export const opponentsLoseLife = (amount: number): CardInstruction =>
  loseLife({ amount, to: players('opponent') })

export const revealTopLandsTapped = (): CardInstruction => ({ kind: 'revealTopLandsTapped' })

export const pumpAttached = (power: number, toughness: number): CardInstruction => ({
  kind: 'pumpAttached',
  power,
  toughness,
})

export const tapAttached = (): CardInstruction => ({ kind: 'tapAttached' })

export const bounceCreaturesExcept = (...subtypes: string[]): CardInstruction =>
  bounceAll({ type: 'Creature', excludeSubtypes: subtypes })

export const addPlusCountersEqualToLands = (): CardInstruction => ({
  kind: 'addPlusCountersEqualToLands',
})

export const pumpTargetEqualToLands = (trample = false): CardInstruction => ({
  kind: 'pumpTargetEqualToLands',
  trample,
})

export const returnFromGraveyard = (options: {
  max: number
  min?: number
  to?: 'hand' | 'battlefield'
  filter?: TargetFilter
  tapped?: boolean
  eachPlayer?: true
}): CardInstruction => ({
  kind: 'returnChosenLandFromGraveyard',
  min: options.min ?? 0,
  max: options.max,
  to: options.to ?? 'hand',
  ...(options.filter ? { filter: options.filter } : {}),
  ...(options.tapped !== undefined ? { tapped: options.tapped } : {}),
  ...(options.eachPlayer ? { eachPlayer: true } : {}),
})

/** Each player returns up to `count` cards from their graveyard to their hand. */
export const eachPlayerReturn = (count: number): CardInstruction =>
  returnFromGraveyard({ max: count, filter: {}, eachPlayer: true })

/** You may put a permanent card from your graveyard onto the battlefield. */
export const putPermanentFromGraveyard = (): CardInstruction => ({
  kind: 'returnChosenLandFromGraveyard',
  min: 0,
  max: 1,
  to: 'battlefield',
  tapped: false,
  filter: { permanent: true },
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

export const mayFightGrantSource = (): CardInstruction => ({ kind: 'mayFightGrantSource' })

export const putTriggeringCardOntoBattlefield = (): CardInstruction => ({
  kind: 'putTriggeringCardOntoBattlefield',
})

export const putMilledLandTapped = (): CardInstruction => ({ kind: 'putMilledLandTapped' })

export const draw = (
  count: number,
  who: 'controller' | 'target' = 'controller',
): CardInstruction => ({
  kind: 'draw',
  count,
  ...(who === 'target' ? { who } : {}),
})

export const discardCards = (
  count: number,
  who: 'controller' | 'target' = 'controller',
  extra: {
    optional?: boolean
    then?: { filter: TargetFilter; do: CardInstruction[] }
  } = {},
): CardInstruction => ({
  kind: 'discardCards',
  count,
  who,
  ...extra,
})

export const mayDiscard = (
  count = 1,
  then?: { filter: TargetFilter; do: CardInstruction[] },
): CardInstruction => ({
  kind: 'discardCards',
  count,
  optional: true,
  ...(then ? { then } : {}),
})

export const discardHandsThenDrawGreatest = (): CardInstruction => ({
  kind: 'discardHandsThenDrawGreatest',
})

export const returnOwnedGraveyardLands = (tapped = true): CardInstruction => ({
  kind: 'returnOwnedGraveyardLands',
  tapped,
})

export const bounceSelf = (): CardInstruction => ({ kind: 'bounceSelf' })

export const exileThisSpell = (): CardInstruction => ({ kind: 'exileThisSpell' })

export const removeTarget = (
  action: 'destroy' | 'bounce' | 'exile',
): CardInstruction => ({ kind: 'removeTarget', action })

export const opponentMayPayMana = (
  cost: string,
  ifNot: CardInstruction[],
  payer: 'active' | 'controller' = 'active',
): CardInstruction => ({
  kind: 'opponentMayPayMana',
  cost,
  payer,
  ifNot,
})

export const attackBanUntilEot = (
  defenderFilter: TargetFilter,
  attackerController: 'active' | 'controller' = 'active',
): CardInstruction => ({
  kind: 'attackBanUntilEot',
  defenderFilter,
  attackerController,
})

export const putHandCardOnLibraryBottom = (): CardInstruction => ({
  kind: 'putHandCardOnLibraryBottom',
})

export const putSelfOntoBattlefield = (): CardInstruction => ({
  kind: 'putSelfOntoBattlefield',
})

export const phaseOutTarget = (): CardInstruction => ({ kind: 'phaseOutTarget' })

export const createHeroWithLandCounters = (): CardInstruction => ({
  kind: 'createHeroWithLandCounters',
})

export const searchTargetControllerForBasicLandType = (): CardInstruction => ({
  kind: 'searchTargetControllerForBasicLandType',
})

export const delay = (
  condition: DelayedTriggerCondition,
  ...instructions: CardInstruction[]
): CardInstruction => ({
  kind: 'delay',
  condition,
  do: instructions,
})

export const delayThisTurn = (
  condition: DelayedTriggerCondition,
  ...instructions: CardInstruction[]
): CardInstruction => ({
  kind: 'delay',
  condition,
  do: instructions,
  untilCleanup: true,
})

export const returnToOwnersControl = (objectId?: string): CardInstruction => ({
  kind: 'returnToOwnersControl',
  ...(objectId ? { objectId } : {}),
})

/** If the first object target dies this turn, return it under its owner's control. */
export const returnIfDiesThisTurn = (): CardInstruction => ({
  kind: 'delay',
  condition: { kind: 'event', type: 'move', from: 'battlefield', to: 'graveyard' },
  do: [returnToOwnersControl()],
  untilCleanup: true,
  bindTarget: true,
})

export const createTokenInstruction = (token: TokenSpec): CardInstruction => ({
  kind: 'createToken',
  token,
})

export const destroyThenTokenForController = (token: TokenSpec): CardInstruction => ({
  kind: 'destroyThenTokenForController',
  token,
})

export const copySelf = (extra: { for?: 'controller' | 'targetPlayer' } = {}): CardInstruction => ({
  kind: 'copySelf',
  ...extra,
})

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

export const ifTargetTypes = (
  types: string[],
  whenTrue: CardInstruction[],
  whenFalse?: CardInstruction[],
): CardInstruction => ({
  kind: 'ifTargetTypes',
  types,
  whenTrue,
  ...(whenFalse ? { whenFalse } : {}),
})

export const pumpFromLinkedExilePower = (
  applyTo: 'self' | 'stackTarget',
): CardInstruction => ({
  kind: 'pumpFromLinkedExilePower',
  applyTo,
})

export const putLinkedExileToGraveyardGainLife = (): CardInstruction => ({
  kind: 'putLinkedExileToGraveyardGainLife',
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

export const getEnergy = (count: number): CardInstruction => ({ kind: 'getEnergy', count })

export const payEnergy = (count: number): CardInstruction => ({ kind: 'payEnergy', count })

export const gainLife = (
  value: number | 'triggerAmount' | { amount: number; to: PlayerSelector },
): CardInstruction => typeof value === 'object'
  ? { kind: 'gainLife', count: value.amount, to: value.to }
  : { kind: 'gainLife', count: value }

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

export const drawHandSize = (plus = 0): CardInstruction => ({ kind: 'drawHandSize', plus })

export const noMaximumHandSize = (): CardInstruction => ({ kind: 'noMaximumHandSize' })

export const drawHandDifference = (): CardInstruction => ({ kind: 'drawHandDifference' })

export const winGame = (): CardInstruction => ({ kind: 'winGame' })

export const putCountersOnTriggeringObject = (
  counter: string,
  count: number | 'triggerAmount',
): CardInstruction => ({ kind: 'putCounters', counter, count, subject: 'triggeringObject' })

export const tapTriggeringObject = (): CardInstruction => ({
  kind: 'tap',
  subject: 'triggeringObject',
})

export const addPlusCountersInstruction = (count: InstructionCount): CardInstruction => ({
  kind: 'addPlusCounters',
  count,
})

export const pumpAllCreaturesByX = (multiplier = -1): CardInstruction => ({
  kind: 'pumpAllCreaturesByX',
  multiplier,
})

export const revealUntil = (
  count: InstructionCount | 'opponentCount',
  match: TargetFilter,
  destination: 'hand' | 'battlefield',
  nonMatch: RevealUntilNonMatch,
  ...then: CardInstruction[]
): CardInstruction => ({
  kind: 'revealUntil',
  count,
  match,
  destination,
  nonMatch,
  ...(then.length > 0 ? { then } : {}),
})

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

export const putChargeCountersFromTimesKicked = (): CardInstruction => ({
  kind: 'putChargeCountersFromTimesKicked',
})

export const hiddenPileNegotiation = (
  pileSize: number,
  lifeLoss: number,
): CardInstruction => ({
  kind: 'hiddenPileNegotiation',
  pileSize,
  pileCount: 2,
  lifeLoss,
})

export const cumulativeUpkeepOpponentLife = (): CardInstruction => ({
  kind: 'cumulativeUpkeepOpponentLife',
})

export const loseAbilitiesBecome = (
  extraSubtype: string,
  power: number,
  toughness: number,
): CardInstruction => ({
  kind: 'loseAbilitiesBecome',
  extraSubtype,
  power,
  toughness,
})

export function loseLife(options: { amount: number; to: PlayerSelector }): CardInstruction

export function loseLife(amount: number | 'triggerAmount', who: 'triggeringPlayer' | 'controller'): CardInstruction

export function loseLife(
  value: number | 'triggerAmount' | { amount: number; to: PlayerSelector },
  who: 'triggeringPlayer' | 'controller' = 'controller',
): CardInstruction {
  return typeof value === 'object'
    ? { kind: 'loseLife', amount: value.amount, to: value.to }
    : { kind: 'loseLife', amount: value, who }
}

export const loseLifeTargetPlayer = (amount: number): CardInstruction => ({
  kind: 'loseLifeTargetPlayer',
  amount,
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

/** Look at the top `count` cards, put `pick` into your hand, the rest on the bottom in any order. */
export const mayCastFromHandWithoutPayingMana = (maxManaValue: number): CardInstruction => ({
  kind: 'mayCastFromHandWithoutPayingMana',
  maxManaValue,
})

export const lookTopPick = (count: number, pick: number): CardInstruction => ({
  kind: 'lookTopPick',
  count,
  pick,
})

export const lookTopPutLand = (
  count: number,
  extra: {
    orHand?: boolean
    countFromPower?: boolean
    anyNumber?: boolean
    tapped?: boolean
    shuffleAfter?: boolean
  } = {},
): CardInstruction => ({
  kind: 'lookTopPutLand',
  count,
  ...extra,
})

export const devour = (
  types: string[],
  countersPer: number,
  ...then: CardInstruction[]
): CardInstruction => ({
  kind: 'devour',
  types,
  countersPer,
  ...(then.length > 0 ? { then } : {}),
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

export const putPermanentsFromHand = (max: InstructionCount): CardInstruction => ({
  kind: 'putPermanentsFromHand',
  max,
})

export const putFromHand = (
  who: 'each' | 'active' | 'controller',
  extra: { max?: InstructionCount; types?: string[]; repeat?: boolean; optional?: boolean } = {},
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

export const gainControlPermanent = (untap = false): CardInstruction => ({
  kind: 'gainControlPermanent',
  ...(untap ? { untap: true } : {}),
})

export const pairDonateToOpponents = (
  objectIds: string[],
  distinctWhenBalanced = true,
): CardInstruction => ({
  kind: 'pairDonateToOpponents',
  objectIds,
  distinctWhenBalanced,
})

export const pairDonateRevealUntilMatches = (distinctWhenBalanced = true): CardInstruction => ({
  kind: 'pairDonateToOpponents',
  objectIds: [],
  objectIdsFromRevealUntil: true,
  distinctWhenBalanced,
})

export const bounceAttacking = (): CardInstruction => ({ kind: 'bounceAttacking' })

export const chooseVotesThisTurn = (): CardInstruction => ({ kind: 'chooseVotesThisTurn' })

export const addChosenColorMana = (
  colors?: Array<Exclude<ManaId, 'C'>>,
): CardInstruction => ({
  kind: 'addChosenColorMana',
  ...(colors ? { colors } : {}),
})

export const destroyTargetPermanent = (...types: string[]): CardInstruction => ({
  kind: 'destroyTargetPermanent',
  types,
})

export const ifYouDoExileFromGraveyard = (
  filter: TargetFilter = { type: 'Creature' },
): CardInstruction => ({
  kind: 'ifYouDoExileFromGraveyard',
  filter,
})

export const createTreasures = (
  count: number,
  who: 'you' | 'targetController' | 'triggeringPlayer',
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
    fromStackX?: boolean
    nonHuman?: boolean
    other?: boolean
  } = {},
): CardInstruction => ({
  kind: 'pumpControlled',
  power,
  toughness,
  ...options,
})

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

export const loseHalfLifeRoundedUp = (): CardInstruction => ({ kind: 'loseHalfLifeRoundedUp' })

export const addManaAtNextMainFromTarget = (): CardInstruction => ({
  kind: 'addManaAtNextMainFromTarget',
})

export const gainLifeTargetToughness = (): CardInstruction => ({ kind: 'gainLifeTargetToughness' })

export const tapOpponentsCreatures = (): CardInstruction => ({ kind: 'tapOpponentsCreatures' })

export const counterTargetSpell = (chosen = false): CardInstruction => ({
  kind: 'counterTargetSpell',
  ...(chosen ? { chosen: true as const } : {}),
})

export const copyTargetSpell = (): CardInstruction => ({ kind: 'copyTargetSpell' })

export const bounceTargetPermanent = (): CardInstruction => ({ kind: 'bounceTargetPermanent' })

export const addPlusCountersToControlled = (count: number): CardInstruction => ({
  kind: 'addPlusCountersToControlled',
  count,
})

export const opponentMayDrawThenStealCast = (count: number): CardInstruction => ({
  kind: 'opponentMayDrawThenStealCast',
  count,
})
