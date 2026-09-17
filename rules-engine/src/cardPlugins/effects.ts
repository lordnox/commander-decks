import { isPermanentType } from '../definitions'
import type Draft from '../draft'
import { DIALOG_CHOSEN, setPendingDialog } from '../pendingDialog'
import type {
  GameObject,
  GameState,
  ManaPool,
  PlayerId,
  StackItem,
  TriggerBindingIf,
  ZoneId,
} from '../types'

export type CardCondition =
  | { kind: 'otherLands'; min?: number; max?: number; subtype?: string }
  | { kind: 'controlledLands'; min?: number; max?: number }
  | { kind: 'uniqueLandNames'; min: number }
  | { kind: 'notActivePlayer' }
  | { kind: 'controlledCreaturePower'; min: number }
  | { kind: 'graveyardCards'; min: number }
  | { kind: 'graveyardPermanentCards'; min: number }
  | { kind: 'graveyardCardTypes'; min: number }
  | { kind: 'lacksControlledSubtype'; subtypes: string[] }
  | { kind: 'opponentsAtMost'; max: number }

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
  | { kind: 'gainLife'; count: number }
  | { kind: 'loseLife'; amount: number; who: 'triggeringPlayer' | 'controller' }
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
  type?: string
  types?: string[]
  nonland?: boolean
  noncreature?: boolean
  controller?: 'you' | 'opponent'
  spellTargetsControlledPermanent?: boolean
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
  | { op: 'replacement'; on: 'enters'; do: 'tapSelf' | 'tapUnlessPayLife'; life?: number; if?: CardCondition }
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
      do: CardInstruction[]
      if?: CardCondition | TriggerBindingIf
      creatureOnly?: boolean
      modal?: ModalSpec
    }
  | { op: 'modal'; choose: 'one' | 'any'; modes: ModalMode[] }
  | {
      op: 'activate'
      id: string
      manaAbility?: boolean
      targets?: 'any' | 'teferiSunsetPlusOne'
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
      allCreatureTypes?: boolean
      legendRuleOff?: boolean
    }
  | { op: 'handler'; pluginId: string }
  | { op: 'bestow'; cost: string }

export const selfMill = (count: number): CardInstruction => ({ kind: 'selfMill', count })

export const enters = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'enters',
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

export const createXTokens = (token: TokenSpec): CardInstruction => ({
  kind: 'createXTokens',
  token,
})

export const optionalMill = (count: number): CardInstruction => ({ kind: 'optionalMill', count })

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

export const gainLife = (count: number): CardInstruction => ({ kind: 'gainLife', count })

export const loseLife = (
  amount: number,
  who: 'triggeringPlayer' | 'controller',
): CardInstruction => ({ kind: 'loseLife', amount, who })

/** Declarative trigger on a kernel event type (`discard`, `draw`, …). */
export const triggerOn = (
  on: 'discard' | 'draw',
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

export const lacksControlledSubtype = (...subtypes: string[]): CardCondition => ({
  kind: 'lacksControlledSubtype',
  subtypes,
})

export const opponentsAtMost = (max: number): CardCondition => ({
  kind: 'opponentsAtMost',
  max,
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
  ...args: [...CardInstruction[], { creatureOnly?: boolean }?]
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
  zone: 'battlefield',
  tapped: false,
  summoningSickness: true,
  damageMarked: 0,
  counters: {},
  types: [],
  subtypes: [],
  supertypes: [],
  manaCost: '',
  manaValue: 0,
  colors: [],
  power: null,
  toughness: null,
  printedLoyalty: null,
  loyaltyActivatedTurn: null,
  oracleText: '',
  attachedTo: null,
  attacking: null,
  blocking: null,
  grantedRules: [],
  token: true,
  tags: [],
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
  const names = new Set(controlledLandList(state, object.controller).map((land) => land.name))
  return names.size >= condition.min
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

/** Imported live states and fixtures both carry a cost but not always a stored manaValue. */
const manaValueOf = (object: GameObject) =>
  object.manaCost
    ? [...object.manaCost.matchAll(/\{([^}]+)\}/g)].reduce((total, match) => {
      if (/^\d+$/.test(match[1])) return total + Number(match[1])
      return match[1] === 'X' ? total : total + 1
    }, 0)
    : object.manaValue ?? 0

export const runInstructions = (
  draft: Draft,
  source: GameObject,
  instructions: CardInstruction[],
  item?: StackItem,
) => {
  for (const instruction of instructions) {
    if (instruction.kind === 'if') {
      const live = draft.object(source.id) ?? source
      const chosen = conditionHolds(instruction.if, draft, live)
        ? instruction.whenTrue
        : instruction.whenFalse ?? []
      runInstructions(draft, source, chosen, item)
      continue
    }
    if (instruction.kind === 'selfMill') {
      millLibrary(draft, source.controller, instruction.count)
      continue
    }
    if (instruction.kind === 'bounceSelf') {
      draft.enqueue({ type: 'move', objectId: source.id, to: 'hand' })
      continue
    }
    if (instruction.kind === 'tap') {
      draft.enqueue({ type: 'tap', objectId: source.id })
      continue
    }
    if (instruction.kind === 'payMana') {
      draft.enqueue({ type: 'payMana', seat: source.controller, cost: instruction.cost })
      continue
    }
    if (instruction.kind === 'sacrificeSelf') {
      draft.enqueue({ type: 'move', objectId: source.id, to: 'graveyard' })
      continue
    }
    if (instruction.kind === 'addMana') {
      draft.enqueue({ type: 'addMana', seat: source.controller, mana: instruction.mana })
      continue
    }
    if (instruction.kind === 'addManaToEachPlayer') {
      for (const player of Object.values(draft.players)) {
        draft.enqueue({ type: 'addMana', seat: player.id, mana: instruction.mana })
      }
      continue
    }
    if (instruction.kind === 'draw') {
      draft.enqueue({ type: 'draw', seat: source.controller, count: instruction.count })
      continue
    }
    if (instruction.kind === 'gainLife') {
      draft.players[source.controller].life += instruction.count
      continue
    }
    if (instruction.kind === 'loseLife') {
      const seat = instruction.who === 'controller'
        ? source.controller
        : typeof item?.payload?.triggeringPlayer === 'string'
          ? item.payload.triggeringPlayer
          : source.controller
      draft.enqueue({
        type: 'loseLife',
        seat,
        amount: instruction.amount,
        source: source.id,
      })
      continue
    }
    if (instruction.kind === 'loseLifeTargetManaValue') {
      const target = item?.targets[0]
      if (target?.kind !== 'object') continue
      const object = draft.object(target.objectId)
      if (!object) continue
      draft.players[source.controller].life -= manaValueOf(object)
      continue
    }
    if (instruction.kind === 'teferiSunsetPlusOne') {
      for (const target of item?.targets ?? []) {
        if (target.kind !== 'object') continue
        const object = draft.object(target.objectId)
        if (!object || object.zone !== 'battlefield') continue
        draft.enqueue({
          type: object.controller === source.controller ? 'untap' : 'tap',
          objectId: object.id,
        })
      }
      draft.players[source.controller].life += 2
      continue
    }
    if (instruction.kind === 'lookTopChooseOne') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'look-top',
        prompt: `Look at the top ${instruction.count} cards. Put one into your hand and the rest on the bottom in any order.`,
        waiting: 'is making a private top-card choice.',
        judge: 'Waiting for a private top-card choice.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['bottom', 'hand'],
        count: instruction.count,
        requirements: { hand: { min: 1, max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'teferiSunsetEmblem') {
      draft.enqueue({
        type: 'custom',
        name: 'teferiSunset.emblem',
        seat: source.controller,
      })
      continue
    }
    if (instruction.kind === 'dealDamageToChosenTarget') {
      const target = item?.targets[0]
      if (target) {
        draft.enqueue({
          type: 'dealDamage',
          sourceId: source.id,
          target,
          amount: instruction.amount,
        })
      }
      continue
    }
    if (instruction.kind === 'exileColoredPermanentsAtMostX') {
      const x = item?.x ?? 0
      for (const object of Object.values(draft.objects)) {
        if (
          object.zone === 'battlefield'
          && object.colors.length > 0
          && object.manaValue <= x
        ) {
          draft.enqueue({ type: 'move', objectId: object.id, to: 'exile' })
        }
      }
      continue
    }
    if (instruction.kind === 'putPermanentsFromHand') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'put-permanents',
        prompt: `You may put up to ${instruction.max} permanent cards from your hand onto the battlefield.`,
        waiting: 'is choosing permanent cards privately.',
        judge: 'Waiting for an optional permanent-card choice.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['hand', 'battlefield'],
        permanent: true,
        optional: true,
        requirements: { battlefield: { max: instruction.max } },
      })
      continue
    }
    if (instruction.kind === 'putFromHand') {
      const living = draft.playerOrder.filter((seat) => !draft.players[seat].lost)
      const start = instruction.who === 'active'
        ? draft.active
        : source.controller
      const startIndex = Math.max(0, living.indexOf(start))
      const seats = instruction.who === 'each'
        ? [...living.slice(startIndex), ...living.slice(0, startIndex)]
        : [start]
      const types = instruction.types
      for (const seat of seats) {
        setPendingDialog(draft, {
          sourceId: source.id,
          source: source.name,
          seat,
          kind: 'put-permanents',
          prompt: types
            ? `You may put up to ${instruction.max} ${types.join(', ').toLowerCase()} card(s) from your hand onto the battlefield.`
            : `You may put up to ${instruction.max} permanent card(s) from your hand onto the battlefield.`,
          waiting: 'is choosing a card to put onto the battlefield.',
          judge: `Waiting for ${source.name} dump choices.`,
          chosenEvent: DIALOG_CHOSEN,
          destinations: ['hand', 'battlefield'],
          ...(types ? { types } : { permanent: true }),
          optional: instruction.optional !== false,
          sequence: draft.allocTs(),
          requirements: { battlefield: { max: instruction.max } },
        })
      }
      if (instruction.repeat) {
        draft.players[source.controller].data['dumpFromHand.repeat'] = {
          sourceId: source.id,
          source: source.name,
          types,
          max: instruction.max,
        }
      }
      continue
    }
    if (instruction.kind === 'secretCouncil') {
      draft.enqueue({
        type: 'custom',
        name: 'secretCouncil.begin',
        seat: source.controller,
        payload: { sourceId: source.id, source: source.name },
      })
      continue
    }
    if (instruction.kind === 'fightUpToOne') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'fight-target',
        prompt: `Choose up to one creature ${source.name} fights.`,
        waiting: 'is choosing a creature to fight.',
        judge: `Waiting for ${source.name} to pick a fight.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        types: ['Creature'],
        optional: true,
        sequence: draft.allocTs(),
        requirements: { target: { max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'fight') {
      const left = instruction.with === 'self-target'
        ? { kind: 'object' as const, objectId: source.id }
        : item?.targets[0]
      const right = instruction.with === 'self-target'
        ? item?.targets[0]
        : item?.targets[1]
      if (left?.kind === 'object' && right?.kind === 'object') {
        const first = draft.object(left.objectId)
        const second = draft.object(right.objectId)
        if (first && second) {
          draft.enqueue({
            type: 'dealDamage',
            sourceId: first.id,
            target: { kind: 'object', objectId: second.id },
            amount: first.power ?? 0,
          })
          draft.enqueue({
            type: 'dealDamage',
            sourceId: second.id,
            target: { kind: 'object', objectId: first.id },
            amount: second.power ?? 0,
          })
          draft.note(`${first.name} fights ${second.name}`)
        }
      }
      continue
    }
    if (instruction.kind === 'exchangeControlUntilEot') {
      const opponent = item?.targets.find((target) => target.kind === 'player')
      if (opponent?.kind === 'player') {
        const you = source.controller
        const them = opponent.player
        const swaps: Array<{ objectId: string; previous: string }> = []
        for (const object of Object.values(draft.objects)) {
          if (object.zone !== 'battlefield' || !object.types.includes('Creature')) continue
          if (object.controller !== you && object.controller !== them) continue
          swaps.push({ objectId: object.id, previous: object.controller })
          object.controller = object.controller === you ? them : you
          object.tapped = false
          if (!/haste/i.test(object.oracleText)) {
            object.oracleText = object.oracleText ? `${object.oracleText}\nHaste` : 'Haste'
          }
        }
        draft.players[you].data['reinsOfPower.swaps'] = [
          ...((Array.isArray(draft.players[you].data['reinsOfPower.swaps'])
            ? draft.players[you].data['reinsOfPower.swaps']
            : []) as Array<{ objectId: string; previous: string }>),
          ...swaps,
        ]
        draft.note(`${you} exchanges creature control with ${them}`)
      }
      continue
    }
    if (instruction.kind === 'bounceAttacking') {
      for (const object of Object.values(draft.objects)) {
        if (object.zone === 'battlefield' && object.attacking) {
          draft.enqueue({ type: 'move', objectId: object.id, to: 'hand' })
        }
      }
      continue
    }
    if (instruction.kind === 'chooseVotesThisTurn') {
      draft.players[source.controller].data['secretCouncil.chooseVotes'] = true
      continue
    }
    if (instruction.kind === 'discardHandsThenDrawGreatest') {
      const count = Math.max(
        0,
        ...draft.playerOrder.map((seat) => draft.zoneOrder[seat].hand.length),
      )
      for (const seat of draft.playerOrder) {
        for (const objectId of draft.zoneOrder[seat].hand) {
          draft.enqueue({ type: 'discard', seat, objectId })
        }
        draft.enqueue({ type: 'draw', seat, count })
      }
      continue
    }
    if (instruction.kind === 'extraLandPlays') {
      draft.enqueue({
        type: 'custom',
        name: 'additionalLandPlay.grant',
        seat: source.controller,
        payload: { count: instruction.count },
      })
      continue
    }
    if (instruction.kind === 'returnOwnedGraveyardLands') {
      returnOwnedLands(draft, source.controller, instruction.tapped !== false)
      continue
    }
    if (instruction.kind === 'createToken') {
      createToken(draft, source.controller, {
        name: instruction.token.name,
        types: instruction.token.types,
        subtypes: instruction.token.subtypes ?? [],
        power: instruction.token.power ?? null,
        toughness: instruction.token.toughness ?? null,
        oracleText: instruction.token.oracleText ?? '',
      })
      continue
    }
    if (instruction.kind === 'copySelf') {
      const live = draft.object(source.id) ?? source
      createToken(draft, live.controller, {
        name: live.name,
        types: [...live.types],
        subtypes: [...live.subtypes],
        power: live.power,
        toughness: live.toughness,
        oracleText: live.oracleText,
        effects: live.effects ?? [],
      })
      continue
    }
    if (instruction.kind === 'doublePlusCounters') {
      const live = draft.object(source.id)
      if (!live) continue
      addPlusCounters(live, live.counters['+1/+1'] ?? 0)
      draft.note(`${live.name} doubles to ${live.counters['+1/+1'] ?? 0} +1/+1 counters`)
      continue
    }
    if (instruction.kind === 'surveil') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'surveil',
        prompt: `Surveil ${instruction.count}.`,
        waiting: 'is making a private surveil choice.',
        judge: 'Waiting for a private surveil choice.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['top', 'graveyard'],
        count: instruction.count,
      })
      continue
    }
    if (instruction.kind === 'putLandFromHand') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'put-land',
        prompt: instruction.tapped
          ? 'You may put a land from your hand onto the battlefield tapped.'
          : 'You may put a land from your hand onto the battlefield.',
        waiting: 'is choosing a land privately.',
        judge: 'Waiting for an optional land.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['hand', 'battlefield'],
        types: ['Land'],
        optional: true,
        requirements: { battlefield: { max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'bounceChosenLand') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'bounce-land',
        prompt: 'Return a land you control to its owner’s hand.',
        waiting: 'is choosing a land to return.',
        judge: 'Waiting for a land to bounce.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['battlefield', 'hand'],
        types: ['Land'],
        requirements: { hand: { min: 1, max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'revealPick') {
      const ids = draft.zoneOrder[source.controller].library.slice(0, instruction.count)
      if (ids.length > 0) {
        draft.enqueue({ type: 'reveal', seat: source.controller, objectIds: ids, source: source.name })
      }
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'reveal-pick',
        prompt: instruction.type
          ? `You may put a ${instruction.type.toLowerCase()} card into your hand.`
          : 'You may put a matching card into your hand.',
        waiting: 'is choosing among revealed cards.',
        judge: 'Waiting for a revealed-card pick.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['hand', 'graveyard'],
        count: instruction.count,
        ...(instruction.type ? { types: [instruction.type] } : {}),
        ...(instruction.permanent ? { permanent: true } : {}),
        optional: true,
        requirements: { hand: { max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'copyControlledCreature') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'copy-creature',
        prompt: 'You may have this enter as a copy of a creature you control.',
        waiting: 'is choosing a creature to copy.',
        judge: 'Waiting for an optional clone.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        types: ['Creature'],
        optional: true,
        requirements: { target: { max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'copyTargetCreature') {
      const target = item?.targets[0]
      if (target?.kind !== 'object') continue
      const copied = draft.object(target.objectId)
      if (!copied) continue
      createToken(draft, source.controller, copyTemplate(copied, {
        notLegendary: instruction.notLegendary,
        flying: instruction.flying,
      }))
      continue
    }
    if (instruction.kind === 'returnTargetFromGraveyard') {
      const target = item?.targets[0]
      if (target?.kind !== 'object') continue
      draft.enqueue({
        type: 'move',
        objectId: target.objectId,
        to: instruction.to,
        ...(instruction.to === 'battlefield' ? { controller: source.controller } : {}),
      })
      if (instruction.tapped && instruction.to === 'battlefield') {
        draft.enqueue({ type: 'tap', objectId: target.objectId })
      }
      continue
    }
    if (instruction.kind === 'pump') {
      const target = item?.targets[0]
      const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
      if (!object || object.power === null || object.toughness === null) continue
      object.power += instruction.power
      object.toughness += instruction.toughness
      continue
    }
    if (instruction.kind === 'grantUntilEot') {
      const target = item?.targets[0]
      const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
      if (!object) continue
      const extra = instruction.keywords.join(', ')
      object.oracleText = object.oracleText
        ? `${object.oracleText}\n${extra}`
        : extra
      continue
    }
    if (instruction.kind === 'createXTokens') {
      const count = Math.max(0, item?.x ?? 0)
      for (let index = 0; index < count; index += 1) {
        createToken(draft, source.controller, {
          name: instruction.token.name,
          types: instruction.token.types,
          subtypes: instruction.token.subtypes ?? [],
          power: instruction.token.power ?? null,
          toughness: instruction.token.toughness ?? null,
          oracleText: instruction.token.oracleText ?? '',
        })
      }
      continue
    }
    if (instruction.kind === 'dealDamageToSelf') {
      draft.enqueue({
        type: 'dealDamage',
        sourceId: source.id,
        target: { kind: 'player', player: source.controller },
        amount: instruction.amount,
      })
      continue
    }
    if (instruction.kind === 'addChosenColorMana') {
      continue
    }
    if (instruction.kind === 'putMilledLandTapped') {
      continue
    }
    if (instruction.kind === 'optionalMill') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'may',
        prompt: `You may mill ${instruction.count} cards.`,
        waiting: 'is deciding whether to mill.',
        judge: 'Waiting for an optional mill.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        count: instruction.count,
        optional: true,
      })
      continue
    }
    if (instruction.kind === 'returnChosenLandFromGraveyard') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'return-land',
        prompt: 'Return a land card from your graveyard to the battlefield tapped.',
        waiting: 'is choosing a land in the graveyard.',
        judge: 'Waiting for a graveyard land.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['graveyard', 'battlefield'],
        types: ['Land'],
        requirements: { battlefield: { min: 1, max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'drawAtNextUpkeep') {
      const seat = instruction.who === 'you'
        ? source.controller
        : item?.targets[0]?.kind === 'object'
          ? draft.object(item.targets[0].objectId)?.controller
          : item?.targets[0]?.kind === 'player'
            ? item.targets[0].player
            : undefined
      if (!seat) continue
      const player = draft.players[seat]
      const queued = Array.isArray(player.data.delayedDraw)
        ? [...player.data.delayedDraw as number[]]
        : []
      queued.push(instruction.optional ? -instruction.count : instruction.count)
      player.data.delayedDraw = queued
      continue
    }
    if (instruction.kind === 'copyAllCreaturesUntilEot') {
      const target = item?.targets[0]
      const copied = target?.kind === 'object' ? draft.object(target.objectId) : undefined
      if (!copied) continue
      for (const object of Object.values(draft.objects)) {
        if (object.zone !== 'battlefield' || !object.types.includes('Creature')) continue
        if (object.id === copied.id) continue
        applyCopy(object, copied, { notLegendary: instruction.notLegendary })
      }
      continue
    }
    if (instruction.kind === 'createTreasures') {
      const seat = instruction.who === 'you'
        ? source.controller
        : item?.targets[0]?.kind === 'object'
          ? draft.object(item.targets[0].objectId)?.controller
          : undefined
      if (!seat) continue
      for (let index = 0; index < instruction.count; index += 1) {
        createToken(draft, seat, {
          name: 'Treasure',
          types: ['Artifact'],
          subtypes: ['Treasure'],
          oracleText: '{T}, Sacrifice this token: Add one mana of any color.',
        })
      }
      continue
    }
    if (instruction.kind === 'drawGreatestPower') {
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
      continue
    }
    if (instruction.kind === 'pumpControlled') {
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
        if (object.power !== null) object.power += bonus
        if (object.toughness !== null) object.toughness += toughnessBonus
        if (instruction.trample && !object.oracleText.toLowerCase().includes('trample')) {
          object.oracleText = object.oracleText ? `${object.oracleText}\nTrample` : 'Trample'
        }
      }
      continue
    }
    if (instruction.kind === 'searchLibrary') {
      draft.enqueue({
        type: 'custom',
        name: 'librarySearch.begin',
        seat: source.controller,
        payload: {
          source: source.name,
          sourceId: source.id,
          via: 'resolve',
          spec: instruction.spec,
        },
      })
      continue
    }
    if (instruction.kind === 'fightOwnedVsOpponent') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'fight-own',
        prompt: 'Choose a creature you control to fight.',
        waiting: 'is choosing a creature to fight with.',
        judge: `Waiting for ${source.name} fight targets.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        types: ['Creature'],
        optional: true,
        requirements: { target: { max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'counterUnlessPay') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'counter-unless',
        prompt: `Counter target noncreature spell unless its controller pays {${instruction.amount}}.`,
        waiting: 'is choosing a spell to counter.',
        judge: `Waiting for ${source.name} to pick a stack target.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        requirements: { target: { max: 1 } },
      })
      draft.players[source.controller].data['counterUnlessPay.amount'] = instruction.amount
      continue
    }
    if (instruction.kind === 'copyTargetSpell') {
      const target = item?.targets[0]
      if (target?.kind !== 'object') continue
      const copied = draft.object(target.objectId)
      const stackItem = draft.stack.find((candidate) => candidate.objectId === target.objectId)
      if (!copied || !stackItem || copied.zone !== 'stack') continue
      draft.stack.unshift({
        id: draft.allocId('s'),
        kind: 'spell',
        objectId: copied.id,
        controller: source.controller,
        name: copied.name,
        targets: [...stackItem.targets],
        ...(stackItem.kicked ? { kicked: true } : {}),
        ...(stackItem.x !== undefined ? { x: stackItem.x } : {}),
        ...(stackItem.choices ? { choices: [...stackItem.choices] } : {}),
      })
      draft.note(`${source.name} copies ${copied.name}`)
      continue
    }
    if (instruction.kind === 'destroyTargetPermanent') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'destroy-permanent',
        prompt: `Destroy target ${instruction.types.join(' or ').toLowerCase()}.`,
        waiting: 'is choosing a permanent to destroy.',
        judge: `Waiting for ${source.name} to pick a target.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        types: instruction.types,
        optional: true,
        requirements: { target: { max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'grantControlled') {
      const extra = instruction.keywords.join(', ')
      for (const object of Object.values(draft.objects)) {
        if (object.zone !== 'battlefield' || object.controller !== source.controller) continue
        if (!object.types.includes('Creature')) continue
        if (instruction.other && object.id === source.id) continue
        if (instruction.nonHuman && object.subtypes.includes('Human')) continue
        object.oracleText = object.oracleText ? `${object.oracleText}\n${extra}` : extra
      }
      continue
    }
    if (instruction.kind === 'lookTopPutLand') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'look-top-land',
        prompt: `Look at the top ${instruction.count} cards. You may put a land onto the battlefield tapped.`,
        waiting: 'is choosing among the top cards.',
        judge: 'Waiting for a look-top land choice.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['bottom', 'battlefield'],
        count: instruction.count,
        types: ['Land'],
        optional: true,
        requirements: { battlefield: { max: 1 } },
      })
      continue
    }
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

function copyTemplate (
  card: GameObject,
  extra: { notLegendary?: boolean; flying?: boolean } = {},
): Partial<GameObject> & { name: string } {
  return {
    name: card.name,
    summoningSickness: card.types.includes('Creature'),
    types: [...card.types],
    subtypes: [...card.subtypes],
    supertypes: extra.notLegendary
      ? card.supertypes.filter((entry) => entry !== 'Legendary')
      : [...card.supertypes],
    manaCost: card.manaCost,
    power: card.power,
    toughness: card.toughness,
    oracleText: extra.flying && !card.oracleText.toLowerCase().includes('flying')
      ? `${card.oracleText}\nFlying`
      : card.oracleText,
    grantedRules: [...card.grantedRules],
    tapProduces: card.tapProduces ? { ...card.tapProduces } : undefined,
    effects: card.effects ? [...card.effects] : [],
  }
}

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

export const handlerIdsFromEffects = (effects: CardEffect[]) => {
  const ids = new Set<string>()
  for (const effect of effects) {
    if (effect.op === 'replacement') ids.add('entersTapped')
    if (effect.op === 'trigger' && (
      effect.on === 'enters' || effect.on === 'dies' || effect.on === 'leaves'
      || effect.on === 'attacks' || effect.on === 'landToGraveyard' || effect.on === 'upkeep'
    )) {
      ids.add('zoneTriggers')
    }
    if (effect.op === 'trigger' && effect.on === 'cast') {
      ids.add('castTriggers')
      if (effect.modal) ids.add('choiceEffects')
    }
    if (effect.op === 'modal') ids.add('modalSpell')
    if (effect.op === 'trigger' && effect.on === 'landfall') ids.add('landfall')
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
    if (effect.op === 'bestow') ids.add('bestow')
    if (effect.op === 'handler') ids.add(effect.pluginId)
    if (effect.op === 'trigger' && [
      'surveil', 'putLandFromHand', 'bounceChosenLand', 'revealPick',
      'copyControlledCreature', 'copyTargetCreature', 'optionalMill',
      'returnChosenLandFromGraveyard', 'copyAllCreaturesUntilEot',
      'drawAtNextUpkeep', 'grantUntilEot', 'pump', 'createXTokens',
      'putFromHand', 'secretCouncil', 'fight', 'fightUpToOne',
      'exchangeControlUntilEot', 'bounceAttacking', 'chooseVotesThisTurn',
      'createTreasures', 'drawGreatestPower', 'pumpControlled', 'searchLibrary',
      'fightOwnedVsOpponent', 'counterUnlessPay', 'copyTargetSpell',
      'destroyTargetPermanent', 'lookTopPutLand', 'grantControlled',
    ].some((kind) => effect.do.some((instruction) => instruction.kind === kind))) {
      ids.add('choiceEffects')
      if (effect.do.some((instruction) => instruction.kind === 'putFromHand')) {
        ids.add('dumpFromHand')
      }
      if (effect.do.some((instruction) =>
        instruction.kind === 'secretCouncil' || instruction.kind === 'chooseVotesThisTurn')) {
        ids.add('secretCouncil')
      }
      if (effect.do.some((instruction) =>
        instruction.kind === 'fight'
        || instruction.kind === 'fightUpToOne'
        || instruction.kind === 'fightOwnedVsOpponent')) {
        ids.add('fight')
      }
      if (effect.do.some((instruction) => instruction.kind === 'searchLibrary')) {
        ids.add('librarySearch')
      }
      if (effect.do.some((instruction) =>
        instruction.kind === 'counterUnlessPay'
        || instruction.kind === 'destroyTargetPermanent'
        || instruction.kind === 'lookTopPutLand')) {
        ids.add('choiceEffects')
      }
      if (effect.do.some((instruction) => instruction.kind === 'exchangeControlUntilEot')) {
        ids.add('reinsOfPower')
      }
    }
    if (effect.op === 'activate' && effect.do.some((instruction) =>
      instruction.kind === 'putLandFromHand'
      || instruction.kind === 'bounceChosenLand'
      || instruction.kind === 'copyTargetCreature'
      || instruction.kind === 'addChosenColorMana'
      || instruction.kind === 'fight'
      || instruction.kind === 'putFromHand')) {
      ids.add('choiceEffects')
      if (effect.do.some((instruction) => instruction.kind === 'fight')) ids.add('fight')
    }
  }
  return [...ids]
}

export const pluginIdsFromEffects = (effects: CardEffect[]) =>
  effects.flatMap((effect) =>
    effect.op === 'static' && effect.pluginId ? [effect.pluginId] : [])
