import { combat } from './combat'
import { commander } from './commander'
import { lands } from './lands'
import { mana } from './mana'
import { manaBurn } from './manaBurn'
import { priority } from './priority'
import { spells } from './spells'
import { stateBased } from './stateBased'
import { turnStructure } from './turnStructure'

/** Always registered in the catalog. Only live in a game if a RuleInstance exists. */
export const optionalPlugins = [manaBurn]

export const defaultPlugins = [
  turnStructure,
  priority,
  mana,
  lands,
  spells,
  stateBased,
  combat,
  commander,
  ...optionalPlugins,
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
