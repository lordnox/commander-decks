import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, createToken, discard, draw, manaCost, ref, tapCost, token } from '../cardPlugins/dsl/v1'

export default {
  types: ["Artifact"],
  colors: [],
  manaCost: "{2}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{2}'), tapCost()], instructions: [
      draw(1),
      discard({ targets: ref('controller'), count: 1 }),
      createToken({ count: 1, targets: ref('controller'), token: token('Treasure') }),
    ] }),
  ]),
} satisfies CatalogEntry
