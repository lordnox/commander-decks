import { activated, choice, compareAmount, count, createDelayed, createEffect, ifThen, manaCost, move, objects, ref, stepDelayed } from '../../builders'

/** CR 702.84: a graveyard activation, a lasting departure replacement, and a separate delayed trigger. */
export const unearth = (cost: string) => activated({
  availableFrom: ['graveyard'], timing: 'sorcery', costs: [manaCost(cost)],
  instructions: [
    move({ targets: ref('source'), to: 'battlefield', bindChoice: 'unearthed' }),
    ifThen(compareAmount(count(objects({ among: choice('unearthed') })), 'gte', 1), { then: [
      createEffect({ targets: choice('unearthed'), effect: { kind: 'grantKeyword', keyword: 'haste' }, duration: { kind: 'permanent' } }),
      createEffect({ targets: choice('unearthed'), effect: { kind: 'redirectDeparture', to: 'exile' }, duration: { kind: 'permanent' } }),
      createDelayed({ condition: stepDelayed({ step: 'end' }), instructions: [move({ targets: choice('unearthed'), to: 'exile' })] }),
    ] }),
  ],
})
