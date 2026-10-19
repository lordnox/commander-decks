import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, createDelayed, manaCost, modifyEvent, move, objects, ref, replacement, searchLibrary, staticAbility, stepDelayed, tapCost, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: [],
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
    activated({ costs: [manaCost('{1}'), tapCost()], instructions: [
      searchLibrary({ bindChoice: 'land', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }), min: 0, max: 1, to: 'battlefield', tapped: true }),
      createDelayed({ condition: stepDelayed({ step: 'cleanup' }), instructions: [move({ targets: ref('source'), to: 'hand' })] }),
    ] }),
  ]),
} satisfies CatalogEntry
