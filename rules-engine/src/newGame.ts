import { cardPlugins, grantedRulesFor } from './cardPlugins'
import { effectsFor } from './cardPlugins/cardRules'
import { serializableEffects } from './cardPlugins/effects'
import { emptyMana } from './draft'
import type { GameFormat } from './formats'
import {
  type GameObject,
  type GameState,
  type PlayerId,
  type PlayerState,
  type RuleInstance,
  type ZoneId,
} from './types'

export type CardTemplate = Omit<GameObject, 'id' | 'owner' | 'controller' | 'zone'> & {
  zone?: GameObject['zone']
}

const defaultObject = (): Omit<GameObject, 'id' | 'owner' | 'controller' | 'zone'> => ({
  name: 'Unknown',
  tapped: false,
  summoningSickness: false,
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
  token: false,
  tags: [],
})

/** One place that knows every GameObject field, so callers name only what matters. */
export const cardTemplate = (
  name: string,
  overrides: Partial<CardTemplate> = {},
): CardTemplate => {
  const types = overrides.types ?? []
  const creatureStats = types.includes('Creature')
    ? { power: 1, toughness: 1 }
    : {}
  return { ...defaultObject(), name, ...creatureStats, ...overrides }
}

const player = (format: GameFormat, id: PlayerId): PlayerState => ({
  id,
  life: format.startingLife,
  poison: 0,
  mana: emptyMana(),
  lost: false,
  landsPlayed: 0,
  landPlaysAllowed: 1,
  data: format.createPlayerData?.(id) ?? {},
})

export type NewGameOptions = {
  players?: number | PlayerId[]
  first?: PlayerId
  libraries?: Partial<Record<PlayerId, CardTemplate[]>>
  hands?: Partial<Record<PlayerId, CardTemplate[]>>
  battlefield?: Partial<Record<PlayerId, CardTemplate[]>>
  command?: Partial<Record<PlayerId, CardTemplate[]>>
  builtinRules?: string[]
}

const playerIds = (format: GameFormat, players?: number | PlayerId[]) => {
  const ids = Array.isArray(players)
    ? players
    : Array.from({ length: players ?? format.defaultPlayers }, (_, index) => `p${index + 1}`)
  if (new Set(ids).size !== ids.length) throw new Error('player ids must be unique')
  if (ids.length < (format.minPlayers ?? 1)) {
    throw new Error(`${format.name} requires at least ${format.minPlayers ?? 1} players`)
  }
  if (format.maxPlayers && ids.length > format.maxPlayers) {
    throw new Error(`${format.name} supports at most ${format.maxPlayers} players`)
  }
  return ids
}

const emptyZones = (): Record<ZoneId, string[]> => ({
  battlefield: [],
  stack: [],
  hand: [],
  library: [],
  graveyard: [],
  exile: [],
  command: [],
})

const emptyZoneCounts = (): Record<ZoneId, number> => ({
  battlefield: 0,
  stack: 0,
  hand: 0,
  library: 0,
  graveyard: 0,
  exile: 0,
  command: 0,
})

export const newGame = (format: GameFormat, opts?: NewGameOptions): GameState => {
  const players = playerIds(format, opts?.players)
  const first = opts?.first ?? players[0]
  if (!players.includes(first)) throw new Error(`first player ${first} is not in the game`)
  const objects: GameState['objects'] = {}
  const zoneOrder = Object.fromEntries(
    players.map((playerId) => [playerId, emptyZones()]),
  ) as GameState['zoneOrder']
  const zoneCounts = Object.fromEntries(
    players.map((playerId) => [playerId, emptyZoneCounts()]),
  ) as GameState['zoneCounts']
  let nextId = 1
  const put = (playerId: PlayerId, zone: GameObject['zone'], template: CardTemplate) => {
    const id = `o${nextId}`
    nextId += 1
    objects[id] = {
      ...defaultObject(),
      ...template,
      id,
      owner: playerId,
      controller: playerId,
      zone: template.zone ?? zone,
      grantedRules: [...new Set([
        ...defaultObject().grantedRules,
        ...(template.grantedRules ?? []),
        ...grantedRulesFor(template.name),
      ])],
      effects: serializableEffects(template.effects ?? effectsFor(template.name)),
      tags: [...new Set([...template.tags, ...(format.tagsForZone?.(zone) ?? [])])],
    }
    if (
      objects[id].zone === 'battlefield'
      && objects[id].types.includes('Planeswalker')
      && objects[id].counters.loyalty === undefined
      && objects[id].printedLoyalty !== null
    ) {
      objects[id].counters.loyalty = objects[id].printedLoyalty
    }
    const actualZone = objects[id].zone
    zoneOrder[playerId][actualZone].push(id)
    zoneCounts[playerId][actualZone] += 1
    return id
  }
  for (const playerId of players) {
    for (const card of opts?.libraries?.[playerId] ?? []) put(playerId, 'library', card)
    for (const card of opts?.hands?.[playerId] ?? []) put(playerId, 'hand', card)
    for (const card of opts?.battlefield?.[playerId] ?? []) put(playerId, 'battlefield', card)
    for (const card of opts?.command?.[playerId] ?? []) {
      put(playerId, 'command', card)
    }
  }
  const builtin = opts?.builtinRules ?? [
    ...format.rules,
    ...cardPlugins.map((plugin) => plugin.id),
  ]
  const rules: RuleInstance[] = builtin.map((pluginId, index) => ({
    instanceId: `builtin-${pluginId}`,
    pluginId,
    sourceId: null,
    timestamp: index,
    params: {},
  }))
  let nextTimestamp = builtin.length
  for (const object of Object.values(objects)) {
    if (object.zone !== 'battlefield') continue
    for (const pluginId of object.grantedRules) {
      rules.push({
        instanceId: `o${nextId}-rule`,
        pluginId,
        sourceId: object.id,
        timestamp: nextTimestamp,
        params: {},
      })
      nextId += 1
      nextTimestamp += 1
    }
  }
  return {
    format: format.id,
    knowledge: { mode: 'authoritative', viewer: null },
    playerOrder: players,
    castableZones: format.castableZones ?? ['hand'],
    players: Object.fromEntries(
      players.map((playerId) => [playerId, player(format, playerId)]),
    ),
    objects,
    zoneOrder,
    zoneCounts,
    stack: [],
    active: first,
    priority: first,
    turn: 1,
    step: 'precombatMain',
    passedInRow: [],
    rules,
    nextId,
    nextTimestamp,
    ended: false,
    log: [],
  }
}

export const forest = (): CardTemplate => cardTemplate('Forest', {
  types: ['Land'],
  subtypes: ['Forest'],
  supertypes: ['Basic'],
  tapProduces: { G: 1 },
  oracleText: '{T}: Add {G}.',
})

export const bears = (): CardTemplate => cardTemplate('Grizzly Bears', {
  types: ['Creature'],
  subtypes: ['Bear'],
  manaCost: '{1}{G}',
  power: 2,
  toughness: 2,
})

export const planeswalker = (
  name = 'Test Planeswalker',
  loyalty = 3,
  overrides: Partial<CardTemplate> = {},
): CardTemplate => cardTemplate(name, {
  types: ['Planeswalker'],
  printedLoyalty: loyalty,
  oracleText: `Loyalty ${loyalty}`,
  ...overrides,
})

/** Oracle Yurlok: mana burn on emptying pools, plus {1}, {T} rain. */
export const yurlokFixture = (): CardTemplate => cardTemplate('Yurlok of Scorch Thrash', {
  types: ['Creature'],
  subtypes: ['Lizard', 'Shaman'],
  supertypes: ['Legendary'],
  manaCost: '{1}{B}{R}{G}',
  power: 4,
  toughness: 4,
  oracleText:
    'Vigilance\nA player losing unspent mana causes that player to lose that much life.\n{1}, {T}: Each player adds {B}{R}{G}.',
})

/** Fixture: shuffles each player's graveyard and hand into their library. Omits the draw-seven. */
export const timetwister = (): CardTemplate => cardTemplate('Timetwister', {
  types: ['Sorcery'],
  manaCost: '{2}{U}',
  oracleText:
    'Fixture: each player shuffles their hand and graveyard into their library (no draw).',
})

export const bolt = (): CardTemplate => cardTemplate('Lightning Bolt', {
  types: ['Instant'],
  manaCost: '{R}',
  oracleText: 'Lightning Bolt deals 3 damage to any target.',
})

/** Fixture: entering installs manaBurn; leaving removes it. Not Oracle Yarok. */
export const yarokFixture = (): CardTemplate => cardTemplate('Yarok, the Desecrated', {
  types: ['Creature'],
  subtypes: ['Elemental', 'Horror'],
  supertypes: ['Legendary'],
  manaCost: '{2}{B}{G}{U}',
  power: 3,
  toughness: 5,
  grantedRules: ['manaBurn'],
  oracleText: 'Fixture: while on the battlefield, leftover mana burns.',
})
