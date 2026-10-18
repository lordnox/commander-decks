import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { gainLife, ifThen, objects, ref, result, sacrifice, searchLibrary, self, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: [],
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    whenever(self.enters, { instructions: [
      sacrifice({ targets: ref('source'), bindResult: 'sacrificed' }),
      ifThen(result('sacrificed', 'sacrificed'), { then: [
        searchLibrary({ bindChoice: 'found', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'], any: [{ subtypes: ['Forest'] }, { subtypes: ['Plains'] }, { subtypes: ['Island'] }] }), min: 0, max: 1, to: 'battlefield', tapped: true }),
        gainLife({ amount: 1, targets: ref('controller') }),
      ] }),
    ] }),
  ]),
} satisfies CatalogEntry
