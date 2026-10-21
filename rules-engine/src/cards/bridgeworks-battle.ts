import tanglespanBridgeworks from './tanglespan-bridgeworks'
import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { createEffect, fight, objects, pumpEffect, select, spell, target, untilCleanup } from '../cardPlugins/dsl/v1'

const ruleDefinition = snapshotFor([
  spell({
    decisions: {
      targets: [
        select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), count: 1 }),
        select({ filter: objects({ zone: 'battlefield', type: 'Creature', not: { controller: 'you' } }), min: 0, max: 1 }),
      ],
    },
    instructions: [
      createEffect({ targets: target(0), effect: pumpEffect(2, 2), duration: untilCleanup() }),
      fight({ left: target(0), right: target(1) }),
    ],
  }),
])

export default {
  types: ['Sorcery'],
  colors: ['G'],
  manaCost: '{2}{G}',
  manaValue: 3,
  ruleDefinition,
  frontFace: {
    types: ['Sorcery'],
    subtypes: [],
    supertypes: [],
    colors: ['G'],
    manaCost: '{2}{G}',
    manaValue: 3,
    oracleText: "Target creature you control gets +2/+2 until end of turn. It fights up to one target creature you don't control. (Each deals damage equal to its power to the other.)",
    ruleDefinition,
  },
  backFace: {
    ...tanglespanBridgeworks,
    subtypes: [],
    supertypes: [],
    oracleText: "As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {G}.",
  },
} satisfies CatalogEntry
