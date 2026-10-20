import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { blinkUntil, cardCycled, cycleFromHand, may, objects, players, select, self, stepDelayed, target, whenever } from '../cardPlugins/dsl/v1'

const exileUntilEnd = {
  decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
  instructions: [may(blinkUntil({ targets: target(0), bindChoice: 'exiled', condition: stepDelayed({ step: 'end' }) }))],
}

export default {
  types: ['Enchantment'],
  colors: ['W'],
  manaCost: '{2}{W}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    whenever(cardCycled({ player: players({ relation: 'you' }) }), exileUntilEnd),
    whenever(self.cycles, { activeIn: ['graveyard'], ...exileUntilEnd }),
    cycleFromHand({ mana: '{2}{W}' }),
  ]),
} satisfies CatalogEntry
