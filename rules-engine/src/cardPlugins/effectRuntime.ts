import { gameObjectFieldDefaults, isPermanentType } from '../definitions'
import type Draft from '../draft'
import { hasKeyword } from '../keywords'
import { lifeLostThisTurn } from '../plugins/life'
import type {
  GameObject,
  GameState,
  PlayerId,
  StackItem,
} from '../types'
import type { CardCondition, CardEffect, CardInstruction } from './effectDefinitions'

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

export const copyCharacteristics = (
  copied: GameObject,
  extra: { notLegendary?: boolean; flying?: boolean } = {},
) => ({
  name: copied.name,
  types: [...copied.types],
  subtypes: [...copied.subtypes],
  supertypes: extra.notLegendary
    ? copied.supertypes.filter((entry) => entry !== 'Legendary')
    : [...copied.supertypes],
  manaCost: copied.manaCost,
  manaValue: manaValueOf(copied),
  colors: [...copied.colors],
  power: copied.power,
  toughness: copied.toughness,
  printedLoyalty: copied.printedLoyalty,
  oracleText: extra.flying && !hasKeyword(copied, 'flying')
    ? copied.oracleText
      ? `${copied.oracleText}\nFlying`
      : 'Flying'
    : copied.oracleText,
  grantedRules: [...copied.grantedRules],
  tapProduces: copied.tapProduces ? { ...copied.tapProduces } : undefined,
  effects: copied.effects ? [...copied.effects] : [],
})

export const copyStackSpell = (
  draft: Draft,
  originalObject: GameObject,
  originalStackItem: StackItem,
  controller: PlayerId,
) => {
  const objectId = draft.allocId('obj')
  const copiedObject: GameObject = {
    ...originalObject,
    ...copyCharacteristics(originalObject),
    id: objectId,
    owner: controller,
    controller,
    zone: 'stack',
    token: false,
    tapped: false,
    summoningSickness: false,
    damageMarked: 0,
    counters: {},
    attachedTo: null,
    attacking: null,
    blocking: null,
    tags: [...originalObject.tags],
  }
  draft.objects[objectId] = copiedObject
  const stackZone = draft.zoneOrder[controller]?.stack
  if (stackZone) {
    stackZone.push(objectId)
    draft.zoneCounts[controller].stack += 1
  }
  const copiedItem: StackItem = {
    ...originalStackItem,
    id: draft.allocId('s'),
    objectId,
    controller,
    name: copiedObject.name,
    targets: [...originalStackItem.targets],
    ...(originalStackItem.choices ? { choices: [...originalStackItem.choices] } : {}),
  }
  draft.stack.unshift(copiedItem)
  return copiedItem
}

export const copyTokenTemplate = (
  card: GameObject,
  extra: {
    notLegendary?: boolean
    flying?: boolean
    tapped?: boolean
  } = {},
): Partial<GameObject> & { name: string } => ({
  ...copyCharacteristics(card, extra),
  // Leaving `tapped` out keeps createToken's untapped default instead of undefined.
  ...(extra.tapped ? { tapped: true } : {}),
  summoningSickness: card.types.includes('Creature'),
  counters: card.printedLoyalty === null ? {} : { loyalty: card.printedLoyalty },
  tags: [],
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
  const characteristics = copyCharacteristics(copied, extra)
  const keptStatic = extra.keepName
    ? (object.effects ?? []).filter((effect) => effect.op === 'static')
    : []
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
  object.power = characteristics.power
  object.toughness = characteristics.toughness
  object.printedLoyalty = characteristics.printedLoyalty
  object.oracleText = characteristics.oracleText
  object.grantedRules = characteristics.grantedRules
  object.tapProduces = characteristics.tapProduces
  object.effects = characteristics.effects
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
  'chooseCreatureType',
  'returnCreatureManaValueX',
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
      if (effect.action === 'copy') ids.add('stackCopy')
    }
    if (effect.op === 'static' && effect.extraLandPlays) ids.add('additionalLandPlay')
    if (effect.op === 'static' && (effect.attackTax || effect.blockTax)) {
      ids.add('combatTax')
    }
    if (effect.op === 'static' && (effect.revealLibraryTop || effect.playLandsFromLibraryTop)) {
      ids.add('courserOfKruphix')
    }
    if (effect.op === 'bestow') ids.add('bestow')
    if (effect.op === 'castCost') ids.add('castCosts')
    if (effect.op === 'alternateCast') ids.add('alternateCosts')
    if (effect.op === 'handler') ids.add(effect.pluginId)
    if (effect.op === 'vote') ids.add('vote')
    if (effect.op === 'targetingRequirement') ids.add('targetingRequirements')
    if (effect.op === 'playerAuraDeal') ids.add('attackDeal')
    const listed = effect.op === 'trigger' || effect.op === 'activate' || effect.op === 'modal'
      ? flattenInstructions(
        effect.op === 'modal'
          ? effect.modes.flatMap((mode) => mode.do)
          : effect.do,
      )
      : []
    if (hasKind(listed, 'chooseModes')) ids.add('modalSpell')
    if (hasKind(listed, 'cumulativeUpkeepOpponentLife')) ids.add('cumulativeUpkeep')
    if (listed.some((instruction) => CHOICE_KINDS.has(instruction.kind))) {
      ids.add('choiceEffects')
      if (hasKind(listed, 'putFromHand')) ids.add('dumpFromHand')
      if (hasKind(listed, 'secretCouncil', 'chooseVotesThisTurn')) ids.add('secretCouncil')
      if (hasKind(listed, 'fight', 'fightUpToOne', 'fightOwnedVsOpponent')) ids.add('fight')
      if (hasKind(listed, 'searchLibrary')) ids.add('librarySearch')
      if (hasKind(listed, 'exchangeControlUntilEot')) ids.add('reinsOfPower')
    }
    if (hasKind(listed, 'randomExileCopyWhile')) ids.add('randomExileCopy')
    if (hasKind(listed, 'attachedCopyOrToken')) ids.add('bestow')
    if (hasKind(listed, 'chooseCreatureType')) ids.add('creatureTypeChoice')
    if (listed.some((instruction) =>
      instruction.kind === 'createToken' && instruction.token.sacrificeForMana)) {
      ids.add('activated')
    }
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
