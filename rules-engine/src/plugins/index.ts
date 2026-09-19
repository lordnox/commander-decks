import { pendingDialogLock } from '../pendingDialog'
import { abilities } from './activateAbility'
import { combat } from './combat'
import { commander } from './commander'
import { damage } from './damage'
import { doubleFaced } from './doubleFaced'
import { extraSwampMana } from './extraSwampMana'
import { extraUntap } from './extraUntap'
import { fog } from './fog'
import { forestOverlay } from './forestOverlay'
import {
  replicaHiddenInformation,
  unconfiguredHiddenInformation,
} from './hiddenInformation'
import { judgeFallback } from './judgeFallback'
import { lands } from './lands'
import { life } from './life'
import { mana } from './mana'
import { manaBurn } from './manaBurn'
import { swampOverlay } from './swampOverlay'
import { priority } from './priority'
import { sacrificeLandMana } from './sacrificeLandMana'
import { spells } from './spells'
import { stateBased } from './stateBased'
import { temporaryStats } from './temporaryStats'
import { discard, draw, selectCards, selectPlayers, triggers } from '../rules/main'
import { turnStructure } from './turnStructure'

/** Available implementations. A GameFormat decides which become live rules. */
export const builtInPlugins = [
  turnStructure,
  priority,
  abilities,
  mana,
  lands,
  spells,
  stateBased,
  combat,
  life,
  damage,
  doubleFaced,
  temporaryStats,
  discard,
  draw,
  selectCards,
  selectPlayers,
  triggers,
  judgeFallback,
  unconfiguredHiddenInformation,
  pendingDialogLock,
  commander,
  manaBurn,
  fog,
  forestOverlay,
  swampOverlay,
  extraSwampMana,
  extraUntap,
  sacrificeLandMana,
  replicaHiddenInformation,
  unconfiguredHiddenInformation,
]

export {
  abilities,
  combat,
  commander,
  damage,
  doubleFaced,
  extraSwampMana,
  extraUntap,
  fog,
  forestOverlay,
  judgeFallback,
  lands,
  life,
  mana,
  manaBurn,
  swampOverlay,
  pendingDialogLock,
  priority,
  sacrificeLandMana,
  spells,
  stateBased,
  temporaryStats,
  turnStructure,
}
