import type { GameState } from '../types'
import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok, resolveStack } from '../testHelpers'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { lifeGainedThisTurn, lifeLostThisTurn } from '../plugins/life'
import { activated } from './activated'
import { castCosts } from './castCosts'
import { gainLife, loseLife, triggerOn } from './effects'
import { onResolve } from './onResolve'
import { targetedResolve } from './targetedResolve'
const card = (name: string, types: string[], manaCost = '') =>
  cardTemplate(name, { types, manaCost })

const plugins = [activated, castCosts, onResolve, targetedResolve]

const withMana = (
  state: GameState,
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
      && candidate.abilityId === '$.abilities[0]')
    expect(action).toMatchObject({
      kind: 'activateAbility',
      targetGroups: [{ kind: 'player', targets: [{ objectId: 'p2' }, { objectId: 'p3' }, { objectId: 'p4' }] }],
    })
    const activatedState = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: mirror,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    expect(activatedState.objects[mirror].zone).toBe('graveyard')
    const resolved = ok(server.rules(activatedState, { type: 'resolveTop' }))
    expect([resolved.players.p1.life, resolved.players.p2.life]).toEqual([40, 3])
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
        abilityId: '$.abilities[0]',
        seat: 'p1',
        objectId: wall,
      }))
    }
    expect(state.players.p1.life).toBe(1)
    expect(server.rules(state, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: selenia,
    }).ok).toBe(false)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[wall]).toMatchObject({ power: 2, toughness: 4 })
    state = ok(server.rules(state, { type: 'gainLife', seat: 'p1', amount: 2 }))
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
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
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: children,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.players.p1.life).toBe(40)

    const sigil = state.zoneOrder.p1.battlefield[0]
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
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
      .filter((action) => action.kind === 'castSpell')
      .filter((action) => action.objectId === spell)
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

  test('Blood Celebrant opens five canonical mana choices and pays life', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [card('Blood Celebrant', ['Creature'], '{B}')] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = withMana(structuredClone(server.state), 'p1', { B: 1 })
    const celebrant = ready.zoneOrder.p1.battlefield[0]
    const actions = legalActsFor(ready, 'p1').filter((action) => action.kind === 'activateAbility')
      .filter((action) => action.abilityId === '$.abilities[0]')
    expect(actions).toHaveLength(1)
    let state = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: celebrant,
      manaAbility: true,
    }))
    const pending = pendingOptionSelection(state, 'p1')!
    expect(pending.options.map(option => option.label)).toEqual(['W', 'U', 'B', 'R', 'G'])
    state = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: pending.options.find(option => option.label === 'U')!.id }))
    expect(state.stack).toHaveLength(0)
    expect(state.players.p1.life).toBe(39)
    expect(state.players.p1.mana.U).toBe(1)
    expect(state.players.p1.mana.B).toBe(0)
  })
})

describe('life-effect player choices', () => {
  test('Wall of Shards adds age counters, validates each opponent payment, and sacrifices', () => {
    const server = createServerGame(commanderRules, {
      players: 4,
      battlefield: { p1: [cardTemplate('Wall of Shards')] },
    }, { random: () => 0.5 })
    const wall = server.state.zoneOrder.p1.battlefield[0]!
    let choosing = structuredClone(server.state)
    choosing.step = 'untap'
    choosing = ok(server.rules(choosing, { type: 'advanceStep' }))
    choosing = ok(server.rules(choosing, { type: 'resolveTop' }))
    const first = pendingOptionSelection(choosing, 'p1')!
    expect(choosing.objects[wall]!.counters.age).toBe(1)
    expect(pendingOptionSelection(server.project(choosing, 'p1'), 'p1')).toBeDefined()
    expect(server.project(choosing, 'p2').players.p1.data['kernel.pendingOptionSelection']).toBeUndefined()
    expect(server.rules(choosing, {
      type: 'selectOption', seat: 'p2', selectionId: first.id, optionId: 'instruction:0',
    }).ok).toBe(false)
    choosing = ok(server.rules(choosing, {
      type: 'selectOption', seat: 'p1', selectionId: first.id, optionId: 'instruction:0',
    }))
    const recipient = pendingPlayerSelectionFor(choosing, 'p1')!
    expect(recipient.candidates).toEqual(['p2', 'p3', 'p4'])
    expect(server.rules(choosing, {
      type: 'selectPlayers', seat: 'p1', selectionId: recipient.id, players: [],
    }).ok).toBe(false)
    expect(pendingPlayerSelectionFor(server.project(choosing, 'p2'), 'p1')).toBeUndefined()
    choosing = ok(server.rules(choosing, {
      type: 'selectPlayers', seat: 'p1', selectionId: recipient.id, players: ['p2'],
    }))
    expect(choosing.players.p2.life).toBe(41)

    let next = structuredClone(choosing)
    next.step = 'untap'
    next.active = 'p1'
    next.priority = 'p1'
    next = ok(server.rules(next, { type: 'advanceStep' }))
    next = ok(server.rules(next, { type: 'resolveTop' }))
    const second = pendingOptionSelection(next, 'p1')!
    expect(next.objects[wall]!.counters.age).toBe(2)
    const paidSecond = ok(server.rules(structuredClone(next), {
      type: 'selectOption', seat: 'p1', selectionId: second.id, optionId: 'instruction:0',
    }))
    const secondRecipient = pendingPlayerSelectionFor(paidSecond, 'p1')!
    const paidOnce = ok(server.rules(paidSecond, {
      type: 'selectPlayers', seat: 'p1', selectionId: secondRecipient.id, players: ['p2'],
    }))
    const repeatedRecipient = pendingPlayerSelectionFor(paidOnce, 'p1')!
    const paidAgain = ok(server.rules(paidOnce, {
      type: 'selectPlayers', seat: 'p1', selectionId: repeatedRecipient.id, players: ['p2'],
    }))
    expect(paidAgain.players.p2.life).toBe(43)
    expect(paidAgain.objects[wall]!.counters.age).toBe(2)
    expect(pendingPlayerSelectionFor(paidAgain, 'p1')).toBeUndefined()
    next = ok(server.rules(next, {
      type: 'selectOption', seat: 'p1', selectionId: second.id, optionId: 'instruction:1',
    }))
    expect(next.objects[wall]!.zone).toBe('graveyard')
    expect(pendingOptionSelection(next, 'p1')).toBeUndefined()
  })

  test('Queza queues a typed opponent choice and drains only the chosen player', () => {
    const server = createServerGame(commanderRules, {
      players: 4,
      libraries: { p1: [cardTemplate('Draw fixture')] },
      battlefield: { p1: [cardTemplate('Queza, Augur of Agonies')] },
    }, { random: () => 0.5 })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    const pending = pendingPlayerSelectionFor(state, 'p1')!
    expect(pending.candidates).toEqual(['p2', 'p3', 'p4'])
    expect(pendingPlayerSelectionFor(server.project(state, 'p2'), 'p1')).toBeUndefined()
    state = ok(server.rules(state, {
      type: 'selectPlayers', selectionId: pending.id, seat: 'p1', players: ['p3'],
    }))
    state = resolveStack(server.rules, state)
    expect(state.players.p1.life).toBe(41)
    expect(state.players.p2.life).toBe(40)
    expect(state.players.p3.life).toBe(39)
  })

  test('opponents do not see the pending Niv-Mizzet payment in projection', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [cardTemplate('Niv card A'), cardTemplate('Niv card B')] },
      battlefield: { p1: [cardTemplate('Niv-Mizzet, Ghost Counsel')] },
    }, { random: () => 0.5 })
    const gained = ok(server.rules(server.state, { type: 'gainLife', seat: 'p1', amount: 1, source: 'test' }))
    const offered = resolveStack(server.rules, gained)
    expect(pendingOptionSelection(offered, 'p1')).toBeDefined()
    expect(pendingOptionSelection(server.project(offered, 'p2'), 'p1')).toBeUndefined()
  })

  test('host restart keeps the open Niv-Mizzet optional life payment', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [cardTemplate('Niv card A'), cardTemplate('Niv card B'), cardTemplate('Niv card C')] },
      battlefield: { p1: [cardTemplate('Niv-Mizzet, Ghost Counsel')] },
    }, { random: () => 0.5 })
    const gained = ok(server.rules(server.state, { type: 'gainLife', seat: 'p1', amount: 2, source: 'test' }))
    const offered = resolveStack(server.rules, gained)
    const restarted = JSON.parse(JSON.stringify(offered)) as GameState
    const payment = pendingOptionSelection(restarted, 'p1')!
    expect(payment).toMatchObject({
      seat: 'p1',
      source: 'Niv-Mizzet, Ghost Counsel',
      action: { kind: 'canonicalResolutionPayment', cost: { kind: 'life' } },
    })
    const stackId = payment.action.kind === 'canonicalResolutionPayment' ? payment.action.stackId : undefined
    expect(restarted.stack.find(item => item.id === stackId)?.execution?.occurrence)
      .toMatchObject({ eventType: 'gainLife', player: 'p1', amount: 2 })
    const handBefore = restarted.zoneCounts.p1.hand
    const paid = ok(server.rules(restarted, {
      type: 'selectOption', seat: 'p1', selectionId: payment.id, optionId: 'pay',
    }))
    expect(paid.players.p1.life).toBe(40)
    expect(paid.zoneCounts.p1.hand).toBe(handBefore + 2)
  })
})

describe('combat damage life swap', () => {
  test('combat damage to a watcher gains that much life and the attacker loses it', () => {
    const watcher = cardTemplate('Faultless Watcher', {
      types: ['Creature'],
      power: 0,
      toughness: 4,
      effects: [triggerOn('dealtCombatDamage', {
        do: [
          gainLife('triggerAmount'),
          loseLife('triggerAmount', 'triggeringPlayer'),
        ],
      })],
    })
    const attacker = cardTemplate('Hill Giant', {
      types: ['Creature'],
      power: 3,
      toughness: 3,
    })
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [watcher], p2: [attacker] },
    })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Hill Giant')!
    const recipient = Object.values(server.state.objects)
      .find((object) => object.name === 'Faultless Watcher')!
    const triggered = ok(server.rules(server.state, {
      type: 'combatDamage',
      sourceId: source.id,
      target: { kind: 'object', objectId: recipient.id },
      amount: 3,
    }))

    expect(triggered.stack[0]).toMatchObject({
      kind: 'ability',
      name: 'Faultless Watcher',
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

  test('the combat-damage life swap still resolves after lethal damage', () => {
    const watcher = cardTemplate('Faultless Watcher', {
      types: ['Creature'],
      power: 0,
      toughness: 4,
      effects: [triggerOn('dealtCombatDamage', {
        do: [
          gainLife('triggerAmount'),
          loseLife('triggerAmount', 'triggeringPlayer'),
        ],
      })],
    })
    const attacker = cardTemplate('Hill Giant', {
      types: ['Creature'],
      power: 3,
      toughness: 3,
    })
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [watcher], p2: [attacker] },
    })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Hill Giant')!
    const recipient = Object.values(server.state.objects)
      .find((object) => object.name === 'Faultless Watcher')!
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

  test('noncombat damage and damage the watcher deals do not trigger the swap', () => {
    const watcher = cardTemplate('Faultless Watcher', {
      types: ['Creature'],
      power: 0,
      toughness: 4,
      effects: [triggerOn('dealtCombatDamage', {
        do: [
          gainLife('triggerAmount'),
          loseLife('triggerAmount', 'triggeringPlayer'),
        ],
      })],
    })
    const attacker = cardTemplate('Hill Giant', {
      types: ['Creature'],
      power: 3,
      toughness: 3,
    })
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [watcher], p2: [attacker] },
    })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Hill Giant')!
    const recipient = Object.values(server.state.objects)
      .find((object) => object.name === 'Faultless Watcher')!
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
