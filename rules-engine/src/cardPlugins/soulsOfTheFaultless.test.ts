import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'

const souls = () => cardTemplate('Souls of the Faultless', {
  types: ['Creature'],
  subtypes: ['Spirit'],
  colors: ['W', 'B'],
  power: 0,
  toughness: 4,
  oracleText: 'Defender\nWhenever this creature is dealt combat damage, '
    + 'you gain that much life and attacking player loses that much life.',
})

const attacker = () => cardTemplate('Hill Giant', {
  types: ['Creature'],
  power: 3,
  toughness: 3,
})

const game = () => createServerGame(commanderRules, {
  battlefield: {
    p1: [souls()],
    p2: [attacker()],
  },
})

const objects = (server: ReturnType<typeof game>) => {
  const source = Object.values(server.state.objects)
    .find((object) => object.name === 'Hill Giant')!
  const recipient = Object.values(server.state.objects)
    .find((object) => object.name === 'Souls of the Faultless')!
  return { source, recipient }
}

describe('Souls of the Faultless', () => {
  test('captures combat damage amount and attacking player on its trigger', () => {
    const server = game()
    const { source, recipient } = objects(server)
    const triggered = ok(server.rules(server.state, {
      type: 'combatDamage',
      sourceId: source.id,
      target: { kind: 'object', objectId: recipient.id },
      amount: 3,
    }))

    expect(triggered.stack[0]).toMatchObject({
      kind: 'ability',
      name: 'Souls of the Faultless',
      controller: 'p1',
      payload: {
        triggeringPlayer: 'p2',
        triggerAmount: 3,
      },
    })
    expect(triggered.objects[recipient.id].damageMarked).toBe(3)
    expect(triggered.players.p1.life).toBe(40)
    expect(triggered.players.p2.life).toBe(40)

    const resolved = ok(server.rules(triggered, { type: 'resolveTop' }))
    expect(resolved.players.p1.life).toBe(43)
    expect(resolved.players.p2.life).toBe(37)
  })

  test('still resolves after lethal combat damage moves Souls away', () => {
    const server = game()
    const { source, recipient } = objects(server)
    const triggered = ok(server.rules(server.state, {
      type: 'combatDamage',
      sourceId: source.id,
      target: { kind: 'object', objectId: recipient.id },
      amount: 4,
    }))

    expect(triggered.objects[recipient.id].zone).toBe('graveyard')
    const resolved = ok(server.rules(triggered, { type: 'resolveTop' }))
    expect(resolved.players.p1.life).toBe(44)
    expect(resolved.players.p2.life).toBe(36)
  })

  test('does not trigger for noncombat damage or damage it deals', () => {
    const server = game()
    const { source, recipient } = objects(server)
    const noncombat = ok(server.rules(server.state, {
      type: 'dealDamage',
      sourceId: source.id,
      target: { kind: 'object', objectId: recipient.id },
      amount: 1,
    }))
    expect(noncombat.stack).toHaveLength(0)

    const dealt = ok(server.rules(noncombat, {
      type: 'combatDamage',
      sourceId: recipient.id,
      target: { kind: 'player', player: 'p2' },
      amount: 1,
    }))
    expect(dealt.stack).toHaveLength(0)
  })
})
