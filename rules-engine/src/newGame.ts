import { emptyMana } from './draft'
import { SEAT_IDS, type GameObject, type GameState, type PlayerState, type SeatId } from './types'

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
  commander: false,
})

const player = (id: SeatId): PlayerState => ({
  id,
  life: 40,
  poison: 0,
  commanderDamage: {},
  commanderTax: 0,
  mana: emptyMana(),
  lost: false,
  landsPlayed: 0,
  landPlaysAllowed: 1,
})

export const newGame = (opts?: {
  first?: SeatId
  libraries?: Partial<Record<SeatId, CardTemplate[]>>
  hands?: Partial<Record<SeatId, CardTemplate[]>>
  battlefield?: Partial<Record<SeatId, CardTemplate[]>>
  command?: Partial<Record<SeatId, CardTemplate[]>>
  builtinRules?: string[]
}): GameState => {
  const first = opts?.first ?? 'p1'
  const objects: GameState['objects'] = {}
  let nextId = 1
  const put = (seat: SeatId, zone: GameObject['zone'], template: CardTemplate) => {
    const id = `o${nextId}`
    nextId += 1
    objects[id] = {
      ...defaultObject(),
      ...template,
      id,
      owner: seat,
      controller: seat,
      zone: template.zone ?? zone,
    }
    return id
  }
  for (const seat of SEAT_IDS) {
    for (const card of opts?.libraries?.[seat] ?? []) put(seat, 'library', card)
    for (const card of opts?.hands?.[seat] ?? []) put(seat, 'hand', card)
    for (const card of opts?.battlefield?.[seat] ?? []) put(seat, 'battlefield', card)
    for (const card of opts?.command?.[seat] ?? []) put(seat, 'command', { ...card, commander: true })
  }
  const builtin = opts?.builtinRules ?? [
    'turnStructure',
    'priority',
    'mana',
    'lands',
    'spells',
    'stateBased',
    'combat',
    'commander',
  ]
  return {
    players: Object.fromEntries(SEAT_IDS.map((seat) => [seat, player(seat)])) as GameState['players'],
    objects,
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
  commander: false,
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
  commander: false,
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
  commander: false,
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
  commander: false,
})
