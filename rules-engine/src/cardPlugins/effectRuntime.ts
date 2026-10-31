import { snapshotObject } from '../objectIdentity'
import { copiableColors, reapplyColorChanges } from './colorEffects'
import { gameObjectFieldDefaults, isPermanentType, setEntryLoyalty } from '../definitions'
import type Draft from '../draft'
import { abilityTokens, hasKeyword } from '../keywords'
import { legendaryCombatDamageFrom } from '../plugins/combatLegendaryDamage'
import { lifeLostThisTurn } from '../plugins/life'
import type {
  GameObject,
  GameState,
  PlayerId,
  StackItem,
} from '../types'
import type { CardCondition, CardEffect, TokenSpec } from './effectDefinitions'
import { cloneJsonData, deepFreezeData } from './dsl/compiler/data'
import { RULE_DSL_SCHEMA_VERSION } from './dsl/schema/v2'
import { card } from './dsl/sugar/card'
import type { ColorSet } from '../../../shared/cardColors'

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

const activeOpponents = (state: GameState, controller: PlayerId) =>
  state.playerOrder.filter((seat) => seat !== controller && !state.players[seat].lost)

const controlledCreatureCount = (state: GameState, seat: PlayerId) =>
  Object.values(state.objects).filter((candidate) =>
    candidate.zone === 'battlefield'
    && candidate.controller === seat
    && candidate.types.includes('Creature')).length

const tokenDefaults = (): Omit<GameObject, 'id' | 'name' | 'owner' | 'controller'> => ({
  ...gameObjectFieldDefaults(),
  zone: 'battlefield',
  summoningSickness: true,
  token: true,
})

export const tokenFieldsFromSpec = (token: TokenSpec): Partial<GameObject> & { name: string } => ({
  name: token.name,
  types: token.types,
  subtypes: token.subtypes ?? [],
  power: token.power ?? null,
  toughness: token.toughness ?? null,
  colors: token.colors ?? '',
  oracleText: token.oracleText ?? '',
})

/** Tokens are created by an effect rather than moved from another zone. */
export const createToken = (
  draft: Draft,
  controller: PlayerId,
  template: Partial<GameObject> & { name: string },
  emitEntry = true,
) => {
  const id = draft.allocId('tok')
  const tokenTemplate = { ...template }
  delete tokenTemplate.effects
  const token: GameObject = {
    ...tokenDefaults(),
    ...tokenTemplate,
    id,
    owner: controller,
    controller,
    zone: 'battlefield',
    token: true,
    battlefieldTimestamp: draft.allocTs(),
  }
  if (token.counters.loyalty === undefined) setEntryLoyalty(token)
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
  draft.enqueue({ type: 'tokenCreated', object: snapshotObject(token) })
  if (emitEntry) {
    draft.enqueue({
      type: 'custom',
      name: 'cardPlugins.permanentEntered',
      seat: controller,
      payload: { objectId: id, createdToken: true },
    })
  }
  return token
}

/** Emblems are command-zone objects, not tokens, and do not enter the battlefield. */
export const createEmblem = (
  draft: Draft,
  controller: PlayerId,
  emblem: {
    name: string
    subtypes?: string[]
    oracleText?: string
    ruleDefinition?: GameObject['ruleDefinition']
  },
) => {
  const id = draft.allocId('emblem')
  const object: GameObject = {
    ...gameObjectFieldDefaults(),
    name: emblem.name,
    types: ['Emblem'],
    subtypes: emblem.subtypes ? [...emblem.subtypes] : [],
    oracleText: emblem.oracleText ?? '',
    ...(emblem.ruleDefinition ? { ruleDefinition: emblem.ruleDefinition } : {}),
    id,
    owner: controller,
    controller,
    zone: 'command',
    token: false,
    effects: [],
  }
  draft.objects[id] = object
  draft.zoneOrder[controller].command.push(id)
  draft.zoneCounts[controller].command += 1
  draft.note(`${controller} gets ${object.name}`)
  return object
}

export const manaValueOf = (object: GameObject) => {
  if (object.manaValue !== 0 || !object.manaCost) return object.manaValue
  return [...object.manaCost.matchAll(/\{([^}]+)\}/g)].reduce((total, match) => {
    const symbol = match[1]
    if (/^\d+$/.test(symbol)) return total + Number(symbol)
    if (symbol === 'X') return total
    const hybridNumber = symbol.match(/^(\d+)\//)
    return total + (hybridNumber ? Number(hybridNumber[1]) : 1)
  }, 0)
}

export const applyCopyExtraFromExcept = (except?: {
  notLegendary?: true | boolean
  noManaCost?: true | boolean
  colors?: ColorSet
  types?: readonly string[]
  subtypes?: readonly string[]
  keywords?: readonly string[]
  keepName?: true | boolean
  keepCopyAbility?: true | boolean
  keepAbilities?: true | boolean
} ) => ({
  ...(except?.notLegendary ? { notLegendary: true } : {}),
  ...(except?.noManaCost ? { noManaCost: true } : {}),
  ...(except?.colors !== undefined ? { colors: except.colors } : {}),
  ...(except?.types ? { extraTypes: [...except.types] } : {}),
  ...(except?.subtypes ? { extraSubtypes: [...except.subtypes] } : {}),
  ...(except?.keywords ? { keywords: [...except.keywords] } : {}),
  ...(except?.keepName ? { keepName: true } : {}),
  ...(except?.keepCopyAbility ? { keepAbility: true } : {}),
  ...(except?.keepAbilities ? { keepAbilities: true } : {}),
})

export type CopyModifiers = {
  notLegendary?: boolean
  flying?: boolean
  keywords?: readonly string[]
  colors?: ColorSet
  extraTypes?: readonly string[]
  extraSubtypes?: readonly string[]
  noManaCost?: boolean
  tapped?: boolean
}

const keywordOracleLine = (keyword: string) =>
  `${keyword.charAt(0).toUpperCase()}${keyword.slice(1)}`

const requestedKeywords = (extra: CopyModifiers) =>
  [...new Set([...(extra.keywords ?? []), ...(extra.flying ? ['flying'] : [])])]

type CopyCharacteristicFields = {
  types: string[]
  subtypes?: string[]
  supertypes?: string[]
  colors?: ColorSet
  manaCost?: string
  manaValue?: number
  oracleText?: string
}

export const applyCopyModifiers = <T extends CopyCharacteristicFields>(
  characteristics: T,
  extra: CopyModifiers = {},
): T => {
  const keywords = requestedKeywords(extra)
    .filter(keyword => !abilityTokens(characteristics.oracleText ?? '').includes(keyword))
  const oracleAdditions = keywords.map(keywordOracleLine)
  return {
    ...characteristics,
    types: extra.extraTypes
      ? [...new Set([...characteristics.types, ...extra.extraTypes])]
      : [...characteristics.types],
    ...(extra.extraSubtypes
      ? { subtypes: [...new Set([...extra.extraSubtypes, ...(characteristics.subtypes ?? [])])] }
      : {}),
    ...(extra.notLegendary
      ? { supertypes: (characteristics.supertypes ?? []).filter(entry => entry !== 'Legendary') }
      : {}),
    ...(extra.colors !== undefined ? { colors: extra.colors } : {}),
    ...(extra.noManaCost ? { manaCost: '', manaValue: 0 } : {}),
    ...(oracleAdditions.length > 0
      ? { oracleText: [characteristics.oracleText, ...oracleAdditions].filter(Boolean).join('\n') }
      : {}),
    ...(extra.tapped ? { tapped: true as const } : {}),
  } as T
}

export const copyCharacteristics = (
  copied: GameObject,
  extra: CopyModifiers = {},
) => applyCopyModifiers({
  name: copied.name,
  types: [...copied.types],
  subtypes: [...copied.subtypes],
  supertypes: [...copied.supertypes],
  manaCost: copied.manaCost,
  manaValue: manaValueOf(copied),
  colors: copiableColors(copied),
  power: copied.power,
  toughness: copied.toughness,
  printedLoyalty: copied.printedLoyalty,
  oracleText: copied.oracleText,
  grantedRules: [...copied.grantedRules],
  tapProduces: copied.tapProduces ? { ...copied.tapProduces } : undefined,
  ...(copied.ruleDefinition ? { ruleDefinition: structuredClone(copied.ruleDefinition) } : {}),
}, {
  ...extra,
  keywords: requestedKeywords(extra).filter(keyword => !hasKeyword(copied, keyword)),
  flying: undefined,
})

export const copyTokenTemplate = (
  card: GameObject,
  extra: CopyModifiers = {},
): Partial<GameObject> & { name: string } => {
  const characteristics = copyCharacteristics(card, extra)
  return {
    ...characteristics,
    summoningSickness: true,
    counters: card.printedLoyalty === null ? {} : { loyalty: card.printedLoyalty },
    tags: [],
  }
}

const addPtCounters = (object: GameObject, counter: '+1/+1' | '-1/-1', amount: number) => {
  if (amount === 0) return
  object.counters[counter] = (object.counters[counter] ?? 0) + amount
  const delta = counter === '+1/+1' ? amount : -amount
  if (object.power !== null) object.power += delta
  if (object.toughness !== null) object.toughness += delta
}

export const addPlusCounters = (object: GameObject, amount: number) =>
  addPtCounters(object, '+1/+1', amount)

export const addMinusCounters = (object: GameObject, amount: number) =>
  addPtCounters(object, '-1/-1', amount)

/** Objects keep the whole "Front // Back" card name, and which face is up is not tracked, so names compare by front face. */
const frontFaceName = (object: GameObject) => object.name.split(' // ')[0]

/** `triggering` is the permanent a watching trigger saw enter or be sacrificed. */
export const conditionHolds = (
  condition: CardCondition | undefined,
  state: GameState,
  object: GameObject,
  stackItem?: StackItem,
  triggering?: GameObject,
) => {
  if (!condition) return true
  if (condition.kind === 'sourceType') return object.types.includes(condition.type)
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
    return activeOpponents(state, object.controller).length <= condition.max
  }
  if (condition.kind === 'opponentHasMore') {
    const you = object.controller
    const opponents = activeOpponents(state, you)
    if (condition.stat === 'lands') {
      const yours = controlledLandList(state, you).length
      return opponents.some((seat) => controlledLandList(state, seat).length > yours)
    }
    if (condition.stat === 'life') {
      const yours = state.players[you].life
      return opponents.some((seat) => state.players[seat].life > yours)
    }
    if (condition.stat === 'creatures') {
      const yours = controlledCreatureCount(state, you)
      return opponents.some((seat) => controlledCreatureCount(state, seat) > yours)
    }
    if (condition.stat === 'cardsInHand') {
      const yours = state.zoneOrder[you]?.hand.length ?? 0
      return opponents.some((seat) => (state.zoneOrder[seat]?.hand.length ?? 0) > yours)
    }
    return false
  }
  if (condition.kind === 'opponentLostLifeThisTurn') {
    return state.playerOrder.some((seat) =>
      seat !== object.controller
      && lifeLostThisTurn(state.players[seat]) >= condition.min)
  }
  if (condition.kind === 'opponentDealtCombatDamageByLegendaryThisTurn') {
    const scope = condition.controller ?? 'any'
    const you = object.controller
    return state.playerOrder.some((seat) => {
      if (seat === you || state.players[seat].lost) return false
      const from = legendaryCombatDamageFrom(state.players[seat])
      if (scope === 'you') return Boolean(from[you])
      return Object.keys(from).length > 0
    })
  }
  if (condition.kind === 'controllerIsActive') return state.active === object.controller
  if (condition.kind === 'castOption') return object.enteredWithCastOption === condition.id
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
  if (condition.kind === 'notMonstrous') return !object.monstrous
  if (condition.kind === 'wasCreature') return object.types.includes('Creature')
  if (condition.kind === 'lacksCounter') return (object.counters[condition.counter] ?? 0) === 0
  if (condition.kind === 'stackXAtLeast') return (stackItem?.x ?? 0) >= condition.min
  if (condition.kind === 'controlsCommander') {
    return Object.values(state.objects).some((candidate) =>
      candidate.zone === 'battlefield'
      && candidate.tags.includes('commander')
      && candidate.owner === object.controller
      && candidate.controller === object.controller)
  }
  if (condition.kind === 'triggeringCreatureNameUnique') {
    if (!triggering) return false
    const name = frontFaceName(triggering)
    // The triggering creature may itself sit in the graveyard by resolution; as a
    // creature card there it still has its own name.
    return !Object.values(state.objects).some((candidate) =>
      frontFaceName(candidate) === name
      && candidate.types.includes('Creature')
      && (
        (candidate.zone === 'battlefield'
          && !candidate.phasedOut
          && candidate.controller === object.controller
          && candidate.id !== triggering.id)
        || (candidate.zone === 'graveyard'
          && candidate.owner === object.controller
          && !candidate.token)
      ))
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

const abilityCopiesAsEntry = (ability: {
  kind?: string
  instructions?: readonly { kind?: string; effect?: { kind?: string } }[]
}) =>
  ability.kind === 'activated'
  && (ability.instructions ?? []).some(instruction =>
    instruction.kind === 'createEffect' && instruction.effect?.kind === 'copy')

const replacementCopiesAsEntry = (effect: {
  kind?: string
  transform?: { kind?: string; changes?: { copyOf?: unknown } }
  program?: readonly {
    kind?: string
    changes?: { copyOf?: unknown }
    then?: readonly unknown[]
    otherwise?: readonly unknown[]
  }[]
}): boolean => {
  if (effect.kind !== 'replacement') return false
  if (effect.transform?.kind === 'modifyEvent' && effect.transform.changes?.copyOf) return true
  const scan = (steps: typeof effect.program): boolean =>
    (steps ?? []).some(step => {
      if (step.kind === 'modifyEvent' && step.changes?.copyOf) return true
      if (step.kind === 'branch') {
        return scan(step.then as typeof effect.program) || scan(step.otherwise as typeof effect.program)
      }
      return false
    })
  return scan(effect.program)
}

const abilityIsCopyAsEntryReplacement = (ability: {
  kind?: string
  effects?: readonly Parameters<typeof replacementCopiesAsEntry>[0][]
}) =>
  ability.kind === 'static'
  && (ability.effects ?? []).some(replacementCopiesAsEntry)

export function applyCopy (
  object: GameObject,
  copied: GameObject,
  extra: {
    notLegendary?: boolean
    plusCounters?: number
    keepName?: boolean
    keepAbility?: boolean
    keepAbilities?: boolean
    flying?: boolean
    keywords?: readonly string[]
    colors?: ColorSet
    extraTypes?: readonly string[]
    extraSubtypes?: readonly string[]
    noManaCost?: boolean
    tapped?: boolean
  } = {},
) {
  const characteristics = copyCharacteristics(copied, extra)
  const keptDefinition = extra.keepAbilities || extra.keepAbility ? object.ruleDefinition : undefined
  if (!extra.keepName && object.name !== copied.name) {
    // The table still needs to read the card underneath: a clone is answered
    // differently once you know it is a Spark Double wearing someone's face.
    object.printedName = object.printedName ?? object.name
    object.name = characteristics.name
  }
  object.types = characteristics.types
  object.subtypes = characteristics.subtypes
  object.supertypes = characteristics.supertypes
  object.manaCost = characteristics.manaCost
  object.manaValue = characteristics.manaValue
  object.colors = characteristics.colors
  reapplyColorChanges(object)
  object.power = characteristics.power
  object.toughness = characteristics.toughness
  object.printedLoyalty = characteristics.printedLoyalty
  object.oracleText = characteristics.oracleText
  object.grantedRules = characteristics.grantedRules
  object.tapProduces = characteristics.tapProduces
  object.effects = []
  if ('ruleDefinition' in characteristics && characteristics.ruleDefinition) {
    object.ruleDefinition = structuredClone(characteristics.ruleDefinition)
  } else {
    delete object.ruleDefinition
  }
  if (keptDefinition) {
    const keptAbilities = extra.keepAbilities
      ? keptDefinition.definition.abilities.filter(ability => !abilityIsCopyAsEntryReplacement(ability))
      : keptDefinition.definition.abilities.filter(abilityCopiesAsEntry)
    if (keptAbilities.length > 0) {
      const current = object.ruleDefinition
      const definition = card([
        ...(current?.definition.abilities ?? []),
        ...keptAbilities,
      ])
      object.ruleDefinition = deepFreezeData(cloneJsonData({
        schemaVersion: RULE_DSL_SCHEMA_VERSION,
        definitionRevision: definition.definitionRevision,
        definition,
      }))
    }
  }
  if (extra.plusCounters && extra.plusCounters > 0) addPlusCounters(object, extra.plusCounters)
}

export const activateEffect = (effects: CardEffect[], abilityId: string) =>
  effects.find((effect): effect is Extract<CardEffect, { op: 'activate' }> =>
    effect.op === 'activate' && effect.id === abilityId)

export const searchEffect = (effects: CardEffect[]) =>
  effects.find((effect): effect is Extract<CardEffect, { op: 'search' }> => effect.op === 'search')

/** Game state is structuredClone'd; drop function matchers from explicit effects. */
export const serializableEffects = (effects: CardEffect[]): CardEffect[] =>
  JSON.parse(JSON.stringify(effects, (_key, value) =>
    typeof value === 'function' ? undefined : value)) as CardEffect[]

export const triggerEffects = (
  effects: CardEffect[],
  on: Extract<CardEffect, { op: 'trigger' }>['on'],
) =>
  effects.filter((effect): effect is Extract<CardEffect, { op: 'trigger' }> =>
    effect.op === 'trigger' && effect.on === on)
