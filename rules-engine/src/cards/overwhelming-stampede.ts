import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  createEffect,
  greatest,
  grantKeywordEffect,
  KEYWORDS,
  objects,
  pumpEffect,
  spell,
  untilCleanup,
} from '../cardPlugins/dsl/v1'

const controlledCreatures = () => objects({ zone: 'battlefield', controller: 'you', type: 'Creature' })

export const tramplePumpFromGreatestPower = () => {
  const creatures = controlledCreatures()
  const bonus = greatest({ of: creatures, characteristic: 'power', information: 'current' })
  return [
    createEffect({ targets: creatures, effect: pumpEffect(bonus, bonus), duration: untilCleanup() }),
    createEffect({ targets: creatures, effect: grantKeywordEffect(KEYWORDS.trample), duration: untilCleanup() }),
  ]
}

export default {
  types: ['Sorcery'], colors: 'G', manaCost: '{3}{G}{G}', manaValue: 5,
  ruleDefinition: snapshotFor([
    spell({ instructions: tramplePumpFromGreatestPower() }),
  ]),
} satisfies CatalogEntry
