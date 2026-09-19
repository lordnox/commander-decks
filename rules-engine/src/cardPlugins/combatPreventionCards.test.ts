import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok } from '../testHelpers'
import type { GameEvent, GameState, ManaPool } from '../types'
import { combatPreventionCards } from './combatPreventionCards'

const spell = (name: string, manaCost: string) =>
  cardTemplate(name, { types: ['Instant'], manaCost })

const creature = (name: string, controllerPower = 2) =>
  cardTemplate(name, {
    types: ['Creature'],
    power: controllerPower,
    toughness: controllerPower,
  })

const basic = (name: string, subtype: string) =>
  cardTemplate(name, {
    types: ['Land'],
    supertypes: ['Basic'],
    subtypes: [subtype],
  })

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const mana = (extra: Partial<ManaPool>): ManaPool => ({
  W: 0,
  U: 0,
  B: 0,
  R: 0,
  G: 0,
  C: 0,
  ...extra,
})

const castAndResolve = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  name: string,
  targets: Extract<GameEvent, { type: 'castSpell' }>['targets'] = [],
) => {
  const cast = ok(server.rules(state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(state, name).id,
    targets,
  }))
  return ok(server.rules(cast, { type: 'resolveTop' }))
}

describe('Lady Evangela advanced combat prevention cards', () => {
  test('Batwing Brume independently uses every color actually spent', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [spell('Batwing Brume', '{1}{W/B}')] },
        battlefield: {
          p2: [creature('First Attacker'), creature('Second Attacker')],
        },
      },
      { random: () => 0.5, cardPlugins: [combatPreventionCards] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = mana({ W: 1, B: 1 })
    for (const attacker of ready.zoneOrder.p2.battlefield) {
      ready.objects[attacker].attacking = { kind: 'player', player: 'p1' }
    }
    const resolved = castAndResolve(server, ready, 'Batwing Brume')
    expect(resolved.players.p2.life).toBe(38)
    expect(resolved.rules.some((rule) => rule.pluginId === 'fog')).toBe(true)
    expect(ok(server.rules(resolved, {
      type: 'combatDamage',
      sourceId: named(resolved, 'First Attacker').id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    })).players.p1.life).toBe(40)
  })

  test('Comeuppance reflects creature and noncreature damage without reflecting controlled sources', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [spell('Comeuppance', '{3}{W}')] },
        battlefield: {
          p1: [creature('Friendly', 2)],
          p2: [
            creature('Hostile', 3),
            cardTemplate('Hostile Relic', { types: ['Artifact'] }),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [combatPreventionCards] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = mana({ W: 1, C: 3 })
    let state = castAndResolve(server, ready, 'Comeuppance')
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: named(state, 'Hostile').id,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    }))
    expect(state.players.p1.life).toBe(40)
    expect(named(state, 'Hostile').zone).toBe('graveyard')
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: named(state, 'Hostile Relic').id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(state.players.p2.life).toBe(38)
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: named(state, 'Friendly').id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(state.players.p1.life).toBe(38)
  })

  test('Energy Arc validates, untaps, and prevents combat damage dealt by and to its targets', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [spell('Energy Arc', '{W}{U}')] },
        battlefield: {
          p1: [creature('Guard', 2)],
          p2: [creature('Raider', 3)],
        },
      },
      { random: () => 0.5, cardPlugins: [combatPreventionCards] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = mana({ W: 1, U: 1 })
    named(ready, 'Raider').tapped = true
    const duplicate = server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Energy Arc').id,
      targets: [
        { kind: 'object', objectId: named(ready, 'Raider').id },
        { kind: 'object', objectId: named(ready, 'Raider').id },
      ],
    })
    expect(duplicate.ok).toBe(false)

    let state = castAndResolve(server, ready, 'Energy Arc', [
      { kind: 'object', objectId: named(ready, 'Raider').id },
    ])
    expect(named(state, 'Raider').tapped).toBe(false)
    state = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: named(state, 'Raider').id,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    }))
    expect(state.players.p1.life).toBe(40)
    state = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: named(state, 'Guard').id,
      target: { kind: 'object', objectId: named(state, 'Raider').id },
      amount: 2,
    }))
    expect(named(state, 'Raider').damageMarked).toBe(0)
  })

  test('Everybody Lives stops life loss, lethal destruction, targeting, losing, and winning', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [spell('Everybody Lives!', '{1}{W}')],
          p2: [spell('Hostile Spell', '')],
        },
        battlefield: {
          p1: [creature('Protected', 2)],
          p2: [creature('Enemy', 4)],
        },
      },
      { random: () => 0.5, cardPlugins: [combatPreventionCards] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = mana({ W: 1, C: 1 })
    let state = castAndResolve(server, ready, 'Everybody Lives!')
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: named(state, 'Enemy').id,
      target: { kind: 'object', objectId: named(state, 'Protected').id },
      amount: 4,
    }))
    expect(named(state, 'Protected').zone).toBe('battlefield')
    expect(ok(server.rules(state, {
      type: 'loseLife',
      seat: 'p1',
      amount: 40,
    })).players.p1.life).toBe(40)

    const hostileTarget = server.rules(state, {
      type: 'castSpell',
      seat: 'p2',
      objectId: named(state, 'Hostile Spell').id,
      targets: [{ kind: 'player', player: 'p1' }],
    })
    expect(hostileTarget.ok).toBe(false)
    const almostOver = structuredClone(state)
    almostOver.players.p2.lost = true
    almostOver.players.p3.lost = true
    almostOver.players.p4.lost = true
    expect(ok(server.rules(almostOver, {
      type: 'addMana',
      seat: 'p1',
      mana: {},
    })).ended).toBe(false)
  })

  test('Inkshield prevents only combat damage to its controller and creates exact Inklings', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [spell('Inkshield', '{3}{W}{B}')] },
        battlefield: { p2: [creature('Attacker', 3)] },
      },
      { random: () => 0.5, cardPlugins: [combatPreventionCards] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = mana({ W: 1, B: 1, C: 3 })
    let state = castAndResolve(server, ready, 'Inkshield')
    state = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: named(state, 'Attacker').id,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    }))
    const inklings = Object.values(state.objects).filter((object) => object.name === 'Inkling')
    expect(inklings).toHaveLength(3)
    expect(inklings.every((token) =>
      token.power === 2
      && token.toughness === 1
      && token.colors.join('') === 'WB'
      && token.oracleText === 'Flying')).toBe(true)
    expect(state.players.p1.life).toBe(40)
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: named(state, 'Attacker').id,
      target: { kind: 'player', player: 'p1' },
      amount: 1,
    }))
    expect(state.players.p1.life).toBe(39)
  })

  test('Settle exiles attackers and resumes a private typed basic-land search after restart', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [spell('Settle the Wreckage', '{2}{W}{W}')] },
        battlefield: {
          p2: [creature('Attacker One'), creature('Attacker Two')],
        },
        libraries: {
          p2: [
            basic('Plains', 'Plains'),
            basic('Island', 'Island'),
            cardTemplate('Guildgate', { types: ['Land'] }),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [combatPreventionCards] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = mana({ W: 2, C: 2 })
    for (const attacker of ready.zoneOrder.p2.battlefield) {
      ready.objects[attacker].attacking = { kind: 'player', player: 'p1' }
    }
    named(ready, 'Attacker Two').tags = ['commander']
    const noTarget = server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Settle the Wreckage').id,
    })
    expect(noTarget.ok).toBe(false)

    const castEvent = {
      type: 'castSpell' as const,
      seat: 'p1',
      objectId: named(ready, 'Settle the Wreckage').id,
      targets: [{ kind: 'player' as const, player: 'p2' }],
    }
    const cast = ok(server.rules(ready, castEvent))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(named(resolved, 'Attacker One').zone).toBe('exile')
    expect(named(resolved, 'Attacker Two').zone).toBe('command')
    const selection = pendingSelectionFor(resolved, 'p2')!
    expect(selection.candidates).toHaveLength(2)
    expect(selection.count).toBe(1)

    const p2View = projectForViewer(resolved, 'p2')
    const p1View = projectForViewer(resolved, 'p1')
    expect(selection.candidates.every((id) => Boolean(p2View.objects[id]))).toBe(true)
    expect(selection.candidates.every((id) => !p1View.objects[id])).toBe(true)

    let journal = createJournal(ready)
    journal = recordAccepted(journal, castEvent)
    journal = recordAccepted(journal, { type: 'resolveTop' })
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingSelectionFor(restored, 'p2')?.id).toBe(selection.id)

    const illegal = server.rules(restored, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: selection.count,
      objectIds: [named(restored, 'Guildgate').id],
    })
    expect(illegal.ok).toBe(false)
    const chosen = selection.candidates[0]
    const finished = ok(server.rules(restored, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: selection.count,
      objectIds: [chosen],
    }))
    expect(finished.objects[chosen].zone).toBe('battlefield')
    expect(finished.objects[chosen].tapped).toBe(true)
    expect(pendingSelectionFor(finished, 'p2')).toBeUndefined()
  })

  test('live action enumeration exposes Settle player targets and Energy Arc multi-targets', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            spell('Settle the Wreckage', '{2}{W}{W}'),
            spell('Energy Arc', '{W}{U}'),
          ],
        },
        battlefield: { p2: [creature('Target')] },
      },
      { random: () => 0.5, cardPlugins: [combatPreventionCards] },
    )
    const state = structuredClone(server.state)
    state.players.p1.mana = mana({ W: 3, U: 1, C: 2 })
    const acts = legalActsFor(state, 'p1')
    const settle = acts.filter((action) =>
      action.kind === 'castSpell' && action.name === 'Settle the Wreckage')
    expect(settle).toHaveLength(4)
    expect(settle.every((action) =>
      action.kind === 'castSpell' && Boolean(action.targetPlayerId))).toBe(true)
    const energy = acts.find((action) =>
      action.kind === 'castSpell' && action.name === 'Energy Arc')
    expect(energy?.kind === 'castSpell' && energy.targetGroups?.[0].max).toBe(1)
  })
})
