import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  count,
  enters,
  mill,
  multiply,
  objects,
  players,
  select,
  target,
  whenever,
} from '../cardPlugins/dsl/v1'

const seaCreatures = objects({
  zone: 'battlefield',
  controller: 'you',
  any: [
    { subtypes: ['Crab'] },
    { subtypes: ['Lobster'] },
    { subtypes: ['Nautilus'] },
    { subtypes: ['Starfish'] },
    { subtypes: ['Trilobite'] },
  ],
})
const anyPlayers = players({ relation: 'any' })

export default {
  types: ['Creature'],
  subtypes: ['Crab', 'Druid'],
  colors: 'UBG',
  manaCost: '{B}{G}{U}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    whenever(enters({ filter: { type: 'Land', controller: 'you' } }), {
      decisions: {
        targets: [select({ filter: anyPlayers, min: 0, max: count(anyPlayers) })],
      },
      instructions: [mill({ count: multiply(2, count(seaCreatures)), targets: target(0) })],
    }),
  ]),
} satisfies CatalogEntry
