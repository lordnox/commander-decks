import inundatedArchive from './inundated-archive'
import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { KEYWORDS, objects, ref, searchLibrary, spell } from '../cardPlugins/dsl/v1'

const ruleDefinition = snapshotFor([
  spell({
    instructions: [searchLibrary({
      bindChoice: 'found',
      chooser: ref('controller'),
      filter: objects({
        zone: 'library',
        owner: 'you',
        any: [{ type: 'Instant' }, { keyword: KEYWORDS.flash }],
      }),
      count: 1,
      to: 'hand',
      reveal: true,
    })],
  }),
])

export default {
  types: ['Instant'],
  colors: ['U', 'B'],
  manaCost: '{3}{U/B}',
  manaValue: 4,
  ruleDefinition,
  frontFace: {
    types: ['Instant'],
    colors: ['U', 'B'],
    manaCost: '{3}{U/B}',
    manaValue: 4,
    subtypes: [],
    supertypes: [],
    oracleText: 'Search your library for an instant card or a card with flash, reveal it, put it into your hand, then shuffle.',
    ruleDefinition,
  },
  backFace: {
    ...inundatedArchive,
    subtypes: [],
    supertypes: [],
    oracleText: 'This land enters tapped.\n{T}: Add {U} or {B}.',
  },
} satisfies CatalogEntry
