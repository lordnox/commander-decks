import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, amount, keyword, manaCost, players, staticAbility, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'], subtypes: ['Viashino', 'Shaman'], colors: ['B', 'R', 'G'], manaCost: '{1}{B}{R}{G}', manaValue: 4,
  ruleDefinition: snapshotFor([
    keyword.vigilance,
    staticAbility({ kind: 'loseLifeOnManaLoss' }),
    activated({ costs: [manaCost('{1}'), tapCost()], instructions: [{ kind: 'addMana', targets: players({ relation: 'any' }), amount: { B: amount(1), R: amount(1), G: amount(1) } }] }),
  ]),
} satisfies CatalogEntry
