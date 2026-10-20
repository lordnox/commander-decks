import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { enters, ref, untap, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Artifact'], colors: [], manaCost: '{1}', manaValue: 1,
  ruleDefinition: snapshotFor([
    whenever(enters({ filter: { zone: 'battlefield', controller: 'you', tapped: true } }), { instructions: [untap(ref('triggering.object.after'))] }),
  ]),
} satisfies CatalogEntry
