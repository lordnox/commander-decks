import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseX, gainLife, loseLife, multiply, players, ref, resultAmount, spell, variable } from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'], colors: ["W", "B"], manaCost: '{X}{W}{W}{B}{B}', manaValue: 4,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { variables: [chooseX()] },
      instructions: [
        loseLife({ targets: players({ relation: 'opponent' }), amount: multiply(variable('X'), 2), bindResult: 'lifeLost' }),
        gainLife({ targets: ref('controller'), amount: resultAmount('lifeLost') }),
      ],
    }),
  ]),
} satisfies CatalogEntry
