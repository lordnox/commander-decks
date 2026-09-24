import { describe, expect, test } from 'bun:test'
import { hasKeyword } from '../keywords'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'
import { createServerGame, projectForViewer } from '../runtime'
import type { ReduceResult } from '../types'
import { ward as wardEffect } from '../cardPlugins/effects'
import { wardCostGeneric } from './ward'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const warded = (effects = [wardEffect(2)], oracleText = 'Ward {2}') =>
  cardTemplate('Warded Beast', {
    types: ['Creature'],
    power: 2,
    toughness: 2,
    oracleText,
    effects,
  })

const hex = () => cardTemplate('Test Hex', {
  types: ['Instant'],
  manaCost: '{C}',
  oracleText: 'Test Hex deals 1 damage to target creature.',
})

describe('ward', () => {
  test('keyword line Ward {2} is detected from oracle text', () => {
    const object = warded([], 'Ward {2}\nOther creatures you control get +1/+1.')
    expect(hasKeyword(object, 'ward {2}')).toBe(true)
    expect(wardCostGeneric(object)).toBe(2)
  })

  test('an opponent must pay or the spell is countered', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: ['p1', 'p2'],
        battlefield: { p1: [warded()] },
        hands: { p2: [hex()] },
      },
      { random: () => 0.5 },
    )
    const targetId = Object.values(server.state.objects)
      .find((object) => object.name === 'Warded Beast')!.id
    const spellId = Object.values(server.state.objects)
      .find((object) => object.name === 'Test Hex')!.id
    const ready = structuredClone(server.state)
    ready.priority = 'p2'
    ready.players.p2.mana.C = 3
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p2',
      objectId: spellId,
      targets: [{ kind: 'object', objectId: targetId }],
    }))
    expect(cast.stack).toHaveLength(1)
    expect(pendingDialog(cast)).toMatchObject({
      kind: 'pay-ward',
      seat: 'p2',
      cost: '{2}',
      targetId,
    })
    expect(pendingDialog(projectForViewer(cast, 'p1'))).toBeUndefined()
    expect(pendingDialog(projectForViewer(cast, 'p2'))?.kind).toBe('pay-ward')

    const declined = ok(server.rules(cast, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p2',
      payload: { accepted: false },
    }))
    expect(declined.stack).toHaveLength(0)
    expect(declined.objects[spellId].zone).toBe('graveyard')
    expect(pendingDialog(declined)).toBeUndefined()
  })

  test('paying ward keeps the spell on the stack', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: ['p1', 'p2'],
        battlefield: { p1: [warded()] },
        hands: { p2: [hex()] },
      },
      { random: () => 0.5 },
    )
    const targetId = Object.values(server.state.objects)
      .find((object) => object.name === 'Warded Beast')!.id
    const spellId = Object.values(server.state.objects)
      .find((object) => object.name === 'Test Hex')!.id
    const ready = structuredClone(server.state)
    ready.priority = 'p2'
    ready.players.p2.mana.C = 3
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p2',
      objectId: spellId,
      targets: [{ kind: 'object', objectId: targetId }],
    }))
    const paid = ok(server.rules(cast, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p2',
      payload: { accepted: true },
    }))
    expect(paid.stack).toHaveLength(1)
    expect(paid.stack[0].objectId).toBe(spellId)
    expect(paid.players.p2.mana.C).toBe(0)
    expect(pendingDialog(paid)).toBeUndefined()
  })

  test('oracle-text Ward {2} without a stamped effect still taxes opponents', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: ['p1', 'p2'],
        battlefield: { p1: [warded([], 'Ward {2}')] },
        hands: { p2: [hex()] },
      },
      { random: () => 0.5 },
    )
    const targetId = Object.values(server.state.objects)
      .find((object) => object.name === 'Warded Beast')!.id
    const spellId = Object.values(server.state.objects)
      .find((object) => object.name === 'Test Hex')!.id
    const ready = structuredClone(server.state)
    ready.priority = 'p2'
    ready.players.p2.mana.C = 1
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p2',
      objectId: spellId,
      targets: [{ kind: 'object', objectId: targetId }],
    }))
    expect(pendingDialog(cast)?.kind).toBe('pay-ward')
    expect(pendingDialog(cast)?.cost).toBe('{2}')
  })

  test('the controller targeting this permanent does not tax', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [warded()] },
        hands: { p1: [hex()] },
      },
      { random: () => 0.5 },
    )
    const targetId = Object.values(server.state.objects)
      .find((object) => object.name === 'Warded Beast')!.id
    const spellId = Object.values(server.state.objects)
      .find((object) => object.name === 'Test Hex')!.id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 1
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spellId,
      targets: [{ kind: 'object', objectId: targetId }],
    }))
    expect(cast.stack).toHaveLength(1)
    expect(pendingDialog(cast)).toBeUndefined()
  })

  test('a host restart preserves an open pay-ward choice', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: ['p1', 'p2'],
        battlefield: { p1: [warded()] },
        hands: { p2: [hex()] },
      },
      { random: () => 0.5 },
    )
    const targetId = Object.values(server.state.objects)
      .find((object) => object.name === 'Warded Beast')!.id
    const spellId = Object.values(server.state.objects)
      .find((object) => object.name === 'Test Hex')!.id
    const ready = structuredClone(server.state)
    ready.priority = 'p2'
    ready.players.p2.mana.C = 3
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p2',
      objectId: spellId,
      targets: [{ kind: 'object', objectId: targetId }],
    }))
    const choice = pendingDialog(cast)
    expect(choice?.kind).toBe('pay-ward')

    const restarted = createServerGame(commanderRules, {}, { random: () => 0.5 })
    restarted.state = structuredClone(cast)
    expect(pendingDialog(restarted.state)?.stackId).toBe(choice?.stackId)
    const finished = ok(restarted.rules(restarted.state, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p2',
      payload: { accepted: false },
    }))
    expect(finished.stack).toHaveLength(0)
    expect(finished.objects[spellId].zone).toBe('graveyard')
  })

  test('structuredClone keeps the ward static effect', () => {
    const stamped = [wardEffect(2)]
    expect(structuredClone(stamped)).toEqual(stamped)
  })
})
