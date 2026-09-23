import { describe, expect, test } from 'bun:test'
import {
  bumpResolveCountThisTurn,
  mayTriggerOnceEachTurn,
  markTriggeredOnceEachTurn,
  triggerEffectByKey,
  triggerEffectKey,
} from './triggerFrequency'
import { draw, landfall, landfallOnceEachTurn } from './effectBuilders'

describe('triggerEffectKey', () => {
  test('distinguishes two triggers with the same on binding', () => {
    const effects = [landfall(draw(1)), landfallOnceEachTurn(draw(1))]
    expect(triggerEffectKey(effects, effects[0])).toBe('landfall@0')
    expect(triggerEffectKey(effects, effects[1])).toBe('landfall@1')
    expect(triggerEffectByKey(effects, 'landfall@1')?.onceEachTurn).toBe(true)
  })
})

describe('per-object frequency slots', () => {
  test('trigger and resolve counters stay independent', () => {
    const object = {}
    const key = 'landfall@0'
    expect(mayTriggerOnceEachTurn(object, key, 3)).toBe(true)
    markTriggeredOnceEachTurn(object, key, 3)
    expect(mayTriggerOnceEachTurn(object, key, 3)).toBe(false)
    expect(mayTriggerOnceEachTurn(object, key, 4)).toBe(true)
    expect(bumpResolveCountThisTurn(object, key, 5)).toBe(1)
    expect(bumpResolveCountThisTurn(object, key, 5)).toBe(2)
    expect(bumpResolveCountThisTurn(object, key, 6)).toBe(1)
    expect(object.triggerFrequency?.[key]).toMatchObject({
      triggeredTurn: 3,
      resolveCountTurn: 6,
      resolveCount: 1,
    })
  })
})
