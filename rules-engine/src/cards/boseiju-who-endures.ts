import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  activated,
  amount,
  capturePlayer,
  controllerOf,
  count,
  destroy,
  discardCost,
  manaCost,
  objects,
  ref,
  resultPlayer,
  searchLibrary,
  select,
  tapCost,
  target,
} from '../cardPlugins/dsl/v1'

const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const

export default {
  types: ['Land'], colors: [], manaCost: '', manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({
      costs: [tapCost()],
      instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { G: amount(1) } }],
    }),
    activated({
      availableFrom: ['hand'],
      costs: [manaCost('{1}{G}'), discardCost(ref('source'), 1)],
      costReductions: [{ generic: count(objects({
        zone: 'battlefield',
        type: 'Creature',
        supertypes: ['Legendary'],
        controller: 'you',
      })) }],
      decisions: { targets: [select({ filter: objects({
        zone: 'battlefield',
        controller: 'opponent',
        any: [
          { type: 'Artifact' },
          { type: 'Enchantment' },
          { type: 'Land', not: { supertypes: ['Basic'] } },
        ],
      }), count: 1 })] },
      instructions: [
        capturePlayer({ player: controllerOf(target(0)), bindResult: 'targetController' }),
        destroy({ targets: target(0) }),
        searchLibrary({
          bindChoice: 'found',
          chooser: resultPlayer('targetController'),
          filter: objects({
            zone: 'library',
            owner: resultPlayer('targetController'),
            type: 'Land',
            any: BASIC_LAND_TYPES.map((subtype) => ({ subtypes: [subtype] })),
          }),
          min: 0,
          max: 1,
          to: 'battlefield',
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
