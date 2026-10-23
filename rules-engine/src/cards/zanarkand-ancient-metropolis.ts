import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  activated,
  amount,
  choice,
  count,
  createToken,
  modifyEvent,
  objects,
  putCounters,
  ref,
  replacement,
  spell,
  staticAbility,
  tapCost,
  token,
  wouldEnter,
} from '../cardPlugins/dsl/v1'

const landProgram = snapshotFor([
  staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
  activated({ costs: [tapCost()], instructions: [{ kind: 'addMana', amount: { G: amount(1) }, targets: ref('controller') }] }),
])

const adventureProgram = snapshotFor([
  spell({
    instructions: [
      createToken({
        count: 1,
        targets: ref('controller'),
        token: token('Hero-1-1'),
        bindChoice: 'hero',
      }),
      putCounters({
        targets: choice('hero'),
        counter: '+1/+1',
        count: count(objects({ zone: 'battlefield', controller: 'you', type: 'Land' })),
      }),
    ],
  }),
])

export default {
  types: ['Land'],
  subtypes: ['Town'],
  colors: [],
  manaCost: '',
  manaValue: 0,
  ruleDefinition: landProgram,
  frontFace: {
    types: ['Land'],
    subtypes: ['Town'],
    supertypes: [],
    colors: [],
    manaCost: '',
    manaValue: 0,
    oracleText: 'This land enters tapped.\n{T}: Add {G}.',
    ruleDefinition: landProgram,
  },
  backFace: {
    types: ['Sorcery'],
    subtypes: ['Adventure'],
    supertypes: [],
    colors: ['G'],
    manaCost: '{4}{G}{G}',
    manaValue: 6,
    oracleText: 'Create a 1/1 colorless Hero creature token. Put a +1/+1 counter on it for each land you control.',
    ruleDefinition: adventureProgram,
  },
} satisfies CatalogEntry
