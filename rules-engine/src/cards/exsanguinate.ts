import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseX, gainLife, loseLife, players, ref, resultAmount, spell, variable } from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'], colors: ["B"], manaCost: '{X}{B}{B}', manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { variables: [chooseX()] },
      instructions: [
        loseLife({ targets: players({ relation: 'opponent' }), amount: variable('X'), bindResult: 'lifeLost' }),
        gainLife({ targets: ref('controller'), amount: resultAmount('lifeLost') }),
      ],
    }),
  ]),
} satisfies CatalogEntry
