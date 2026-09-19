import { pendingDialogLock } from './pendingDialog'
import { continuousEffects } from './cardPlugins/continuousEffects'
import { abilities } from './plugins/activateAbility'
import { advancedCombatPrevention } from './plugins/advancedCombatPrevention'
import { combat } from './plugins/combat'
import { commander } from './plugins/commander'
import { damage } from './plugins/damage'
import { doubleFaced } from './plugins/doubleFaced'
import { extraSwampMana } from './plugins/extraSwampMana'
import { extraUntap } from './plugins/extraUntap'
import { fog } from './plugins/fog'
import { forestOverlay } from './plugins/forestOverlay'
import { unconfiguredHiddenInformation } from './plugins/hiddenInformation'
import { judgeFallback } from './plugins/judgeFallback'
import { lands } from './plugins/lands'
import { life } from './plugins/life'
import { mana } from './plugins/mana'
import { manaBurn } from './plugins/manaBurn'
import { swampOverlay } from './plugins/swampOverlay'
import { priority } from './plugins/priority'
import { paradigm } from './plugins/paradigm'
import { phialReplacement } from './plugins/phialReplacement'
import { sacrificeLandMana } from './plugins/sacrificeLandMana'
import { rebound } from './plugins/rebound'
import { spells } from './plugins/spells'
import { stateBased } from './plugins/stateBased'
import { turnStructure } from './plugins/turnStructure'
import { gameRules } from './rules/main'
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
  paradigm,
  advancedCombatPrevention,
  continuousEffects,
  priority,
  abilities,
  mana,
  lands,
  spells,
  rebound,
  stateBased,
  combat,
  life,
  damage,
  doubleFaced,
  ...gameRules,
  judgeFallback,
  unconfiguredHiddenInformation,
  pendingDialogLock,
]

export const optionalPlugins = [
  manaBurn,
  fog,
  forestOverlay,
  swampOverlay,
  extraSwampMana,
  extraUntap,
  sacrificeLandMana,
  phialReplacement,
]

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
