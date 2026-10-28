import { preparedCasting } from '../cardPlugins/dsl/preparedCasting'
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
import { attackSubtypeDraw } from './attackSubtypeDraw'
import { flashGrant } from './flashGrant'
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
import { playerEffects } from './playerEffects'
import { phasing } from './phasing'
import { protectionFromEverything } from './protectionFromEverything'
import { untilNextTurn } from './untilNextTurn'
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
import { demonstrate } from '../cardPlugins/demonstrate'
import { stackCopy } from '../cardPlugins/stackCopy'
import { saga } from './saga'
import { spells } from './spells'
import { rooms } from './rooms'
import { grantCreatureTrigger } from '../cardPlugins/grantCreatureTrigger'
import { dslStaticModifiers } from '../cardPlugins/dsl/staticModifiers'
import { starfieldOfNyx } from './starfieldOfNyx'
import { stateBased } from './stateBased'
import { discard, draw, instructionResume, selectCards, selectOptions, selectPlayers, triggers } from '../rules/main'
import { vote } from '../cardPlugins/vote'
import { canonicalRandom } from '../cardPlugins/dsl/canonicalRandom'
import { turnStructure } from './turnStructure'
import { warp } from './warp'
import { activated as canonicalActivated } from '../cardPlugins/activated'
import { alternateCosts } from '../cardPlugins/alternateCosts'

/** Available implementations. A GameFormat decides which become live rules. */
export const builtInPlugins = [
  turnStructure,
  untilNextTurn,
  phasing,
  protectionFromEverything,
  lifeTotalLock,
  playerEffects,
  recurringSpells,
  advancedCombatPrevention,
  continuousEffects,
  dslStaticModifiers,
  priority,
  abilities,
  canonicalActivated,
  mana,
  lands,
  spells,
  adventure,
  foretell,
  preparedCasting,
  rebound,
  demonstrate,
  stackCopy,
  warp,
  alternateCosts,
  saga,
  rooms,
  stateBased,
  combat,
  life,
  monarch,
  energy,
  damage,
  battle,
  doubleFaced,
  discard,
  draw,
  selectCards,
  selectOptions,
  selectPlayers,
  triggers,
  instructionResume,
  vote,
  canonicalRandom,
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
  grantCreatureTrigger,
  attackSubtypeDraw,
  sacrificeLandMana,
  flashGrant,
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
  flashGrant,
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
  preparedCasting,
  rebound,
  demonstrate,
  stackCopy,
  warp,
  rooms,
  sacrificeLandMana,
  saga,
  spells,
  starfieldOfNyx,
  stateBased,
  turnStructure,
}
