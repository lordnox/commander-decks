import { combat } from './combat'
import { commander } from './commander'
import { lands } from './lands'
import { mana } from './mana'
import { manaBurn } from './manaBurn'
import { priority } from './priority'
import { spells } from './spells'
import { stateBased } from './stateBased'
import { turnStructure } from './turnStructure'

/** Available implementations. A GameFormat decides which become live rules. */
export const builtInPlugins = [
  turnStructure,
  priority,
  mana,
  lands,
  spells,
  stateBased,
  combat,
  commander,
  manaBurn,
]

export {
  combat,
  commander,
  lands,
  mana,
  manaBurn,
  priority,
  spells,
  stateBased,
  turnStructure,
}
