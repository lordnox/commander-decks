import { describe, expect, test } from 'bun:test'
import type { Instruction } from '../cardPlugins/dsl/schema/v2'
import { instructionSpell } from '../cardPlugins/dsl/instructionTestSupport'
import {
  createPlayerEffect,
  objects,
  phase,
  PLAYER_EFFECT_DURATIONS,
  PLAYER_EFFECTS,
  ref,
} from '../cardPlugins/dsl/v1'
import { commanderRules } from '../formats'
import { rules } from '../kernel'
import { createServerGame } from '../runtime'
import { catalog } from '../index'
import { cardTemplate } from '../newGame'
import { bears, bolt, newGame } from '../testGame'
import type { GameState, ReduceResult } from '../types'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const fixtureCreature = (name: string) => ({
  ...bears(),
  name,
  summoningSickness: false,
})

const phaseOutControlled = phase({ targets: objects({ zone: 'battlefield', controller: 'you' }), out: true })
const untilNextTurn = (playerEffect: typeof PLAYER_EFFECTS.protectionFromEverything | typeof PLAYER_EFFECTS.lifeTotalCannotChange) =>
  createPlayerEffect({ targets: ref('controller'), playerEffect, duration: PLAYER_EFFECT_DURATIONS.untilYourNextTurn })
const protectionAndLock = [untilNextTurn(PLAYER_EFFECTS.protectionFromEverything), untilNextTurn(PLAYER_EFFECTS.lifeTotalCannotChange)]
const perchPackage = [phaseOutControlled, ...protectionAndLock]

/** p1 casts and resolves a canonical fixture spell; returns the state and the spell's object id. */
const applyInstructions = (state: GameState, instructions: readonly Instruction[]) => {
  const fixture = instructionSpell({ instructions })
  const withSpell = newGame({ hands: { p1: [fixture] } })
  const id = 'canonical-fixture'
  const armed = structuredClone(state)
  armed.objects[id] = { ...withSpell.objects[withSpell.zoneOrder.p1.hand[0]], id }
  armed.zoneOrder.p1.hand.push(id)
  armed.zoneCounts.p1.hand += 1
  armed.priority = 'p1'
  const cast = ok(rules(armed, { type: 'castSpell', seat: 'p1', objectId: id }, catalog))
  return { state: ok(rules(cast, { type: 'resolveTop' }, catalog)), sourceId: id }
}

describe('phasing, protection from everything, and life lock', () => {
  test('phasing out controlled permanents also phases out attached auras', () => {
    const creature = fixtureCreature('Sheltered Beast')
    const aura = cardTemplate('Sheltered Aura', {
      types: ['Enchantment'],
      subtypes: ['Aura'],
    })
    const state = newGame({
      battlefield: { p1: [creature, aura] },
    })
    const beast = Object.values(state.objects).find((o) => o.name === 'Sheltered Beast')!
    const shelteredAura = Object.values(state.objects).find((o) => o.name === 'Sheltered Aura')!
    shelteredAura.attachedTo = beast.id
    const next = applyInstructions(state, [phaseOutControlled]).state
    expect(next.objects[beast.id].phasedOut).toBe(true)
    expect(next.objects[shelteredAura.id].phasedOut).toBe(true)
  })

  test('phased-out permanents are not legal targets', () => {
    const creature = fixtureCreature('Phased Outcast')
    creature.phasedOut = true
    const boltSpell = { ...bolt(), controller: 'p2', owner: 'p2' }
    const state = newGame({
      battlefield: { p1: [creature] },
      hands: { p2: [boltSpell] },
    })
    const spell = Object.values(state.objects).find((o) => o.name === boltSpell.name)!
    const target = Object.values(state.objects).find((o) => o.name === creature.name)!
    state.priority = 'p2'
    state.players.p2.mana.R = 1
    const cast = rules(state, {
      type: 'castSpell',
      seat: 'p2',
      objectId: spell.id,
      targets: [{ kind: 'object', objectId: target.id }],
    }, catalog)
    expect(cast.ok).toBe(false)
    const unphased = structuredClone(state)
    unphased.objects[target.id].phasedOut = false
    expect(rules(unphased, {
      type: 'castSpell', seat: 'p2', objectId: spell.id,
      targets: [{ kind: 'object', objectId: target.id }],
    }, catalog).ok).toBe(true)
  })

  test('phasing out an already phased permanent is a no-op', () => {
    const creature = fixtureCreature('Already Gone')
    creature.phasedOut = true
    const state = newGame({ battlefield: { p1: [creature] } })
    const phased = Object.values(state.objects).find((o) => o.name === 'Already Gone')!
    const result = rules(state, { type: 'phaseOut', objectId: phased.id }, catalog)
    expect(result.ok).toBe(true)
    expect(result.state.objects[phased.id].phasedOut).toBe(true)
  })

  test('protection and life lock still apply on an opponent turn before the controller untaps again', () => {
    const filler = bears()
    let state = newGame({
      players: 2,
      libraries: { p1: [filler, filler], p2: [filler, filler] },
    })
    const applied = applyInstructions(state, protectionAndLock)
    state = applied.state
    expect(state.turn).toBe(1)
    expect(state.active).toBe('p1')

    while (state.active !== 'p2' || state.step !== 'untap' || state.turn < 2) {
      state = ok(rules(state, { type: 'advanceStep' }, catalog))
    }
    expect(state.active).toBe('p2')
    expect(state.turn).toBe(2)

    state = ok(rules(state, {
      type: 'dealDamage',
      sourceId: applied.sourceId,
      target: { kind: 'player', player: 'p1' },
      amount: 5,
    }, catalog))
    expect(state.players.p1.life).toBe(40)
    const gain = rules(state, { type: 'gainLife', seat: 'p1', amount: 3 }, catalog)
    expect(gain.ok).toBe(true)
    expect(gain.ok && gain.state.players.p1.life).toBe(40)
  })

  test('full perch-shaped resolution blocks life changes and damage until next turn', () => {
    const creature = fixtureCreature('Vault Guardian')
    const filler = bears()
    let state = newGame({
      players: 2,
      battlefield: { p1: [creature] },
      libraries: { p1: [filler, filler], p2: [filler, filler] },
    })
    const guardian = Object.values(state.objects).find((o) => o.name === 'Vault Guardian')!
    const applied = applyInstructions(state, perchPackage)
    state = applied.state
    expect(state.objects[guardian.id].phasedOut).toBe(true)
    expect(state.rules.some((rule) => rule.pluginId === 'lifeTotalLock')).toBe(true)
    expect(state.rules.some((rule) => rule.pluginId === 'protectionFromEverything')).toBe(true)

    for (const event of [
      { type: 'gainLife' as const, seat: 'p1' as const, amount: 5 },
      { type: 'loseLife' as const, seat: 'p1' as const, amount: 3 },
    ]) {
      const result = rules(state, event, catalog)
      expect(result.ok).toBe(true)
      state = result.ok ? result.state : state
      expect(state.players.p1.life).toBe(40)
    }
    state = ok(rules(state, {
      type: 'dealDamage',
      sourceId: applied.sourceId,
      target: { kind: 'player', player: 'p1' },
      amount: 4,
    }, catalog))
    expect(state.players.p1.life).toBe(40)

    while (state.turn < 2 || state.active !== 'p1' || state.step !== 'untap') {
      state = ok(rules(state, { type: 'advanceStep' }, catalog))
    }
    state = ok(rules(state, { type: 'gainLife', seat: 'p1', amount: 2 }, catalog))
    expect(state.players.p1.life).toBe(42)
    expect(state.objects[guardian.id].phasedOut).toBe(false)
  })

  test('host restart preserves state without open choices', () => {
    const creature = fixtureCreature('Still Phased')
    let state = newGame({ battlefield: { p1: [creature] }, hands: { p2: [bolt()] } })
    const stillPhased = Object.values(state.objects).find((o) => o.name === 'Still Phased')!
    state = applyInstructions(state, perchPackage).state
    const restarted = structuredClone(state)
    restarted.priority = 'p2'
    restarted.players.p2.mana.R = 1
    const blocked = rules(restarted, {
      type: 'castSpell',
      seat: 'p2',
      objectId: restarted.zoneOrder.p2.hand[0],
      targets: [{ kind: 'object', objectId: stillPhased.id }],
    }, catalog)
    expect(blocked.ok).toBe(false)
    expect(restarted.rules.length).toBe(state.rules.length)
  })
})

test('catalog Talon Gates of Madara enters from hand, phases out an optional target, and it phases in before its controller untaps', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p2: [cardTemplate('Target Creature', { types: ['Creature'] })] },
    hands: { p1: [cardTemplate('Talon Gates of Madara')] },
  }, { random: () => 0.5 })
  const named = (state: GameState, name: string) => Object.values(state.objects).find((object) => object.name === name)!
  let state = structuredClone(server.state)
  state.players.p1.mana.C = 4
  state = ok(server.rules(state, { type: 'activateAbility', abilityId: '$.abilities[3]', seat: 'p1', objectId: named(state, 'Talon Gates of Madara').id }))
  state = ok(server.rules(state, { type: 'resolveTop' }))
  const target = named(state, 'Target Creature')
  state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', kind: 'choose', count: 1, objectIds: [target.id] }))
  state = ok(server.rules(state, { type: 'resolveTop' }))
  expect(state.objects[target.id].phasedOut).toBe(true)

  const nextTurn = structuredClone(state)
  nextTurn.active = 'p1'
  nextTurn.step = 'cleanup'
  nextTurn.priority = 'p1'
  nextTurn.stack = []
  const p2Turn = ok(server.rules(nextTurn, { type: 'advanceStep' }))
  expect(p2Turn.active).toBe('p2')
  expect(p2Turn.objects[target.id].phasedOut).toBe(false)
})
