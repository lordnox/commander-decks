import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { ok } from '../testHelpers'
import { lifeGainedThisTurn, lifeLostThisTurn } from '../plugins/life'
import { activated } from './activated'
import { castCosts } from './castCosts'
import { onResolve } from './onResolve'
import { targetedResolve } from './targetedResolve'

const card = (name: string, types: string[], manaCost = '') =>
  cardTemplate(name, { types, manaCost })

const plugins = [activated, castCosts, onResolve, targetedResolve]

const withMana = (
  state: ReturnType<typeof structuredClone>,
  seat: string,
  mana: Partial<Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', number>>,
) => {
  Object.assign(state.players[seat].mana, mana)
  return state
}

describe('reusable life-total rules', () => {
  test('accounts for gains, losses, exact payments, setting, and exchange', () => {
    const server = createServerGame(commanderRules, {}, { random: () => 0.5 })
    let state = ok(server.rules(server.state, {
      type: 'loseLife',
      seat: 'p1',
      amount: 7,
      source: 'test',
    }))
    state = ok(server.rules(state, {
      type: 'gainLife',
      seat: 'p1',
      amount: 3,
      source: 'test',
    }))
    state = ok(server.rules(state, {
      type: 'payLife',
      seat: 'p1',
      amount: 5,
      source: 'test',
    }))
    expect(state.players.p1.life).toBe(31)
    expect(lifeLostThisTurn(state.players.p1)).toBe(12)
    expect(lifeGainedThisTurn(state.players.p1)).toBe(3)
    // CR 119.4: a payment is legal while the life total is at least the amount.
    expect(server.rules(state, {
      type: 'payLife',
      seat: 'p1',
      amount: 31,
    }).ok).toBe(true)
    expect(server.rules(state, {
      type: 'payLife',
      seat: 'p1',
      amount: 32,
    }).ok).toBe(false)

    state = ok(server.rules(state, {
      type: 'setLifeTotal',
      seat: 'p2',
      total: 12,
    }))
    state = ok(server.rules(state, {
      type: 'exchangeLifeTotals',
      first: 'p1',
      second: 'p2',
    }))
    expect([state.players.p1.life, state.players.p2.life]).toEqual([12, 31])
    expect(lifeLostThisTurn(state.players.p1)).toBe(31)
    expect(lifeGainedThisTurn(state.players.p2)).toBe(19)
  })
})

describe('Lady Evangela life-total and X cards', () => {
  test('Debt to the Deathless pays X mana and drains for twice X', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [card('Debt to the Deathless', ['Sorcery'], '{X}{W}{W}{B}{B}')] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = withMana(structuredClone(server.state), 'p1', { W: 2, B: 2, C: 3 })
    const spell = ready.zoneOrder.p1.hand[0]
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      x: 3,
    }))
    expect(Object.values(cast.players.p1.mana).reduce((total, amount) => total + amount, 0))
      .toBe(0)
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.players.p1.life).toBe(58)
    expect(resolved.playerOrder.slice(1).map((seat) => resolved.players[seat].life))
      .toEqual([34, 34, 34])
  })

  test('Drain Life requires black X and gains no more than the target had', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [card('Drain Life', ['Sorcery'], '{X}{1}{B}')] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const spell = server.state.zoneOrder.p1.hand[0]
    const colorless = withMana(structuredClone(server.state), 'p1', { B: 1, C: 4 })
    expect(server.rules(colorless, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      x: 3,
      targets: [{ kind: 'player', player: 'p2' }],
    }).ok).toBe(false)

    const ready = withMana(structuredClone(server.state), 'p1', { B: 4, C: 1 })
    ready.players.p2.life = 2
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      x: 3,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.players.p1.life).toBe(42)
    expect(resolved.players.p2.lost).toBe(true)

    const creatureServer = createServerGame(
      commanderRules,
      {
        hands: { p1: [card('Drain Life', ['Sorcery'], '{X}{1}{B}')] },
        battlefield: {
          p2: [cardTemplate('Two-Toughness Creature', {
            types: ['Creature'],
            power: 2,
            toughness: 2,
          })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const creatureReady = withMana(
      structuredClone(creatureServer.state),
      'p1',
      { B: 4, C: 1 },
    )
    const target = creatureReady.zoneOrder.p2.battlefield[0]
    const creatureCast = ok(creatureServer.rules(creatureReady, {
      type: 'castSpell',
      seat: 'p1',
      objectId: creatureReady.zoneOrder.p1.hand[0],
      x: 3,
      targets: [{ kind: 'object', objectId: target }],
    }))
    const creatureResolved = ok(creatureServer.rules(creatureCast, { type: 'resolveTop' }))
    expect(creatureResolved.players.p1.life).toBe(42)
    expect(creatureResolved.objects[target].zone).toBe('graveyard')
  })

  test('Repay in Kind sets every player to the lowest life and records losses', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [card('Repay in Kind', ['Sorcery'], '{5}{B}{B}')] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = withMana(structuredClone(server.state), 'p1', { B: 2, C: 5 })
    ready.players.p2.life = 7
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: ready.zoneOrder.p1.hand[0],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.playerOrder.map((seat) => resolved.players[seat].life))
      .toEqual([7, 7, 7, 7])
    expect(lifeLostThisTurn(resolved.players.p1)).toBe(33)
  })

  test('Mirror Universe enumerates opponents and exchanges during its controller upkeep', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [card('Mirror Universe', ['Artifact'], '{6}')] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.step = 'upkeep'
    ready.players.p1.life = 3
    const mirror = ready.zoneOrder.p1.battlefield[0]
    const action = legalActsFor(ready, 'p1').find((candidate) =>
      candidate.kind === 'activateAbility'
      && candidate.abilityId === 'mirrorUniverse.exchange')
    expect(action).toMatchObject({
      kind: 'activateAbility',
      targetGroups: [{ label: 'Opponent', kind: 'player' }],
    })
    const activatedState = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'mirrorUniverse.exchange',
      seat: 'p1',
      objectId: mirror,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    expect(activatedState.objects[mirror].zone).toBe('graveyard')
    const resolved = ok(server.rules(activatedState, { type: 'resolveTop' }))
    expect([resolved.players.p1.life, resolved.players.p2.life]).toEqual([40, 3])
  })

  test('Mister Negative uses typed optional player selection and draws life lost', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [card('Mister Negative', ['Creature'], '{5}{W}{B}')] },
        libraries: {
          p1: Array.from({ length: 30 }, (_, index) =>
            card(`Card ${index + 1}`, ['Instant'])),
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const mister = server.state.zoneOrder.p1.hand[0]
    let state = structuredClone(server.state)
    state.players.p2.life = 10
    state = ok(server.rules(state, { type: 'move', objectId: mister, to: 'battlefield' }))
    const targetChoice = pendingPlayerSelectionFor(state, 'p1')!
    expect(targetChoice).toMatchObject({ min: 1, max: 1, candidates: ['p2', 'p3', 'p4'] })
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: targetChoice.id,
      players: ['p2'],
    }))
    expect(state.stack[0]?.targets).toEqual([{ kind: 'player', player: 'p2' }])
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const exchangeChoice = pendingPlayerSelectionFor(state, 'p1')!
    expect(exchangeChoice).toMatchObject({ min: 0, max: 1, candidates: ['p2'] })
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: exchangeChoice.id,
      players: ['p2'],
    }))
    expect([state.players.p1.life, state.players.p2.life]).toEqual([10, 40])
    expect(state.zoneOrder.p1.hand).toHaveLength(30)
  })

  test('Test of Endurance checks its intervening if again on resolution', () => {
    const makeState = () => {
      const server = createServerGame(
        commanderRules,
        { battlefield: { p1: [card('Test of Endurance', ['Enchantment'], '{2}{W}{W}')] } },
        { random: () => 0.5, cardPlugins: plugins },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.life = 50
      ready.step = 'untap'
      return { server, ready }
    }

    const first = makeState()
    let state = ok(first.server.rules(first.ready, { type: 'advanceStep' }))
    expect(state.stack[0]?.name).toBe('Test of Endurance')
    state = ok(first.server.rules(state, { type: 'loseLife', seat: 'p1', amount: 1 }))
    state = ok(first.server.rules(state, { type: 'resolveTop' }))
    expect(state.ended).toBe(false)

    const second = makeState()
    state = ok(second.server.rules(second.ready, { type: 'advanceStep' }))
    state = ok(second.server.rules(state, { type: 'resolveTop' }))
    expect(state.ended).toBe(true)
    expect(state.players.p1.lost).toBe(false)
  })

  test('Wall of Blood and Selenia support repeatable exact life payments', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            cardTemplate('Wall of Blood', {
              types: ['Creature'],
              power: 0,
              toughness: 2,
            }),
            cardTemplate('Selenia, Dark Angel', {
              types: ['Creature'],
              power: 3,
              toughness: 3,
            }),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = structuredClone(server.state)
    state.players.p1.life = 3
    const wall = state.zoneOrder.p1.battlefield[0]
    const selenia = state.zoneOrder.p1.battlefield[1]
    for (let index = 0; index < 2; index += 1) {
      state = ok(server.rules(state, {
        type: 'activateAbility',
        abilityId: 'wallOfBlood.pump',
        seat: 'p1',
        objectId: wall,
      }))
    }
    expect(state.players.p1.life).toBe(1)
    expect(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'selenia.return',
      seat: 'p1',
      objectId: selenia,
    }).ok).toBe(false)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[wall]).toMatchObject({ power: 2, toughness: 4 })
    state = ok(server.rules(state, { type: 'gainLife', seat: 'p1', amount: 2 }))
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'selenia.return',
      seat: 'p1',
      objectId: selenia,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.players.p1.life).toBe(1)
    expect(state.objects[selenia].zone).toBe('hand')
  })

  test('Children of Korlis and Tainted Sigil recover tracked life loss', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            card('Children of Korlis', ['Creature'], '{W}'),
            card('Tainted Sigil', ['Artifact'], '{1}{W}{B}'),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = ok(server.rules(server.state, { type: 'loseLife', seat: 'p1', amount: 6 }))
    state = ok(server.rules(state, { type: 'loseLife', seat: 'p2', amount: 4 }))
    const children = state.zoneOrder.p1.battlefield[0]
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'childrenOfKorlis.recover',
      seat: 'p1',
      objectId: children,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.players.p1.life).toBe(40)

    const sigil = state.zoneOrder.p1.battlefield[0]
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'taintedSigil.recover',
      seat: 'p1',
      objectId: sigil,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.players.p1.life).toBe(50)
  })

  test('Necrologia is end-step-only, pays chosen life, and draws X', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Necrologia', {
            types: ['Instant'],
            manaCost: '{3}{B}{B}',
            oracleText:
              'Cast this spell only during your end step.\nAs an additional cost to cast this spell, pay X life.\nDraw X cards.',
          })],
        },
        libraries: {
          p1: Array.from({ length: 4 }, (_, index) => card(`Draw ${index}`, ['Instant'])),
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const spell = server.state.zoneOrder.p1.hand[0]
    const main = withMana(structuredClone(server.state), 'p1', { B: 2, C: 3 })
    expect(server.rules(main, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      x: 4,
    }).ok).toBe(false)

    const ready = structuredClone(main)
    ready.step = 'end'
    const xValues = legalActsFor(ready, 'p1')
      .filter((action) => action.kind === 'castSpell' && action.objectId === spell)
      .map((action) => action.x)
    expect(xValues).toContain(4)
    let state = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      x: 4,
    }))
    expect(state.players.p1.life).toBe(36)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(4)
  })

  test('Blood Celebrant naturally exposes five live mana choices and pays life', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [card('Blood Celebrant', ['Creature'], '{B}')] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = withMana(structuredClone(server.state), 'p1', { B: 1 })
    const celebrant = ready.zoneOrder.p1.battlefield[0]
    const actions = legalActsFor(ready, 'p1').filter((action) =>
      action.kind === 'activateAbility'
      && action.abilityId === 'bloodCelebrant.mana')
    expect(actions.map((action) => action.mana).sort()).toEqual(['B', 'G', 'R', 'U', 'W'])
    const state = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'bloodCelebrant.mana',
      seat: 'p1',
      objectId: celebrant,
      manaAbility: true,
      choices: ['U'],
    }))
    expect(state.players.p1.life).toBe(39)
    expect(state.players.p1.mana.U).toBe(1)
    expect(state.players.p1.mana.B).toBe(0)
  })
})
