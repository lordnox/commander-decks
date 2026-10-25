import type { GameState } from '../types'
import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, planeswalker } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingOptionSelection } from '../rules/selectOptions'
import { planeswalker as planeswalkerPlugin } from './planeswalker'
import { projectForViewer } from '../runtime'

const jace = (loyalty = 4) => planeswalker('Jace, Multiverse Architect', loyalty, {
  subtypes: ['Jace'],
  counters: { loyalty },
})

const game = (setup: Parameters<typeof createServerGame>[1] = {}) =>
  createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [jace()] },
    ...setup,
  }, { random: () => 0, cardPlugins: [planeswalkerPlugin] })

const jaceId = (state: ReturnType<typeof game>['state']) =>
  Object.values(state.objects).find((object) => object.name === 'Jace, Multiverse Architect')!.id

const atOpponentBeginCombat = (
  runtime: ReturnType<typeof game>,
  state: ReturnType<typeof game>['state'],
) => {
  let current: GameState = { ...state, active: 'p2' as const, step: 'precombatMain' as const }
  current = ok(runtime.rules(current, { type: 'advanceStep' }))
  expect(current.step).toBe('beginCombat')
  return current
}

describe('Jace, Multiverse Architect', () => {
  test('+1 draws two then prompts to put a hand card on the bottom', () => {
    const runtime = game({
      libraries: { p1: ['A', 'B', 'C'].map((name) => cardTemplate(name)) },
    })
    const id = jaceId(runtime.state)
    let state: GameState = { ...runtime.state, active: 'p1', step: 'precombatMain' as const, priority: 'p1' }
    state = ok(runtime.rules(state, {
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId: id,
    }))
    state = resolveStack(runtime.rules, state)
    expect(state.zoneOrder.p1.hand.length).toBeGreaterThanOrEqual(2)
    const selection = pendingSelectionFor(state, 'p1')!
    const handCard = state.zoneOrder.p1.hand[0]
    state = ok(runtime.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: selection.id,
      kind: 'choose',
      count: 1,
      objectIds: [handCard],
    }))
    expect(state.zoneOrder.p1.library.at(-1)).toBe(handCard)
  })

  test('−3 exiles another target you control then reveals onto the battlefield', () => {
    const sacrifice = cardTemplate('Sacrifice Me', { types: ['Creature'], power: 1, toughness: 1 })
    const revealed = cardTemplate('Revealed Walker', {
      types: ['Planeswalker'],
      subtypes: ['Jace'],
      printedLoyalty: 3,
    })
    const runtime = game({
      battlefield: { p1: [jace(), sacrifice] },
      libraries: { p1: [cardTemplate('Noise'), revealed] },
    })
    const id = jaceId(runtime.state)
    const sacrificeId = Object.values(runtime.state.objects)
      .find((object) => object.name === 'Sacrifice Me')!.id
    let state: GameState = { ...runtime.state, active: 'p1', step: 'precombatMain' as const, priority: 'p1' }
    state = ok(runtime.rules(state, {
      type: 'activateAbility',
      abilityId: '$.abilities[2]',
      seat: 'p1',
      objectId: id,
      targets: [{ kind: 'object', objectId: sacrificeId }],
    }))
    state = resolveStack(runtime.rules, state)
    expect(state.objects[sacrificeId].zone).toBe('exile')
    expect(state.zoneOrder.p1.battlefield).toContain(
      Object.values(state.objects).find((object) => object.name === 'Revealed Walker')!.id,
    )
  })

  test('pending optional pay survives projection for the payer only', () => {
    const runtime = game()
    let state = atOpponentBeginCombat(runtime, runtime.state)
    state = resolveStack(runtime.rules, state)
    const projected = projectForViewer(state, 'p2')
    expect(pendingOptionSelection(projected, 'p2')).toBeDefined()
    expect(pendingOptionSelection(projectForViewer(state, 'p1'), 'p2')).toBeUndefined()
  })
})
