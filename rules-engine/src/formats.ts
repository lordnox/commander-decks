import { pendingDialogLock } from './pendingDialog'
import { continuousEffects } from './cardPlugins/continuousEffects'
import { abilities } from './plugins/activateAbility'
import { advancedCombatPrevention } from './plugins/advancedCombatPrevention'
import { battle } from './plugins/battle'
import { combat } from './plugins/combat'
import { commander } from './plugins/commander'
import { damage } from './plugins/damage'
import { doubleFaced } from './plugins/doubleFaced'
import { extraSwampMana } from './plugins/extraSwampMana'
import { attackSubtypeDraw } from './plugins/attackSubtypeDraw'
import { extraUntap } from './plugins/extraUntap'
import { fog } from './plugins/fog'
import { forestOverlay } from './plugins/forestOverlay'
import { unconfiguredHiddenInformation } from './plugins/hiddenInformation'
import { judgeFallback } from './plugins/judgeFallback'
import { lands } from './plugins/lands'
import { energy } from './plugins/energy'
import { life } from './plugins/life'
import { monarch } from './plugins/monarch'
import { lifeTotalLock } from './plugins/lifeTotalLock'
import { phasing } from './plugins/phasing'
import { protectionFromEverything } from './plugins/protectionFromEverything'
import { untilNextTurn } from './plugins/untilNextTurn'
import { cdaLifePt } from './plugins/cdaLifePt'
import { mana } from './plugins/mana'
import { manaBurn } from './plugins/manaBurn'
import { swampOverlay } from './plugins/swampOverlay'
import { priority } from './plugins/priority'
import { recurringSpells } from './plugins/recurringSpells'
import { phialReplacement } from './plugins/phialReplacement'
import { sacrificeLandMana } from './plugins/sacrificeLandMana'
import { foretell } from './plugins/foretell'
import { rebound } from './plugins/rebound'
import { warp } from './plugins/warp'
import { saga } from './plugins/saga'
import { adventure } from './plugins/adventure'
import { spells } from './plugins/spells'
import { rooms } from './plugins/rooms'
import { grantControlledSubtypeTrigger } from './cardPlugins/grantControlledSubtypeTrigger'
import { exilePayoffs } from './cardPlugins/exilePayoffs'
import { starfieldOfNyx } from './plugins/starfieldOfNyx'
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
  untilNextTurn,
  phasing,
  protectionFromEverything,
  lifeTotalLock,
  recurringSpells,
  advancedCombatPrevention,
  continuousEffects,
  priority,
  abilities,
  mana,
  lands,
  spells,
  adventure,
  foretell,
  rebound,
  warp,
  saga,
  rooms,
  stateBased,
  combat,
  life,
  monarch,
  energy,
  cdaLifePt,
  damage,
  battle,
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
  starfieldOfNyx,
  grantControlledSubtypeTrigger,
  exilePayoffs,
  extraUntap,
  attackSubtypeDraw,
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
