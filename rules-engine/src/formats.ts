import { combat } from './plugins/combat'
import { commander } from './plugins/commander'
import { damage } from './plugins/damage'
import { fog } from './plugins/fog'
import { unconfiguredHiddenInformation } from './plugins/hiddenInformation'
import { lands } from './plugins/lands'
import { mana } from './plugins/mana'
import { manaBurn } from './plugins/manaBurn'
import { priority } from './plugins/priority'
import { spells } from './plugins/spells'
import { stateBased } from './plugins/stateBased'
import { turnStructure } from './plugins/turnStructure'
import type { PlayerId, Plugin, ZoneId } from './types'

export type GameFormat = {
  id: string
  name: string
  defaultPlayers: number
  minPlayers?: number
  maxPlayers?: number
  startingLife: number
  plugins: Plugin[]
  rules: string[]
  castableZones?: ZoneId[]
  tagsForZone?: (zone: ZoneId) => string[]
  deck: {
    cardPool: string
    minimumSize: number
    maximumCopies: number | null
    sideboardSize: number
    singleton?: boolean
    commander?: boolean
  }
  createPlayerData?: (player: PlayerId) => Record<string, unknown>
}

export const corePlugins = [
  turnStructure,
  priority,
  mana,
  lands,
  spells,
  stateBased,
  combat,
  damage,
  unconfiguredHiddenInformation,
]

export const optionalPlugins = [manaBurn, fog]

export const coreRules: GameFormat = {
  id: 'magic',
  name: 'Magic',
  defaultPlayers: 2,
  minPlayers: 2,
  startingLife: 20,
  plugins: [...corePlugins, ...optionalPlugins],
  rules: corePlugins.map((plugin) => plugin.id),
  castableZones: ['hand'],
  deck: {
    cardPool: 'any',
    minimumSize: 60,
    maximumCopies: 4,
    sideboardSize: 15,
  },
}

export const standardRules: GameFormat = {
  ...coreRules,
  id: 'standard',
  name: 'Standard',
  deck: { ...coreRules.deck, cardPool: 'standard' },
}

export const modernRules: GameFormat = {
  ...coreRules,
  id: 'modern',
  name: 'Modern',
  deck: { ...coreRules.deck, cardPool: 'modern' },
}

export const commanderRules: GameFormat = {
  ...coreRules,
  id: 'commander',
  name: 'Commander',
  defaultPlayers: 4,
  startingLife: 40,
  plugins: [...corePlugins, commander, ...optionalPlugins],
  rules: [...coreRules.rules, commander.id],
  castableZones: ['hand', 'command'],
  tagsForZone: (zone) => (zone === 'command' ? ['commander'] : []),
  deck: {
    cardPool: 'commander',
    minimumSize: 100,
    maximumCopies: 1,
    sideboardSize: 0,
    singleton: true,
    commander: true,
  },
  createPlayerData: () => ({
    commanderDamage: {},
    commanderTax: {},
  }),
}
