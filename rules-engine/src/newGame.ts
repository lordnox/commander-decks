import { emptyMana } from './draft'
import type { GameFormat } from './formats'
import {
  type GameObject,
  type GameState,
  type PlayerId,
  type PlayerState,
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
  power: null,
  toughness: null,
  oracleText: '',
  attachedTo: null,
  attacking: null,
  blocking: null,
  grantedRules: [],
  token: false,
  tags: [],
})

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
      tags: [...new Set([...template.tags, ...(format.tagsForZone?.(zone) ?? [])])],
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
  const builtin = opts?.builtinRules ?? format.rules
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
    rules: builtin.map((pluginId, index) => ({
      instanceId: `builtin-${pluginId}`,
      pluginId,
      sourceId: null,
      timestamp: index,
      params: {},
    })),
    nextId,
    nextTimestamp: builtin.length,
    ended: false,
    log: [],
  }
}

export const forest = (): CardTemplate => ({
  name: 'Forest',
  types: ['Land'],
  subtypes: ['Forest'],
  tapProduces: { G: 1 },
  grantedRules: [],
  tapped: false,
  summoningSickness: false,
  damageMarked: 0,
  counters: {},
  supertypes: ['Basic'],
  manaCost: '',
  power: null,
  toughness: null,
  oracleText: '{T}: Add {G}.',
  attachedTo: null,
  attacking: null,
  blocking: null,
  token: false,
  tags: [],
})

export const bears = (): CardTemplate => ({
  name: 'Grizzly Bears',
  types: ['Creature'],
  subtypes: ['Bear'],
  manaCost: '{1}{G}',
  power: 2,
  toughness: 2,
  grantedRules: [],
  tapped: false,
  summoningSickness: false,
  damageMarked: 0,
  counters: {},
  supertypes: [],
  oracleText: '',
  attachedTo: null,
  attacking: null,
  blocking: null,
  token: false,
  tags: [],
})

export const bolt = (): CardTemplate => ({
  name: 'Lightning Bolt',
  types: ['Instant'],
  manaCost: '{R}',
  power: null,
  toughness: null,
  grantedRules: [],
  tapped: false,
  summoningSickness: false,
  damageMarked: 0,
  counters: {},
  supertypes: [],
  subtypes: [],
  oracleText: 'Lightning Bolt deals 3 damage to any target.',
  attachedTo: null,
  attacking: null,
  blocking: null,
  token: false,
  tags: [],
})

/** Fixture: entering installs manaBurn; leaving removes it. Not Oracle Yarok. */
export const yarokFixture = (): CardTemplate => ({
  name: 'Yarok, the Desecrated',
  types: ['Creature'],
  subtypes: ['Elemental', 'Horror'],
  manaCost: '{2}{B}{G}{U}',
  power: 3,
  toughness: 5,
  grantedRules: ['manaBurn'],
  tapped: false,
  summoningSickness: false,
  damageMarked: 0,
  counters: {},
  supertypes: ['Legendary'],
  oracleText: 'Fixture: while on the battlefield, leftover mana burns.',
  attachedTo: null,
  attacking: null,
  blocking: null,
  token: false,
  tags: [],
})
