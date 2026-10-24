import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { draw, spellCast, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  subtypes: ["Elf", "Druid"],
  colors: ["G"],
  manaCost: "{2}{G}{G}",
  manaValue: 4,
  ruleDefinition: snapshotFor([
    whenever(spellCast({ filter: { type: 'Creature', controller: 'you' } }), { instructions: [draw(1)] }),
  ]),
} satisfies CatalogEntry
