import { pendingDialogLock } from '../pendingDialog'
import { abilities } from './activateAbility'
import { combat } from './combat'
import { commander } from './commander'
import { damage } from './damage'
import { fog } from './fog'
import {
  replicaHiddenInformation,
  unconfiguredHiddenInformation,
} from './hiddenInformation'
import { judgeFallback } from './judgeFallback'
import { lands } from './lands'
import { mana } from './mana'
import { manaBurn } from './manaBurn'
import { priority } from './priority'
import { spells } from './spells'
import { stateBased } from './stateBased'
import { discard, draw, selectCards, triggers } from '../rules/main'
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
  damage,
  discard,
  draw,
  selectCards,
  triggers,
  judgeFallback,
  unconfiguredHiddenInformation,
  pendingDialogLock,
  commander,
  manaBurn,
  fog,
  replicaHiddenInformation,
  unconfiguredHiddenInformation,
]

export {
  abilities,
  combat,
  commander,
  damage,
  fog,
  judgeFallback,
  lands,
  mana,
  manaBurn,
  pendingDialogLock,
  priority,
  spells,
  stateBased,
  turnStructure,
}
