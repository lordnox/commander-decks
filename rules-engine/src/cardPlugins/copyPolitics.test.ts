import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { legalActsFor } from '../actions'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState, Plugin } from '../types'
import { activated } from './activated'
import { attackDeal } from './attackDeal'
import { combatDialogue } from './combatDialogue'
import { activate, draw } from './effects'
import { stackCopy, stackCopyPending } from './stackCopy'
import { targetedResolve } from './targetedResolve'
import { targetingRequirements } from './targetingRequirements'
import { currentVoter, pendingVote, vote } from './vote'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const creature = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

const spell = (name: string, manaCost: string, types = ['Sorcery']) =>
  cardTemplate(name, { types, manaCost })

const ready = (state: GameState, seat = 'p1', amount = 10) => {
  const next = structuredClone(state)
  next.active = seat
  next.priority = seat
  next.step = 'precombatMain'
  next.players[seat].mana = { W: amount, U: amount, B: amount, R: amount, G: amount, C: amount }
  return next
}

const serverWith = (
  options: Parameters<typeof createServerGame>[1],
  cardPlugins: Plugin[],
) => createServerGame(
  commanderRules,
  { players: 4, ...options },
  { random: () => 0.5, cardPlugins },
)

describe('Lady Evangela copy and politics capabilities', () => {
  test("Council's Judgment validates public sequential votes and exiles every tied winner", () => {
    const server = serverWith({
      hands: {
        p1: [
          spell("Council's Judgment", '{1}{W}{W}'),
          spell('Private Answer', '{U}', ['Instant']),
        ],
      },
      battlefield: {
        p1: [creature('P1 Bear')],
        p2: [creature('P2 Bear')],
      },
    }, [vote])
    let state = ready(server.state)
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, "Council's Judgment").id,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(currentVoter(pendingVote(state)!)).toBe('p1')
    const privateAnswerId = named(state, 'Private Answer').id
    const p2View = projectForViewer(state, 'p2')
    expect(pendingVote(p2View)).toBeDefined()
    expect(p2View.objects[privateAnswerId]).toBeUndefined()

    const illegal = server.rules(state, {
      type: 'vote',
      seat: 'p1',
      sourceId: named(state, "Council's Judgment").id,
      choice: { kind: 'object', objectId: named(state, 'P1 Bear').id },
    })
    expect(illegal.ok).toBe(false)

    state = ok(server.rules(state, {
      type: 'vote',
      seat: 'p1',
      sourceId: named(state, "Council's Judgment").id,
      choice: { kind: 'object', objectId: named(state, 'P2 Bear').id },
    }))
    expect(currentVoter(pendingVote(structuredClone(state))!)).toBe('p2')
    state = ok(server.rules(state, {
      type: 'vote',
      seat: 'p2',
      sourceId: named(state, "Council's Judgment").id,
      choice: { kind: 'object', objectId: named(state, 'P1 Bear').id },
    }))
    state = ok(server.rules(state, {
      type: 'vote',
      seat: 'p3',
      sourceId: named(state, "Council's Judgment").id,
      choice: { kind: 'object', objectId: named(state, 'P2 Bear').id },
    }))
    state = ok(server.rules(state, {
      type: 'vote',
      seat: 'p4',
      sourceId: named(state, "Council's Judgment").id,
      choice: { kind: 'object', objectId: named(state, 'P1 Bear').id },
    }))
    expect(named(state, 'P1 Bear').zone).toBe('exile')
    expect(named(state, 'P2 Bear').zone).toBe('exile')
    expect(pendingVote(state)).toBeUndefined()
  })

  test('Fractured Identity exiles first and gives every other player a token copy', () => {
    const server = serverWith({
      hands: { p1: [spell('Fractured Identity', '{3}{W}{U}')] },
      battlefield: { p2: [creature('Borrowed Titan', { power: 6, toughness: 6 })] },
    }, [targetedResolve])
    let state = ready(server.state)
    const target = named(state, 'Borrowed Titan')
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Fractured Identity').id,
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[target.id].zone).toBe('exile')
    const copies = Object.values(state.objects).filter((object) =>
      object.name === 'Borrowed Titan' && object.token && object.zone === 'battlefield')
    expect(copies.map((copy) => copy.controller).sort()).toEqual(['p1', 'p3', 'p4'])
  })

  test('Mirrorweave rejects legendary targets and restores copied creatures at cleanup', () => {
    const server = serverWith({
      hands: { p1: [spell('Mirrorweave', '{2}{W/U}{W/U}', ['Instant'])] },
      battlefield: {
        p1: [creature('Small Bear')],
        p2: [
          creature('Large Bear', { power: 7, toughness: 7 }),
          creature('Legend', { supertypes: ['Legendary'] }),
        ],
      },
    }, [targetedResolve])
    let state = ready(server.state)
    const mirror = named(state, 'Mirrorweave')
    const rejected = server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: mirror.id,
      targets: [{ kind: 'object', objectId: named(state, 'Legend').id }],
    })
    expect(rejected.ok).toBe(false)

    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: mirror.id,
      targets: [{ kind: 'object', objectId: named(state, 'Large Bear').id }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const copiedId = Object.values(state.objects).find((object) => object.printedName === 'Small Bear')!.id
    expect(state.objects[copiedId]).toMatchObject({ name: 'Large Bear', power: 7 })
    const cleanup = structuredClone(state)
    cleanup.step = 'end'
    state = ok(server.rules(cleanup, { type: 'custom', name: 'advanceStep' }))
    expect(state.objects[copiedId]).toMatchObject({ name: 'Small Bear', power: 2 })
  })

  test('Standard Bearer requires supported opposing targeted spells to choose a Flagbearer', () => {
    const server = serverWith({
      hands: { p2: [spell('Swords to Plowshares', '{W}', ['Instant'])] },
      battlefield: {
        p1: [
          creature('Standard Bearer', { subtypes: ['Human', 'Flagbearer'], power: 1, toughness: 1 }),
          creature('Protected Bear'),
        ],
      },
    }, [targetedResolve, targetingRequirements])
    let state = ready(server.state, 'p2')
    const swords = named(state, 'Swords to Plowshares')
    const wrong = server.rules(state, {
      type: 'castSpell',
      seat: 'p2',
      objectId: swords.id,
      targets: [{ kind: 'object', objectId: named(state, 'Protected Bear').id }],
    })
    expect(wrong.ok).toBe(false)
    const right = server.rules(state, {
      type: 'castSpell',
      seat: 'p2',
      objectId: swords.id,
      targets: [{ kind: 'object', objectId: named(state, 'Standard Bearer').id }],
    })
    expect(right.ok).toBe(true)
  })

  test('Sokrates prevents player combat damage and both players draw half rounded down', () => {
    const server = serverWith({
      hands: { p2: [spell('Swords to Plowshares', '{W}', ['Instant'])] },
      battlefield: {
        p1: [creature('Sokrates, Athenian Teacher', { power: 0, toughness: 4 })],
        p2: [creature('Attacker', { power: 5, toughness: 5 })],
      },
      libraries: {
        p1: [spell('P1 A', ''), spell('P1 B', '')],
        p2: [spell('P2 A', ''), spell('P2 B', '')],
      },
    }, [activated, combatDialogue, targetingRequirements])
    let state = ready(server.state)
    const sokrates = named(state, 'Sokrates, Athenian Teacher')
    state.objects[sokrates.id].summoningSickness = false
    const targeting = ready(state, 'p2')
    const protectedCast = server.rules(targeting, {
      type: 'castSpell',
      seat: 'p2',
      objectId: named(targeting, 'Swords to Plowshares').id,
      targets: [{ kind: 'object', objectId: sokrates.id }],
    })
    expect(protectedCast.ok).toBe(false)
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'sokrates.dialogue',
      seat: 'p1',
      objectId: sokrates.id,
      targets: [{ kind: 'object', objectId: named(state, 'Attacker').id }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const tappedTargeting = ready(state, 'p2')
    expect(server.rules(tappedTargeting, {
      type: 'castSpell',
      seat: 'p2',
      objectId: named(tappedTargeting, 'Swords to Plowshares').id,
      targets: [{ kind: 'object', objectId: sokrates.id }],
    }).ok).toBe(true)
    state = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: named(state, 'Attacker').id,
      target: { kind: 'player', player: 'p1' },
      amount: 5,
    }))
    expect(state.players.p1.life).toBe(40)
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
    expect(state.zoneOrder.p2.hand).toHaveLength(3)
  })

  test('Rings copies a nonmana activated ability through a restart-safe typed choice', () => {
    const tapper = creature('Tap Drawer', {
      effects: [activate({ id: 'tap.draw', costs: { tap: true }, do: [draw(1)] })],
    })
    const server = serverWith({
      battlefield: {
        p1: [
          cardTemplate('Rings of Brighthearth', { types: ['Artifact'] }),
          tapper,
        ],
      },
      libraries: { p1: [spell('Card A', ''), spell('Card B', '')] },
    }, [activated, stackCopy])
    let state = ready(server.state)
    const tapperId = named(state, 'Tap Drawer').id
    state.objects[tapperId].summoningSickness = false
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'tap.draw',
      seat: 'p1',
      objectId: tapperId,
    }))
    expect(state.stack).toHaveLength(2)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const restored = structuredClone(state)
    expect(stackCopyPending(restored)).toMatchObject({ seat: 'p1' })
    const pending = stackCopyPending(state)!
    const wrongSeat = server.rules(state, {
      type: 'copyStackItem',
      seat: 'p2',
      sourceId: pending.sourceId,
      stackId: pending.stackId,
      accept: true,
    })
    expect(wrongSeat.ok).toBe(false)
    state = ok(server.rules(state, {
      type: 'copyStackItem',
      seat: 'p1',
      sourceId: pending.sourceId,
      stackId: pending.stackId,
      accept: true,
    }))
    expect(state.stack).toHaveLength(2)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
  })

  test('spell copies use the same typed stack-copy path without moving the original card', () => {
    const server = serverWith({
      hands: {
        p1: [spell('Twincast', '{U}{U}', ['Instant'])],
        p2: [spell('Swords to Plowshares', '{W}', ['Instant'])],
      },
      battlefield: { p1: [creature('Copy Target')] },
    }, [targetedResolve, stackCopy])
    let state = ready(server.state, 'p2')
    const targetId = named(state, 'Copy Target').id
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p2',
      objectId: named(state, 'Swords to Plowshares').id,
      targets: [{ kind: 'object', objectId: targetId }],
    }))
    state.priority = 'p1'
    state.players.p1.mana.U = 2
    const swordsId = named(state, 'Swords to Plowshares').id
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Twincast').id,
      targets: [{ kind: 'object', objectId: swordsId }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const pending = stackCopyPending(state)!
    expect(pending).toMatchObject({ optional: false, cost: '{0}' })
    expect(server.rules(state, {
      type: 'copyStackItem',
      seat: 'p1',
      sourceId: pending.sourceId,
      stackId: pending.stackId,
      accept: false,
    }).ok).toBe(false)
    state = ok(server.rules(state, {
      type: 'copyStackItem',
      seat: 'p1',
      sourceId: pending.sourceId,
      stackId: pending.stackId,
      accept: true,
    }))
    expect(state.objects[swordsId].zone).toBe('stack')
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[targetId].zone).toBe('exile')
    expect(state.objects[swordsId].zone).toBe('stack')
  })

  test('Tenuous Truce attaches to an opponent, draws at their end step, and breaks on attacks', () => {
    const server = serverWith({
      hands: { p1: [spell('Tenuous Truce', '{1}{W}', ['Enchantment'])] },
      battlefield: { p1: [creature('Diplomat')] },
      libraries: {
        p1: [spell('P1 Draw', '')],
        p2: [spell('P2 Draw', '')],
      },
    }, [attackDeal])
    let state = ready(server.state)
    const truce = named(state, 'Tenuous Truce')
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: truce.id,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[truce.id].attachedTo).toBe('p2')

    const ending = structuredClone(state)
    ending.active = 'p2'
    ending.step = 'postcombatMain'
    state = ok(server.rules(ending, { type: 'custom', name: 'advanceStep' }))
    expect(state.stack[0]?.abilityId).toBe('attackDeal.draw')
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(state.zoneOrder.p2.hand).toHaveLength(1)

    const attacking = structuredClone(state)
    attacking.active = 'p1'
    attacking.priority = 'p1'
    attacking.step = 'declareAttackers'
    const diplomat = named(attacking, 'Diplomat')
    diplomat.summoningSickness = false
    state = ok(server.rules(attacking, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: diplomat.id, defender: 'p2' }],
    }))
    expect(state.stack[0]?.abilityId).toBe('attackDeal.break')
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[truce.id].zone).toBe('graveyard')
  })

  test('live action enumeration exposes Tenuous Truce opponents and Sokrates creature targets', () => {
    const server = serverWith({
      hands: { p1: [spell('Tenuous Truce', '{1}{W}', ['Enchantment'])] },
      battlefield: {
        p1: [creature('Sokrates, Athenian Teacher', { power: 0, toughness: 4 })],
        p2: [creature('Dialogue Target')],
      },
    }, [activated, attackDeal, combatDialogue, targetingRequirements])
    const state = ready(server.state)
    const sokrates = named(state, 'Sokrates, Athenian Teacher')
    state.objects[sokrates.id].summoningSickness = false
    const actions = legalActsFor(state, 'p1')
    const truceTargets = actions.filter((action) =>
      action.kind === 'castSpell' && action.name === 'Tenuous Truce')
    expect(truceTargets.map((action) =>
      action.kind === 'castSpell' ? action.targetObjectId : undefined).sort())
      .toEqual(['p2', 'p3', 'p4'])
    const dialogue = actions.find((action) =>
      action.kind === 'activateAbility' && action.abilityId === 'sokrates.dialogue')
    expect(dialogue?.kind === 'activateAbility' ? dialogue.targetGroups?.[0] : undefined)
      .toMatchObject({
        label: 'Creature',
        min: 1,
        max: 1,
      })
  })
})
