import malakirMire from './malakir-mire'
import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { createEffect, grantAbilityEffect, loseLife, move, objects, ref, select, self, spell, target, untilCleanup } from '../cardPlugins/dsl/v1'

const ruleDefinition = snapshotFor([
  spell({
    decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
    instructions: [
      loseLife({ targets: ref('controller'), amount: 2 }),
      createEffect({
        targets: target(0),
        effect: grantAbilityEffect({
          kind: 'triggered', on: self.dies,
          instructions: [move({ targets: ref('triggering.object.after'), to: 'battlefield', tapped: true })],
        }),
        duration: untilCleanup(),
      }),
    ],
  }),
])

export default {
  types: ['Instant'], colors: 'B', manaCost: '{B}', manaValue: 1,
  ruleDefinition,
  frontFace: {
    types: ['Instant'], colors: 'B', manaCost: '{B}', manaValue: 1,
    subtypes: [], supertypes: [], oracleText: "Choose target creature. You lose 2 life. Until end of turn, that creature gains \"When this creature dies, return it to the battlefield tapped under its owner's control.\"", ruleDefinition,
  },
  backFace: { ...malakirMire, subtypes: [], supertypes: [], oracleText: "This land enters tapped.\n{T}: Add {B}." },
} satisfies CatalogEntry
