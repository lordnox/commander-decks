import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { CHOICE_RELATIONS, activated, manaCost, modifyEvent, objects, ref, replacement, sacrificeCost, searchLibrary, staticAbility, tapCost, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'],
  colors: [],
  manaCost: '',
  manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
    activated({ costs: [tapCost()], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: { kind: 'constant', value: 1 } } }] }),
    activated({
      costs: [manaCost('{2}'), tapCost(), sacrificeCost(ref('source'), 1)],
      instructions: [searchLibrary({
        bindChoice: 'found',
        chooser: ref('controller'),
        filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }),
        min: 0,
        max: 2,
        related: CHOICE_RELATIONS.shareLandType,
        to: 'battlefield',
        tapped: true,
      })],
    }),
  ]),
} satisfies CatalogEntry
