import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import { pendingSelectionFor } from '../rules/selectCards'

const card = (name: string, types: string[], manaCost = '') =>
  cardTemplate(name, { types, manaCost })

describe('Sin Fall routine card support', () => {
  test('Portal upkeep choice survives restart and reanimates as a Phyrexian', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [card('Portal to Phyrexia', ['Artifact'], '{9}')] },
        hands: { p2: [card('Borrowed Body', ['Creature'], '{4}{G}')] },
      },
    )
    const body = server.state.zoneOrder.p2.hand[0]
    let state = ok(server.rules(server.state, { type: 'move', objectId: body, to: 'graveyard' }))
    state = { ...state, step: 'untap', active: 'p1', priority: 'p1' }
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.stack).toHaveLength(0)
    const restarted = structuredClone(state)
    const selection = pendingSelectionFor(restarted, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', count: 1 })
    const stacked = ok(server.rules(restarted, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [body],
    }))
    expect(stacked.stack[0]?.name).toBe('Portal to Phyrexia')
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(resolved.objects[body]).toMatchObject({
      zone: 'battlefield',
      controller: 'p1',
    })
    expect(resolved.objects[body].subtypes).toContain('Phyrexian')
  })

})
