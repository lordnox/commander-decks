import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, destroy, draw, keyword, objects, players, ref, select, self, tapCost, target, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  subtypes: ["Human", "Artificer"],
  colors: ["W"],
  manaCost: "{2}{W}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    keyword.vigilance,
    whenever(self.enters, { decisions: { targets: [select({ filter: objects({ zone: 'battlefield', any: [{ type: 'Artifact' }, { type: 'Enchantment' }] }), min: 0, max: 1 })] }, instructions: [destroy({ targets: target(0) })] }),
    activated({ costs: [tapCost()], decisions: { targets: [select({ filter: players({ relation: 'opponent' }), count: 1 })] }, instructions: [draw({ targets: ref('controller'), count: 1 }), draw({ targets: target(0), count: 1 })] }),
  ]),
} satisfies CatalogEntry
