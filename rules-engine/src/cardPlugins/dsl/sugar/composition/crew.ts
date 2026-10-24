import type { AmountInput } from '../../schema/v1'
import { activated, amount, ref } from '../../builders'
import { animate } from './animate'

/** CR 702.122: the cost taps other creatures and ignores summoning sickness. */
export const crew = (power: AmountInput) => activated({
  costs: [{ kind: 'crew', power: typeof power === 'number' ? amount(power) : power }],
  instructions: [animate({ targets: ref('source'), types: ['Artifact', 'Creature'] })],
})
