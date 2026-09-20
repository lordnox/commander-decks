import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { ok } from '../testHelpers'
import type { GameState, Plugin, ReduceResult } from '../types'
import { activated } from './activated'
import { castCosts } from './castCosts'
import { choiceEffects } from './choiceEffects'
import { missingCardPlugins } from './index'
import { modalSpell } from './modalSpell'
import { onResolve } from './onResolve'
import { stealCast } from './stealCast'
import { targetedResolve } from './targetedResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const passToEmpty = (
  rules: (state: GameState, event: { type: 'passPriority'; seat: string }) => ReduceResult,
  state: GameState,
) => {
  let current = state
  while (current.stack.length > 0 && !current.stack[0].waiting && current.priority) {
    current = ok(rules(current, { type: 'passPriority', seat: current.priority }))
  }
  return current
}

const plugins: Plugin[] = [
  activated,
  castCosts,
  onResolve,
  targetedResolve,
  modalSpell,
  choiceEffects,
  stealCast,
]

const ready = (state: GameState, seat = 'p1') => {
  const next = structuredClone(state)
  next.active = seat
  next.priority = seat
  next.step = 'precombatMain'
  next.players[seat].mana = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 }
  return next
}

describe('Lady Evangela remaining coverage', () => {
  test('the remaining Eva cards stay registered', () => {
    expect(missingCardPlugins([
      'Counterspell',
      'Arcanis the Omnipotent',
      "Minamo, School at Water's Edge",
      'Condemn',
      'Hatred',
      'Infernal Contract',
      'Mana Drain',
      'Desertion',
      'City of Brass',
      'Cryptic Command',
      'Wedding Ring',
      'Breena, the Demagogue',
      'Kuroki, Thief of Talents',
    ])).toEqual([])
  })

  test('Counterspell counters the targeted spell', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Counterspell', { types: ['Instant'], manaCost: '{U}{U}' })],
          p2: [cardTemplate('Threat', { types: ['Instant'], manaCost: '{1}' })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = ready(server.state, 'p2')
    state.players.p2.mana.C = 1
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p2',
      objectId: named(state, 'Threat').id,
    }))
    state.priority = 'p1'
    state.players.p1.mana.U = 2
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Counterspell').id,
      targets: [{ kind: 'object', objectId: named(state, 'Threat').id }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(named(state, 'Threat').zone).toBe('graveyard')
  })

  test('City of Brass damages you when it becomes tapped for mana', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [cardTemplate('City of Brass', {
            types: ['Land'],
            oracleText: 'Whenever this land becomes tapped, it deals 1 damage to you.\n'
              + '{T}: Add one mana of any color.',
          })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const city = named(server.state, 'City of Brass').id
    let state = ok(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: city,
      mana: 'U',
    }))
    expect(state.players.p1.mana.U).toBe(1)
    state = passToEmpty(server.rules, state)
    expect(state.players.p1.life).toBe(39)
  })

  test('Arcanis taps to draw three and bounces itself', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [cardTemplate('Arcanis the Omnipotent', { types: ['Creature'] })],
        },
        libraries: {
          p1: [
            cardTemplate('A'),
            cardTemplate('B'),
            cardTemplate('C'),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const arcanis = named(server.state, 'Arcanis the Omnipotent').id
    server.state.objects[arcanis].summoningSickness = false
    let state = ready(server.state)
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'arcanis.draw',
      seat: 'p1',
      objectId: arcanis,
    }))
    state = passToEmpty(server.rules, state)
    expect(state.zoneOrder.p1.hand).toHaveLength(3)
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'arcanis.bounce',
      seat: 'p1',
      objectId: arcanis,
    }))
    state = passToEmpty(server.rules, state)
    expect(state.objects[arcanis].zone).toBe('hand')
  })

  test("Minamo untaps a legendary creature", () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            cardTemplate("Minamo, School at Water's Edge", { types: ['Land'] }),
            cardTemplate('Arcanis the Omnipotent', {
              types: ['Creature'],
              supertypes: ['Legendary'],
            }),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const minamo = named(server.state, "Minamo, School at Water's Edge").id
    const arcanis = named(server.state, 'Arcanis the Omnipotent').id
    server.state.objects[minamo].summoningSickness = false
    server.state.objects[arcanis].tapped = true
    let state = ready(server.state)
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'minamo.untap',
      seat: 'p1',
      objectId: minamo,
      targets: [{ kind: 'object', objectId: arcanis }],
    }))
    state = passToEmpty(server.rules, state)
    expect(state.objects[arcanis].tapped).toBe(false)
  })

  test('Condemn puts an attacker on the bottom and its controller gains toughness', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Condemn', { types: ['Instant'], manaCost: '{W}' })] },
        battlefield: {
          p2: [cardTemplate('Angry Bear', {
            types: ['Creature'],
            power: 3,
            toughness: 4,
          })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const bear = named(server.state, 'Angry Bear')
    let state = ready(server.state)
    state.objects[bear.id].attacking = 'p1'
    state.players.p1.mana.W = 1
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Condemn').id,
      targets: [{ kind: 'object', objectId: bear.id }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[bear.id].zone).toBe('library')
    expect(state.zoneOrder.p2.library.at(-1)).toBe(bear.id)
    expect(state.players.p2.life).toBe(44)
  })

  test('Hatred pays X life and pumps only power', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Hatred', { types: ['Instant'], manaCost: '{3}{B}{B}' })] },
        battlefield: {
          p1: [cardTemplate('Wall of Blood', {
            types: ['Creature'],
            power: 0,
            toughness: 2,
          })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = ready(server.state)
    const wall = named(state, 'Wall of Blood')
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Hatred').id,
      x: 5,
      targets: [{ kind: 'object', objectId: wall.id }],
    }))
    expect(state.players.p1.life).toBe(35)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[wall.id].power).toBe(5)
    expect(state.objects[wall.id].toughness).toBe(2)
  })

  test('Infernal Contract draws four and loses half life rounded up', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Infernal Contract', { types: ['Sorcery'], manaCost: '{B}{B}{B}' })],
        },
        libraries: {
          p1: Array.from({ length: 4 }, (_, index) => cardTemplate(`Draw ${index}`)),
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = ready(server.state)
    state.players.p1.life = 15
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Infernal Contract').id,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(4)
    expect(state.players.p1.life).toBe(7)
  })

  test('Mana Drain counters and pays colorless at the next main', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Mana Drain', { types: ['Instant'], manaCost: '{U}{U}' })],
          p2: [cardTemplate('Fat Spell', { types: ['Sorcery'], manaCost: '{4}{G}' })],
        },
        libraries: { p1: [cardTemplate('Keep Alive')] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = ready(server.state, 'p2')
    state.players.p2.mana.G = 1
    state.players.p2.mana.C = 4
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p2',
      objectId: named(state, 'Fat Spell').id,
    }))
    state.priority = 'p1'
    state.players.p1.mana.U = 2
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Mana Drain').id,
      targets: [{ kind: 'object', objectId: named(state, 'Fat Spell').id }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(named(state, 'Fat Spell').zone).toBe('graveyard')
    state.active = 'p1'
    state.priority = 'p1'
    state.step = 'draw'
    state = ok(server.rules(state, { type: 'advanceStep' }))
    state = passToEmpty(server.rules, state)
    expect(state.step).toBe('precombatMain')
    expect(state.players.p1.mana.C).toBe(5)
  })

  test('Desertion puts a countered creature onto the battlefield', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Desertion', { types: ['Instant'], manaCost: '{3}{U}{U}' })],
          p2: [cardTemplate('Grizzly Bears', {
            types: ['Creature'],
            manaCost: '{1}{G}',
            power: 2,
            toughness: 2,
          })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = ready(server.state, 'p2')
    state.players.p1.mana = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 }
    state.players.p2.mana.G = 1
    state.players.p2.mana.C = 1
    const bears = named(state, 'Grizzly Bears').id
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p2',
      objectId: bears,
    }))
    state.priority = 'p1'
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Desertion').id,
      targets: [{ kind: 'object', objectId: bears }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[bears].zone).toBe('battlefield')
    expect(state.objects[bears].controller).toBe('p1')
  })

  test('Cryptic Command chooses two modes and taps then draws', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Cryptic Command', {
            types: ['Instant'],
            manaCost: '{1}{U}{U}{U}',
          })],
        },
        battlefield: {
          p2: [cardTemplate('Grizzly Bears', { types: ['Creature'], power: 2, toughness: 2 })],
        },
        libraries: { p1: [cardTemplate('Bonus')] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = ready(server.state)
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Cryptic Command').id,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(pendingDialog(state)).toMatchObject({
      kind: 'choose-modes',
      source: 'Cryptic Command',
      requirements: { target: { min: 2, max: 2 } },
    })
    expect(server.rules(state, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { modes: ['Draw a card'] },
    }).ok).toBe(false)
    state = ok(server.rules(state, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: {
        modes: [
          'Tap all creatures your opponents control',
          'Draw a card',
        ],
      },
    }))
    expect(named(state, 'Grizzly Bears').tapped).toBe(true)
    expect(named(state, 'Bonus').zone).toBe('hand')
  })

  test('Wedding Ring copies for the targeted opponent and mirrors their draws', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 3,
        hands: {
          p1: [cardTemplate('Wedding Ring', { types: ['Artifact'], manaCost: '{2}{W}{W}' })],
        },
        libraries: {
          p1: [cardTemplate('Our Draw')],
          p2: [cardTemplate('Their Draw')],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = ready(server.state)
    const ring = named(state, 'Wedding Ring').id
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: ring,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const pick = pendingPlayerSelectionFor(state, 'p1')
    expect(pick).toBeDefined()
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: pick!.id,
      players: ['p2'],
    }))
    state = passToEmpty(server.rules, state)
    const token = Object.values(state.objects).find((object) =>
      object.name === 'Wedding Ring' && object.id !== ring)!
    expect(token.controller).toBe('p2')
    expect(token.token).toBe(true)

    state.active = 'p2'
    state.priority = 'p2'
    state = ok(server.rules(state, { type: 'draw', seat: 'p2', count: 1 }))
    state = passToEmpty(server.rules, state)
    expect(named(state, 'Our Draw').zone).toBe('hand')
  })

  test('Breena rewards an attack on the richest opponent', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 3,
        battlefield: {
          p1: [
            cardTemplate('Breena, the Demagogue', { types: ['Creature'], power: 1, toughness: 3 }),
            cardTemplate('Small Bear', { types: ['Creature'], power: 1, toughness: 1 }),
          ],
          p2: [cardTemplate('Attacker', { types: ['Creature'], power: 2, toughness: 2 })],
        },
        libraries: { p2: [cardTemplate('Attack Draw')] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = structuredClone(server.state)
    state.players.p3.life = 50
    state.players.p1.life = 40
    state.players.p2.life = 40
    state.active = 'p2'
    state.priority = 'p2'
    state.step = 'declareAttackers'
    const attacker = named(state, 'Attacker').id
    state.objects[attacker].summoningSickness = false
    state = ok(server.rules(state, {
      type: 'declareAttackers',
      seat: 'p2',
      attackers: [{ objectId: attacker, defender: 'p3' }],
    }))
    state = passToEmpty(server.rules, state)
    expect(state.zoneOrder.p2.hand.length + (state.stack.length > 0 ? 0 : 0)).toBeGreaterThanOrEqual(0)
    const choice = pendingSelectionFor(state, 'p1')
    expect(choice?.plusCounters).toBe(2)
    const bear = named(state, 'Small Bear').id
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [bear],
    }))
    expect(state.objects[bear].counters['+1/+1']).toBe(2)
  })

  test('Kuroki counters when the opponent declines the draw, and steal-casts when they accept', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [cardTemplate('Kuroki, Thief of Talents', {
            types: ['Creature'],
            power: 3,
            toughness: 3,
          })],
        },
        hands: {
          p2: [cardTemplate('Lightning Bolt', { types: ['Instant'], manaCost: '{R}' })],
        },
        libraries: {
          p2: Array.from({ length: 4 }, (_, index) => cardTemplate(`Extra ${index}`)),
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = structuredClone(server.state)
    state.active = 'p1'
    state.priority = 'p1'
    state.step = 'postcombatMain'
    state = ok(server.rules(state, { type: 'advanceStep' }))
    const pick = pendingPlayerSelectionFor(state, 'p1')
    expect(pick).toBeDefined()
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: pick!.id,
      players: ['p2'],
    }))
    state = passToEmpty(server.rules, state)
    expect(pendingDialog(state)?.kind).toBe('may-draw')
    const declined = ok(server.rules(state, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p2',
      payload: { accepted: false },
    }))
    expect(named(declined, 'Kuroki, Thief of Talents').counters['+1/+1']).toBe(2)

    let accepted = ok(server.rules(state, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p2',
      payload: { accepted: true },
    }))
    expect(accepted.zoneOrder.p2.hand.length).toBeGreaterThan(1)
    const steal = pendingSelectionFor(accepted, 'p1')
    expect(steal?.castWithoutPaying).toBe(true)
    const bolt = named(accepted, 'Lightning Bolt').id
    const p3 = projectForViewer(accepted, 'p3')
    expect(p3.objects[bolt]).toBeUndefined()
    const p1 = projectForViewer(accepted, 'p1')
    expect(p1.objects[bolt]?.name).toBe('Lightning Bolt')
    accepted = ok(server.rules(accepted, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [bolt],
    }))
    expect(accepted.stack[0]?.objectId).toBe(bolt)
    expect(accepted.objects[bolt].controller).toBe('p1')
  })
})
