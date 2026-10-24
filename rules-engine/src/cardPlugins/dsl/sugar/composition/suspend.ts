import { compareAmount, counterCount, countersRemoved, offerCast, ref, removeCounters, stepBegins, suspendEffect, whenever } from '../../builders'

export const suspend = (counters: number, cost: string) => [
  suspendEffect(counters, cost),
  { ...whenever(stepBegins({ step: 'upkeep', player: ref('controller') }), {
    triggerOnlyIf: compareAmount(counterCount(ref('source'), 'time'), 'gte', 1),
    instructions: [removeCounters({ targets: ref('source'), counter: 'time', count: 1 })],
  }), activeIn: ['exile'] as const },
  { ...whenever(countersRemoved({ filter: ref('source'), counter: 'time', last: true }), {
    instructions: [offerCast({ object: ref('source'), zone: 'exile', grantHaste: true })],
  }), activeIn: ['exile'] as const },
]
