import type Draft from '../draft'
import type { GameObject, GameState, ManaPool, PlayerId } from '../types'

export type CardCondition =
  | { kind: 'otherLands'; min?: number; max?: number; subtype?: string }
  | { kind: 'controlledLands'; min?: number; max?: number }
  | { kind: 'uniqueLandNames'; min: number }
  | { kind: 'notActivePlayer' }

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
  | { kind: 'extraLandPlays'; count: number }
  | { kind: 'returnOwnedGraveyardLands'; tapped?: boolean }
  | { kind: 'createToken'; token: TokenSpec }
  | { kind: 'copySelf' }
  | { kind: 'doublePlusCounters' }
  | { kind: 'if'; if: CardCondition; whenTrue: CardInstruction[]; whenFalse?: CardInstruction[] }

export type ActivateCost = {
  tap?: boolean
  mana?: string
  mill?: number
  life?: number
  sacrifice?: 'self'
}

export type SearchDestination = 'hand' | 'battlefield' | 'graveyard'

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
  validateSelection?: (objects: GameObject[]) => string | void
  untapWithFourLands?: boolean
}

export type CardEffect =
  | { op: 'replacement'; on: 'enters'; do: 'tapSelf'; if?: CardCondition }
  | {
      op: 'trigger'
      on: 'enters' | 'leaves' | 'dies' | 'landfall' | 'attacks' | 'resolve'
      do: CardInstruction[]
      if?: CardCondition
    }
  | {
      op: 'activate'
      id: string
      manaAbility?: boolean
      costs: ActivateCost
      if?: CardCondition
      do: CardInstruction[]
    }
  | { op: 'search'; via: 'spell'; spec: SearchSpec }
  | { op: 'search'; via: 'ability'; spec: SearchSpec; costs: ActivateCost }
  | { op: 'static'; pluginId?: string; extraLandPlays?: number }
  | { op: 'handler'; pluginId: string }

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

export const extraLandPlays = (count: number): CardInstruction => ({
  kind: 'extraLandPlays',
  count,
})

export const draw = (count: number): CardInstruction => ({ kind: 'draw', count })

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
  power: null,
  toughness: null,
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

export const runInstructions = (
  draft: Draft,
  source: GameObject,
  instructions: CardInstruction[],
) => {
  for (const instruction of instructions) {
    if (instruction.kind === 'if') {
      const live = draft.object(source.id) ?? source
      const chosen = conditionHolds(instruction.if, draft, live)
        ? instruction.whenTrue
        : instruction.whenFalse ?? []
      runInstructions(draft, source, chosen)
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
  }
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
    if (effect.op === 'trigger' && (effect.on === 'enters' || effect.on === 'dies' || effect.on === 'leaves')) {
      ids.add('zoneTriggers')
    }
    if (effect.op === 'trigger' && effect.on === 'landfall') ids.add('landfall')
    if (effect.op === 'trigger' && effect.on === 'resolve') ids.add('onResolve')
    if (effect.op === 'activate') ids.add('activated')
    if (effect.op === 'search') ids.add('librarySearch')
    if (effect.op === 'static' && effect.extraLandPlays) ids.add('additionalLandPlay')
    if (effect.op === 'handler') ids.add(effect.pluginId)
  }
  return [...ids]
}

export const pluginIdsFromEffects = (effects: CardEffect[]) =>
  effects.flatMap((effect) =>
    effect.op === 'static' && effect.pluginId ? [effect.pluginId] : [])
