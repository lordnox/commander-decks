import { describe, expect, test } from 'bun:test'
import { projectForViewer } from '../index'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { ability, handlerIdsFromEffects, ward } from './effects'
import { ward as wardPlugin } from './ward'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const wurm = () => cardTemplate('Warded Wurm', {
  types: ['Creature'],
  power: 7,
  toughness: 7,
  effects: [ward({ life: 7 })],
})

const bolt = () => cardTemplate('Lightning Bolt', { types: ['Instant'], manaCost: '{R}' })

const poker = () => cardTemplate('Poker', {
  types: ['Creature'],
  effects: [ability({ id: 'poker.poke', targets: 'creature' }, {}, { kind: 'gainLife', count: 1 })],
})

const game = (life = 20) => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [bolt()] },
    battlefield: { p1: [poker(), wurm()], p2: [wurm()] },
  }, { random: () => 0.5, cardPlugins: [wardPlugin, activated] })
  const ready = structuredClone(server.state)
  ready.players.p1.life = life
  ready.players.p1.mana.R = 1
  ready.priority = 'p1'
  return { server, ready }
}

const theirWurm = (state: GameState) =>
  Object.values(state.objects).find((object) =>
    object.name === 'Warded Wurm' && object.controller === 'p2')!

const castBolt = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  target = theirWurm(state),
) => ok(server.rules(state, {
  type: 'castSpell',
  seat: 'p1',
  objectId: named(state, 'Lightning Bolt').id,
  targets: [{ kind: 'object', objectId: target.id }],
}))

const answer = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  optionId: string,
) => server.rules(state, {
  type: 'selectOption',
  seat: 'p1',
  selectionId: pendingOptionSelection(state, 'p1')!.id,
  optionId,
})

describe('Ward with a life payment', () => {
  test('the effect is clone-safe and stamps the ward handler', () => {
    expect(structuredClone(ward({ life: 7 }))).toEqual(ward({ life: 7 }))
    expect(handlerIdsFromEffects([ward({ life: 7 })])).toEqual(['ward'])
  })

  test('targeting asks the caster privately; paying loses the life and the spell goes on', () => {
    const { server, ready } = game()
    const warded = castBolt(server, ready)
    expect(warded.stack).toHaveLength(0)
    expect(pendingOptionSelection(warded, 'p1')).toMatchObject({
      source: 'Warded Wurm',
      options: [{ id: 'pay' }, { id: 'decline' }],
      action: { kind: 'ward-life', life: 7 },
    })
    expect(pendingOptionSelection(projectForViewer(warded, 'p2'), 'p1')).toBeUndefined()
    expect(pendingOptionSelection(projectForViewer(warded, 'p1'), 'p1')).toBeDefined()

    const restarted = structuredClone(warded)
    const paid = ok(answer(server, restarted, 'pay'))
    expect(paid.players.p1.life).toBe(13)
    expect(paid.stack[0]).toMatchObject({ kind: 'spell', objectId: named(paid, 'Lightning Bolt').id })
    expect(pendingOptionSelection(paid, 'p1')).toBeUndefined()
    expect(paid.players.p1.data['ward.pendingCast']).toBeUndefined()
  })

  test('declining counters the spell without paying', () => {
    const { server, ready } = game()
    const declined = ok(answer(server, castBolt(server, ready), 'decline'))
    expect(declined.players.p1.life).toBe(20)
    expect(declined.stack).toHaveLength(0)
    expect(named(declined, 'Lightning Bolt').zone).not.toBe('stack')
    expect(pendingOptionSelection(declined, 'p1')).toBeUndefined()
    expect(declined.log.some((line) => line.includes('countered by Ward'))).toBe(true)
  })

  test('a player with less life than the cost cannot pay and the spell is countered', () => {
    const { server, ready } = game(6)
    const state = castBolt(server, ready)
    expect(pendingOptionSelection(state, 'p1')).toBeUndefined()
    expect(state.stack).toHaveLength(0)
    expect(state.players.p1.life).toBe(6)
    expect(state.log.some((line) => line.includes('countered by Ward'))).toBe(true)
  })

  test('a player with exactly enough life may pay it all and loses the game', () => {
    const { server, ready } = game(7)
    const paid = ok(answer(server, castBolt(server, ready), 'pay'))
    expect(paid.players.p1.life).toBe(0)
    expect(paid.players.p1.lost).toBe(true)
  })

  test('rejects unknown options, other seats, and other actions while the choice is open', () => {
    const { server, ready } = game()
    const warded = castBolt(server, ready)
    expect(answer(server, warded, 'bogus').ok).toBe(false)
    expect(server.rules(warded, {
      type: 'selectOption',
      seat: 'p2',
      selectionId: pendingOptionSelection(warded, 'p1')!.id,
      optionId: 'pay',
    }).ok).toBe(false)
    expect(server.rules(warded, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)
  })

  test('your own warded permanents are not warded against you', () => {
    const { server, ready } = game()
    const ownWurm = Object.values(ready.objects).find((object) =>
      object.name === 'Warded Wurm' && object.controller === 'p1')!
    const state = castBolt(server, ready, ownWurm)
    expect(pendingOptionSelection(state, 'p1')).toBeUndefined()
    expect(state.stack).toHaveLength(1)
  })

  test('also guards activated abilities, countering them when unpaid', () => {
    const { server, ready } = game()
    const activate = () => ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'poker.poke',
      seat: 'p1',
      objectId: named(ready, 'Poker').id,
      targets: [{ kind: 'object', objectId: theirWurm(ready).id }],
    }))
    const warded = activate()
    expect(pendingOptionSelection(warded, 'p1')).toBeDefined()
    expect(warded.stack).toHaveLength(0)
    const declined = ok(answer(server, warded, 'decline'))
    expect(declined.stack).toHaveLength(0)

    const paid = ok(answer(server, activate(), 'pay'))
    expect(paid.players.p1.life).toBe(13)
    expect(paid.stack[0]).toMatchObject({ kind: 'ability', abilityId: 'poker.poke' })
  })
})
