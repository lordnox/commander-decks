import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, discard, draw, manaCost, players, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: [],
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{2}'), tapCost()], instructions: [draw({ count: 1, targets: players() }), discard({ count: 1, targets: players() })] }),
  ]),
} satisfies CatalogEntry
