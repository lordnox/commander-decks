import { describe, expect, test } from 'bun:test'
import { mayTriggerOnceEachTurn, markTriggeredOnceEachTurn, triggerEffectByKey, triggerEffectKey } from './triggerFrequency'
import type { TriggerFrequencyState } from './triggerFrequency'
import { draw, landfall, landfallOnceEachTurn } from './effectBuilders'

describe('triggerEffectKey', () => {
  test('distinguishes two triggers with the same on binding', () => {
    const effects = [landfall(draw(1)), landfallOnceEachTurn(draw(1))]
      .filter((effect) => effect.op === 'trigger')
    expect(triggerEffectKey(effects, effects[0])).toBe('landfall@0')
    expect(triggerEffectKey(effects, effects[1])).toBe('landfall@1')
    expect(triggerEffectByKey(effects, 'landfall@1')?.onceEachTurn).toBe(true)
  })
})

describe('per-object frequency slots', () => {
  test('onceEachTurn slots record the triggering turn', () => {
    const object: { triggerFrequency?: TriggerFrequencyState } = {}
    const key = 'landfall@0'
    expect(mayTriggerOnceEachTurn(object, key, 3)).toBe(true)
    markTriggeredOnceEachTurn(object, key, 3)
    expect(mayTriggerOnceEachTurn(object, key, 3)).toBe(false)
    expect(mayTriggerOnceEachTurn(object, key, 4)).toBe(true)
    expect(object.triggerFrequency?.[key]).toMatchObject({
      triggeredTurn: 3,
    })
  })
})
