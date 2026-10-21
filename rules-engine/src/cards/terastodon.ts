import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  choice,
  createToken,
  destroy,
  forEach,
  objects,
  ref,
  select,
  self,
  target,
  whenever,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'], subtypes: ['Elephant'], colors: ['G'], manaCost: '{6}{G}{G}', manaValue: 8,
  ruleDefinition: snapshotFor([
    whenever(self.enters, {
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', not: { type: 'Creature' } }), min: 0, max: 3 })] },
      instructions: [
        destroy({ targets: target(0), bindChoice: 'destroyed' }),
        forEach({
          of: choice('destroyed'),
          instructions: [createToken({
            count: 1,
            targets: ref('event.player'),
            token: { name: 'Elephant', types: ['Creature'], subtypes: ['Elephant'], colors: ['G'], power: 3, toughness: 3 },
          })],
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
