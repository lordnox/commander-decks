import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { commanderRules } from '../formats'
import { rules } from '../kernel'
import { bears, newGame } from '../testGame'

describe('activateAbility timing', () => {
  test('non-mana activations need priority; mana activations do not', () => {
    const catalog = createCatalog(commanderRules.plugins)
    const state = newGame({
      players: 2,
      battlefield: { p1: [bears()] },
    })
    const bearId = Object.values(state.objects).find((object) => object.name === 'Grizzly Bears')!.id
    state.priority = 'p2'

    const withoutPriority = rules(
      state,
      { type: 'activateAbility', abilityId: 'test.stack', seat: 'p1', objectId: bearId },
      catalog,
    )
    expect(withoutPriority.ok).toBe(false)
    if (!withoutPriority.ok) {
      expect(withoutPriority.error).toContain('priority')
    }

    const asMana = rules(
      state,
      {
        type: 'activateAbility',
        abilityId: 'test.mana',
        seat: 'p1',
        objectId: bearId,
        manaAbility: true,
      },
      catalog,
    )
    expect(asMana.ok).toBe(true)
  })
})
