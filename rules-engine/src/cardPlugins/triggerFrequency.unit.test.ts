import { describe, expect, test } from 'bun:test'
import { mayTriggerOnceEachTurn, markTriggeredOnceEachTurn } from './triggerFrequency'
import type { TriggerFrequencyState } from './triggerFrequency'

describe('per-object frequency slots', () => {
  test('onceEachTurn slots record the triggering turn', () => {
    const object: { triggerFrequency?: TriggerFrequencyState } = {}
    const key = 'dsl:1@0'
    expect(mayTriggerOnceEachTurn(object, key, 3)).toBe(true)
    markTriggeredOnceEachTurn(object, key, 3)
    expect(mayTriggerOnceEachTurn(object, key, 3)).toBe(false)
    expect(mayTriggerOnceEachTurn(object, key, 4)).toBe(true)
    expect(object.triggerFrequency?.[key]).toMatchObject({
      triggeredTurn: 3,
    })
  })
})
