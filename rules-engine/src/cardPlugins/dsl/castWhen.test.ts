import { describe, expect, test } from 'bun:test'
import {
  activePlayer,
  allConditions,
  currentStep,
  draw,
  ref,
} from './v1'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { legalActsFor } from '../../actions'
import { ok } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'

const endStepSpell = () => instructionSpell({
  when: allConditions(currentStep('end'), activePlayer(ref('controller'))),
  instructions: [draw({ count: 1, targets: ref('controller') })],
})

describe('cast when', () => {
  test('a your-end-step spell is refused on the main phase and during an opponent end step', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [endStepSpell()] },
      libraries: { p1: [instructionSpell({ instructions: [draw({ count: 1, targets: ref('controller') })] })] },
    }, { random: () => 0 })
    const source = server.state.zoneOrder.p1.hand[0]
    expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source }).ok).toBe(false)

    const opponentEnd = { ...server.state, active: 'p2', step: 'end' as const, priority: 'p1' }
    expect(server.rules(opponentEnd, { type: 'castSpell', seat: 'p1', objectId: source }).ok).toBe(false)
    expect(legalActsFor(opponentEnd, 'p1').some((action) =>
      action.kind === 'castSpell' && action.objectId === source)).toBe(false)
  })

  test('a your-end-step spell casts during the controller end step', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [endStepSpell()] },
      libraries: { p1: [instructionSpell({ instructions: [] })] },
    }, { random: () => 0 })
    const source = server.state.zoneOrder.p1.hand[0]
    const ready = { ...server.state, step: 'end' as const }
    expect(legalActsFor(ready, 'p1').some((action) =>
      action.kind === 'castSpell' && action.objectId === source)).toBe(true)
    const stacked = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: source }))
    expect(ok(server.rules(stacked, { type: 'resolveTop' })).zoneOrder.p1.hand).toHaveLength(1)
  })
})
