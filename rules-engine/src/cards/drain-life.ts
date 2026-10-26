import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { anyTarget, captureAmount, characteristic, chooseX, damage, divide, gainLife, minimum, ref, resultAmount, ROUNDING_MODES, select, spell, target, variable } from '../cardPlugins/dsl/v1'
import { MAX_RUNTIME_AMOUNT } from '../cardPlugins/dsl/compiler'

// Missing characteristics impose no cap (e.g. life on a creature or loyalty on a battle).
const recipientValue = (field: 'life' | 'toughness' | 'loyalty') => divide({
  value: characteristic(target(0), field, { information: 'current', fallback: MAX_RUNTIME_AMOUNT }),
  by: 1, rounding: ROUNDING_MODES.down,
})

export default {
  types: ['Sorcery'], colors: 'B', manaCost: '{X}{1}{B}', manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { variables: [chooseX({ manaColor: 'B' })], targets: [select({ filter: anyTarget(), count: 1 })] },
      instructions: [
        captureAmount({ amount: minimum(recipientValue('life'), recipientValue('loyalty')), bindResult: 'gainCap' }),
        damage({ source: ref('source'), targets: target(0), amount: variable('X'), bindResult: 'damageDealt' }),
        gainLife({ targets: ref('controller'), amount: minimum(resultAmount('gainCap'), minimum(recipientValue('toughness'), resultAmount('damageDealt'))) }),
      ],
    }),
  ]),
} satisfies CatalogEntry
