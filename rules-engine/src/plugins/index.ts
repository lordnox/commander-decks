import { pendingDialogLock } from '../pendingDialog'
import { continuousEffects } from '../cardPlugins/continuousEffects'
import { abilities } from './activateAbility'
import { advancedCombatPrevention } from './advancedCombatPrevention'
import { battle } from './battle'
import { combat } from './combat'
import { commander } from './commander'
import { damage } from './damage'
import { adventure } from './adventure'
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
import { energy } from './energy'
import { life } from './life'
import { lifeTotalLock } from './lifeTotalLock'
import { phasing } from './phasing'
import { protectionFromEverything } from './protectionFromEverything'
import { untilNextTurn } from './untilNextTurn'
import { cdaLifePt } from './cdaLifePt'
import { mana } from './mana'
import { monarch } from './monarch'
import { manaBurn } from './manaBurn'
import { recurringSpells } from './recurringSpells'
import { swampOverlay } from './swampOverlay'
import { priority } from './priority'
import { phialReplacement } from './phialReplacement'
import { sacrificeLandMana } from './sacrificeLandMana'
import { foretell } from './foretell'
import { rebound } from './rebound'
import { saga } from './saga'
import { spells } from './spells'
import { rooms } from './rooms'
import { grantControlledSubtypeTrigger } from '../cardPlugins/grantControlledSubtypeTrigger'
import { exilePayoffs } from '../cardPlugins/exilePayoffs'
import { starfieldOfNyx } from './starfieldOfNyx'
import { stateBased } from './stateBased'
import { discard, draw, selectCards, selectPlayers, triggers } from '../rules/main'
import { turnStructure } from './turnStructure'
import { warp } from './warp'

/** Available implementations. A GameFormat decides which become live rules. */
export const builtInPlugins = [
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
  starfieldOfNyx,
  grantControlledSubtypeTrigger,
  exilePayoffs,
  extraUntap,
  sacrificeLandMana,
  phialReplacement,
  replicaHiddenInformation,
  unconfiguredHiddenInformation,
]

export {
  advancedCombatPrevention,
  abilities,
  battle,
  combat,
  commander,
  continuousEffects,
  damage,
  adventure,
  doubleFaced,
  extraSwampMana,
  extraUntap,
  fog,
  forestOverlay,
  judgeFallback,
  lands,
  life,
  monarch,
  energy,
  mana,
  manaBurn,
  recurringSpells,
  swampOverlay,
  pendingDialogLock,
  phialReplacement,
  priority,
  foretell,
  rebound,
  warp,
  rooms,
  sacrificeLandMana,
  saga,
  spells,
  starfieldOfNyx,
  stateBased,
  turnStructure,
}
