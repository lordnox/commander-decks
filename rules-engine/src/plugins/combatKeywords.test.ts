import { describe, expect, test } from 'bun:test'
import { opponentsCantBlock } from '../cardPlugins/effectBuilders'
import { serializableEffects } from '../cardPlugins/effects'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameEvent, GameState } from '../types'

const creature = (
  name: string,
  power: number,
  toughness: number,
  oracleText = '',
  extra: Partial<CardTemplate> = {},
) => cardTemplate(name, { types: ['Creature'], power, toughness, oracleText, ...extra })

/** p1 attacks p2. Every creature starts the turn able to attack and block. */
const combatGame = (p1: CardTemplate[], p2: CardTemplate[] = []) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1, p2 },
  })
  const idOf = (name: string) =>
    Object.values(server.state.objects).find((object) => object.name === name)!.id
  const state = structuredClone(server.state)
  for (const object of Object.values(state.objects)) object.summoningSickness = false
  state.step = 'declareAttackers'
  const send = (current: GameState, event: GameEvent) => ok(server.rules(current, event))
  const attackWith = (current: GameState, ...names: string[]) =>
    send(current, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: names.map((name) => ({ objectId: idOf(name), defender: 'p2' })),
    })
  const blockWith = (current: GameState, ...pairs: Array<[string, string]>) =>
    send(current, {
      type: 'declareBlockers',
      seat: 'p2',
      blockers: pairs.map(([blocker, attacker]) => ({
        blockerId: idOf(blocker),
        attackerId: idOf(attacker),
      })),
    })
  const blockError = (current: GameState, ...pairs: Array<[string, string]>) => {
    const result = server.rules(current, {
      type: 'declareBlockers',
      seat: 'p2',
      blockers: pairs.map(([blocker, attacker]) => ({
        blockerId: idOf(blocker),
        attackerId: idOf(attacker),
      })),
    })
    return result.ok ? undefined : result.error
  }
  const advance = (current: GameState) => send(current, { type: 'advanceStep' })
  /** declareAttackers -> declareBlockers, with blocks declared. */
  const toBlockers = (attackers: string[]) => advance(attackWith(state, ...attackers))
  return { server, state, idOf, send, attackWith, blockWith, blockError, advance, toBlockers }
}

describe('lifelink', () => {
  test('unblocked combat damage gains the attacker controller that much life', () => {
    const game = combatGame([creature('Leech', 3, 3, 'Lifelink')])
    let state = game.toBlockers(['Leech'])
    state = game.advance(state)
    expect(state.step).toBe('combatDamage')
    expect(state.players.p2.life).toBe(37)
    expect(state.players.p1.life).toBe(43)
  })

  test('damage to a creature gains the full amount, not just its toughness', () => {
    const game = combatGame([creature('Leech', 5, 5, 'Lifelink')], [creature('Wall', 0, 1)])
    let state = game.toBlockers(['Leech'])
    state = game.blockWith(state, ['Wall', 'Leech'])
    state = game.advance(state)
    expect(state.players.p1.life).toBe(45)
    expect(state.players.p2.life).toBe(40)
  })

  test('a lifelink blocker gains life from damage it deals to the attacker', () => {
    const game = combatGame([creature('Bear', 2, 2)], [creature('Guard', 2, 4, 'Lifelink')])
    let state = game.toBlockers(['Bear'])
    state = game.blockWith(state, ['Guard', 'Bear'])
    state = game.advance(state)
    expect(state.players.p2.life).toBe(42)
    expect(state.players.p1.life).toBe(40)
  })

  test('a creature without lifelink gains nothing', () => {
    const game = combatGame([creature('Bear', 2, 2)])
    let state = game.toBlockers(['Bear'])
    state = game.advance(state)
    expect(state.players.p1.life).toBe(40)
  })

  test('fight damage from a lifelink creature gains life', () => {
    const game = combatGame([creature('Leech', 3, 3, 'Lifelink'), creature('Target', 1, 5)])
    const state = game.send(game.state, {
      type: 'fight',
      leftId: game.idOf('Leech'),
      rightId: game.idOf('Target'),
    })
    expect(state.players.p1.life).toBe(43)
  })
})

describe('infect', () => {
  test('combat damage to a player is poison counters, not life loss', () => {
    const game = combatGame([creature('Bite', 3, 3, 'Infect')])
    let state = game.toBlockers(['Bite'])
    state = game.advance(state)
    expect(state.players.p2.poison).toBe(3)
    expect(state.players.p2.life).toBe(40)
  })

  test('ten poison counters lose the game', () => {
    const game = combatGame([creature('Bite', 10, 3, 'Infect')])
    let state = game.toBlockers(['Bite'])
    state = game.advance(state)
    expect(state.players.p2.poison).toBe(10)
    expect(state.players.p2.lost).toBe(true)
  })

  test('nine poison counters do not lose the game', () => {
    const game = combatGame([creature('Bite', 9, 3, 'Infect')])
    let state = game.toBlockers(['Bite'])
    state = game.advance(state)
    expect(state.players.p2.lost).toBe(false)
  })

  test('damage to a creature is -1/-1 counters and marks no damage', () => {
    const game = combatGame([creature('Bite', 2, 2, 'Infect')], [creature('Guard', 4, 4)])
    let state = game.toBlockers(['Bite'])
    state = game.blockWith(state, ['Guard', 'Bite'])
    state = game.advance(state)
    const guard = state.objects[game.idOf('Guard')]
    expect(guard.damageMarked).toBe(0)
    expect(guard.counters['-1/-1']).toBe(2)
    expect([guard.power, guard.toughness]).toEqual([2, 2])
  })

  test('enough -1/-1 counters kill the creature through toughness 0', () => {
    const game = combatGame([creature('Bite', 2, 4, 'Infect')], [creature('Guard', 4, 2)])
    let state = game.toBlockers(['Bite'])
    state = game.blockWith(state, ['Guard', 'Bite'])
    state = game.advance(state)
    expect(state.objects[game.idOf('Guard')].zone).toBe('graveyard')
  })
})

describe('-1/-1 counters', () => {
  test('change power and toughness and are removed again when the creature leaves', () => {
    const game = combatGame([creature('Bear', 3, 3)])
    const id = game.idOf('Bear')
    let state = game.send(game.state, { type: 'putCounters', objectId: id, counter: '-1/-1', count: 2 })
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([1, 1])
    state = game.send(state, { type: 'move', objectId: id, to: 'graveyard' })
    expect(state.objects[id].counters).toEqual({})
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([3, 3])
  })

  test('annihilate against +1/+1 counters without changing power and toughness', () => {
    const game = combatGame([creature('Bear', 3, 3)])
    const id = game.idOf('Bear')
    let state = game.send(game.state, { type: 'putCounters', objectId: id, counter: '+1/+1', count: 3 })
    state = game.send(state, { type: 'putCounters', objectId: id, counter: '-1/-1', count: 2 })
    expect(state.objects[id].counters).toEqual({ '+1/+1': 1 })
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([4, 4])
    state = game.send(state, { type: 'putCounters', objectId: id, counter: '-1/-1', count: 1 })
    expect(state.objects[id].counters).toEqual({})
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([3, 3])
  })

  test('a zero count is rejected', () => {
    const game = combatGame([creature('Bear', 3, 3)])
    const result = game.server.rules(game.state, {
      type: 'putCounters',
      objectId: game.idOf('Bear'),
      counter: '-1/-1',
      count: 0,
    })
    expect(result.ok).toBe(false)
  })
})

describe('counters and power/toughness reset on a zone change', () => {
  test('+1/+1 counters do not follow a creature to the graveyard or back', () => {
    const game = combatGame([creature('Bear', 2, 2)])
    const id = game.idOf('Bear')
    let state = game.send(game.state, { type: 'putCounters', objectId: id, counter: '+1/+1', count: 2 })
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([4, 4])
    state = game.send(state, { type: 'move', objectId: id, to: 'graveyard' })
    expect(state.objects[id].counters).toEqual({})
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([2, 2])
    state = game.send(state, { type: 'move', objectId: id, to: 'battlefield' })
    expect(state.objects[id].counters).toEqual({})
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([2, 2])
  })
})

describe('blocking flying, reach and menace', () => {
  test('a creature without flying or reach cannot block a flyer', () => {
    const game = combatGame([creature('Drake', 2, 2, 'Flying')], [creature('Bear', 2, 2)])
    const state = game.toBlockers(['Drake'])
    expect(game.blockError(state, ['Bear', 'Drake'])).toContain('flying')
  })

  test('flying and reach creatures can block a flyer', () => {
    const game = combatGame(
      [creature('Drake', 2, 2, 'Flying')],
      [creature('Hawk', 2, 2, 'Flying'), creature('Spider', 2, 2, 'Reach')],
    )
    const state = game.toBlockers(['Drake'])
    expect(game.blockError(state, ['Hawk', 'Drake'])).toBeUndefined()
    expect(game.blockError(state, ['Spider', 'Drake'])).toBeUndefined()
  })

  test('a flyer can block a ground creature', () => {
    const game = combatGame([creature('Bear', 2, 2)], [creature('Hawk', 2, 2, 'Flying')])
    const state = game.toBlockers(['Bear'])
    expect(game.blockError(state, ['Hawk', 'Bear'])).toBeUndefined()
  })

  test('menace rejects a lone blocker and accepts two', () => {
    const game = combatGame(
      [creature('Brute', 3, 3, 'Menace')],
      [creature('Bear A', 2, 2), creature('Bear B', 2, 2)],
    )
    const state = game.toBlockers(['Brute'])
    expect(game.blockError(state, ['Bear A', 'Brute'])).toContain('menace')
    expect(game.blockError(state, ['Bear A', 'Brute'], ['Bear B', 'Brute'])).toBeUndefined()
    const blocked = game.blockWith(state, ['Bear A', 'Brute'], ['Bear B', 'Brute'])
    expect(blocked.objects[game.idOf('Bear A')].blocking).toBe(game.idOf('Brute'))
    expect(blocked.objects[game.idOf('Bear B')].blocking).toBe(game.idOf('Brute'))
  })

  test('menace is satisfied by declaring no blockers at all', () => {
    const game = combatGame([creature('Brute', 3, 3, 'Menace')], [creature('Bear', 2, 2)])
    const state = game.blockWith(game.toBlockers(['Brute']))
    expect(state.objects[game.idOf('Brute')].blocked).toBeUndefined()
  })

  test('two blockers may gang-block an attacker without menace', () => {
    const game = combatGame(
      [creature('Brute', 3, 3)],
      [creature('Bear A', 2, 2), creature('Bear B', 2, 2)],
    )
    const state = game.toBlockers(['Brute'])
    expect(game.blockError(state, ['Bear A', 'Brute'], ['Bear B', 'Brute'])).toBeUndefined()
  })

  test('a creature cannot block twice, in one declaration or after blocking already', () => {
    const game = combatGame(
      [creature('Brute', 3, 3), creature('Other', 3, 3)],
      [creature('Bear', 2, 2)],
    )
    const state = game.toBlockers(['Brute', 'Other'])
    expect(game.blockError(state, ['Bear', 'Brute'], ['Bear', 'Other'])).toContain('only block once')
    const blocked = game.blockWith(state, ['Bear', 'Brute'])
    expect(game.blockError(blocked, ['Bear', 'Other'])).toContain('only block once')
  })

  test('gang-blocking a non-trampler splits lethal damage and the rest goes to the last blocker', () => {
    const game = combatGame(
      [creature('Brute', 5, 5)],
      [creature('Bear A', 2, 2), creature('Bear B', 2, 3)],
    )
    let state = game.toBlockers(['Brute'])
    state = game.blockWith(state, ['Bear A', 'Brute'], ['Bear B', 'Brute'])
    state = game.advance(state)
    expect(state.objects[game.idOf('Bear A')].zone).toBe('graveyard')
    expect(state.objects[game.idOf('Bear B')].zone).toBe('graveyard')
    expect(state.players.p2.life).toBe(40)
    // 2 + 2 combined from the blockers, so the 5/5 survives.
    expect(state.objects[game.idOf('Brute')].zone).toBe('battlefield')
  })
})

const winnower = (predicate: Parameters<typeof opponentsCantBlock>[0] = { parity: 'even' }) =>
  cardTemplate('Fixture Winnower', {
    types: ['Creature'],
    power: 1,
    toughness: 1,
    effects: serializableEffects([opponentsCantBlock(predicate)]),
  })

const withValue = (name: string, manaValue: number) =>
  creature(name, 2, 2, '', { manaValue })

describe('opponents can not block with creatures matching a mana value predicate', () => {
  test('even mana values, including zero, cannot block; odd ones can', () => {
    const game = combatGame(
      [winnower(), creature('Runner', 2, 2)],
      [withValue('Zero', 0), withValue('Two', 2), withValue('Three', 3)],
    )
    const state = game.toBlockers(['Runner'])
    expect(game.blockError(state, ['Zero', 'Runner'])).toContain("can't block")
    expect(game.blockError(state, ['Two', 'Runner'])).toContain("can't block")
    expect(game.blockError(state, ['Three', 'Runner'])).toBeUndefined()
  })

  test('odd mana values and ranges are supported', () => {
    const odd = combatGame(
      [winnower({ parity: 'odd' }), creature('Runner', 2, 2)],
      [withValue('Two', 2), withValue('Three', 3)],
    )
    const oddState = odd.toBlockers(['Runner'])
    expect(odd.blockError(oddState, ['Three', 'Runner'])).toContain("can't block")
    expect(odd.blockError(oddState, ['Two', 'Runner'])).toBeUndefined()

    const range = combatGame(
      [winnower({ min: 3, max: 4 }), creature('Runner', 2, 2)],
      [withValue('Two', 2), withValue('Four', 4), withValue('Five', 5)],
    )
    const rangeState = range.toBlockers(['Runner'])
    expect(range.blockError(rangeState, ['Four', 'Runner'])).toContain("can't block")
    expect(range.blockError(rangeState, ['Two', 'Runner'])).toBeUndefined()
    expect(range.blockError(rangeState, ['Five', 'Runner'])).toBeUndefined()
  })

  test('the controller is not restricted by its own permanent', () => {
    const game = combatGame(
      [withValue('Attacker', 4)],
      [winnower(), withValue('Even', 2)],
    )
    // p2 controls the restricting permanent, so p2's own even blocker is fine.
    const state = game.toBlockers(['Attacker'])
    expect(game.blockError(state, ['Even', 'Attacker'])).toBeUndefined()
  })

  test('a phased-out source no longer restricts', () => {
    const game = combatGame([winnower(), creature('Runner', 2, 2)], [withValue('Two', 2)])
    const phased = structuredClone(game.state)
    phased.objects[game.idOf('Fixture Winnower')].phasedOut = true
    const state = game.advance(game.attackWith(phased, 'Runner'))
    expect(game.blockError(state, ['Two', 'Runner'])).toBeUndefined()
  })

  test('the restriction ends when the source leaves the battlefield', () => {
    const game = combatGame([winnower(), creature('Runner', 2, 2)], [withValue('Two', 2)])
    let state = game.attackWith(game.state, 'Runner')
    state = game.send(state, {
      type: 'move',
      objectId: game.idOf('Fixture Winnower'),
      to: 'graveyard',
    })
    state = game.advance(state)
    expect(game.blockError(state, ['Two', 'Runner'])).toBeUndefined()
  })
})

describe('first strike and double strike', () => {
  test('a first striker kills its blocker before the blocker deals damage', () => {
    const game = combatGame([creature('Duelist', 2, 2, 'First strike')], [creature('Bear', 2, 2)])
    let state = game.toBlockers(['Duelist'])
    state = game.blockWith(state, ['Bear', 'Duelist'])
    state = game.advance(state)
    expect(state.step).toBe('firstStrikeDamage')
    // State-based actions already ran between the two damage steps.
    expect(state.objects[game.idOf('Bear')].zone).toBe('graveyard')
    state = game.advance(state)
    expect(state.step).toBe('combatDamage')
    expect(state.objects[game.idOf('Duelist')].zone).toBe('battlefield')
    expect(state.objects[game.idOf('Duelist')].damageMarked).toBe(0)
  })

  test('a first-strike blocker kills the attacker first', () => {
    const game = combatGame([creature('Bear', 2, 2)], [creature('Duelist', 2, 2, 'First strike')])
    let state = game.toBlockers(['Bear'])
    state = game.blockWith(state, ['Duelist', 'Bear'])
    state = game.advance(state)
    expect(state.objects[game.idOf('Bear')].zone).toBe('graveyard')
    expect(state.objects[game.idOf('Duelist')].damageMarked).toBe(0)
  })

  test('two first strikers trade in the first step', () => {
    const game = combatGame(
      [creature('Duelist A', 2, 2, 'First strike')],
      [creature('Duelist B', 2, 2, 'First strike')],
    )
    let state = game.toBlockers(['Duelist A'])
    state = game.blockWith(state, ['Duelist B', 'Duelist A'])
    state = game.advance(state)
    expect(state.objects[game.idOf('Duelist A')].zone).toBe('graveyard')
    expect(state.objects[game.idOf('Duelist B')].zone).toBe('graveyard')
  })

  test('creatures without first strike deal no damage in the first step', () => {
    const game = combatGame(
      [creature('Duelist', 2, 2, 'First strike'), creature('Bear', 3, 3)],
    )
    let state = game.toBlockers(['Duelist', 'Bear'])
    state = game.advance(state)
    expect(state.step).toBe('firstStrikeDamage')
    expect(state.players.p2.life).toBe(38)
    state = game.advance(state)
    // The first striker does not deal damage a second time.
    expect(state.players.p2.life).toBe(35)
  })

  test('a double striker deals damage in both steps', () => {
    const game = combatGame([creature('Twin', 3, 3, 'Double strike')])
    let state = game.toBlockers(['Twin'])
    state = game.advance(state)
    expect(state.step).toBe('firstStrikeDamage')
    expect(state.players.p2.life).toBe(37)
    state = game.advance(state)
    expect(state.players.p2.life).toBe(34)
  })

  test('double strike with lifelink gains life twice', () => {
    const game = combatGame([creature('Twin', 3, 3, 'Double strike, lifelink')])
    let state = game.toBlockers(['Twin'])
    state = game.advance(game.advance(state))
    expect(state.players.p1.life).toBe(46)
  })

  test('a blocked double striker deals nothing to the player once its blocker is dead', () => {
    const game = combatGame([creature('Twin', 3, 3, 'Double strike')], [creature('Bear', 2, 2)])
    let state = game.toBlockers(['Twin'])
    state = game.blockWith(state, ['Bear', 'Twin'])
    state = game.advance(state)
    expect(state.objects[game.idOf('Bear')].zone).toBe('graveyard')
    state = game.advance(state)
    expect(state.players.p2.life).toBe(40)
  })

  test('a blocked double-striking trampler sends everything through once its blocker is dead', () => {
    const game = combatGame(
      [creature('Twin', 3, 3, 'Double strike, trample')],
      [creature('Bear', 2, 2)],
    )
    let state = game.toBlockers(['Twin'])
    state = game.blockWith(state, ['Bear', 'Twin'])
    state = game.advance(state)
    // 2 lethal to the bear, 1 tramples over.
    expect(state.players.p2.life).toBe(39)
    state = game.advance(state)
    expect(state.players.p2.life).toBe(36)
  })

  test('without a first or double striker there is only the regular damage step', () => {
    const game = combatGame([creature('Bear', 2, 2)])
    let state = game.toBlockers(['Bear'])
    state = game.advance(state)
    expect(state.step).toBe('combatDamage')
  })
})
