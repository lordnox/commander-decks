import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bears, newGame } from '../testGame'
import { turnStructure } from '../plugins/turnStructure'
import { applyPumpUntilEot, untilEot } from './untilEot'

describe('untilEot', () => {
  test('cleanup reverts a temporary pump', () => {
    const catalog = createCatalog([turnStructure, untilEot])
    const state = newGame({
      battlefield: { p1: [bears()] },
      builtinRules: ['turnStructure', 'untilEot'],
    })
    const creature = Object.values(state.objects)[0]
    applyPumpUntilEot(creature, 2, 2)
    expect(creature.power).toBe(4)
    expect(creature.toughness).toBe(4)

    const result = rules(
      { ...state, step: 'end' },
      { type: 'advanceStep' },
      catalog,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[creature.id].power).toBe(2)
    expect(result.state.objects[creature.id].toughness).toBe(2)
    expect(result.state.objects[creature.id].untilEot).toBeUndefined()
  })
})
