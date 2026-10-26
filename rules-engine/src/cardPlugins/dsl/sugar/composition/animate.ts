import type { ColorSet, ObjectRecipient, StatDeltaInput, WardCost } from '../../schema/v2'
import { addTypesEffect, createEffect, sequence, setColorsEffect, setStatsEffect, untilCleanup } from '../../builders'

/** Set base stats before adding Creature so a statless land never becomes an intermediate 0/0. */
export const animate = (input: { targets: ObjectRecipient; types?: readonly string[]; subtypes?: readonly string[]; colors?: ColorSet; ward?: WardCost } & ({ power: StatDeltaInput; toughness: StatDeltaInput } | { power?: never; toughness?: never })) => sequence(
  ...(input.power !== undefined && input.toughness !== undefined ? [createEffect({ targets: input.targets, effect: setStatsEffect(input.power, input.toughness), duration: untilCleanup() })] : []),
  createEffect({ targets: input.targets, effect: addTypesEffect({ types: input.types ?? ['Creature'], ...(input.subtypes ? { subtypes: input.subtypes } : {}) }), duration: untilCleanup() }),
  ...(input.colors !== undefined ? [createEffect({ targets: input.targets, effect: setColorsEffect(input.colors), duration: untilCleanup() })] : []),
  ...(input.ward ? [createEffect({ targets: input.targets, effect: { kind: 'grantWard', cost: input.ward }, duration: untilCleanup() })] : []),
)
