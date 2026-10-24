import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseInstructions, mill, move, objects, ref, self, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  subtypes: ["Merfolk", "Shaman"],
  colors: ["G"],
  manaCost: "{3}{G}",
  manaValue: 4,
  ruleDefinition: snapshotFor([
    whenever(self.attacks, { instructions: [chooseInstructions({
      chooser: ref('controller'), optional: true,
      options: [{ label: 'Mill three cards', instructions: [mill({ count: 3, targets: ref('controller') })] }, { label: 'Decline', instructions: [] }],
    })] }),
    whenever(self.dies, { instructions: [move({
      targets: objects({ zone: 'graveyard', owner: 'you', type: 'Land' }),
      to: 'battlefield', tapped: true,
    })] }),
  ]),
} satisfies CatalogEntry
