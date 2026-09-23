import { describe, expect, test } from 'bun:test'
import { makeDraft } from '../draft'
import {
  grantProtectionFromEverything,
  lifeTotalCannotChange,
  phaseOutControlled,
} from '../cardPlugins/effectBuilders'
import { runInstructions } from '../cardPlugins/effects'
import { rules } from '../kernel'
import { catalog } from '../index'
import { cardTemplate } from '../newGame'
import { bears, bolt, newGame } from '../testGame'
import type { ReduceResult } from '../types'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const fixtureCreature = (name: string) => ({
  ...bears(),
  name,
  summoningSickness: false,
})

const perchPackage = [
  phaseOutControlled(),
  grantProtectionFromEverything(),
  lifeTotalCannotChange(),
]

const applyInstructions = (
  state: ReturnType<typeof newGame>,
  source: ReturnType<typeof cardTemplate>,
  instructions: typeof perchPackage,
) => {
  const draft = makeDraft(state)
  runInstructions(draft, source, instructions)
  let current = state
  for (const event of draft.pending) {
    current = ok(rules(current, event, catalog))
  }
  return current
}

describe('phasing, protection from everything, and life lock', () => {
  test('phaseOutControlled phases out permanents and attached auras', () => {
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
    const source = cardTemplate('Fictional Shelter', { controller: 'p1', owner: 'p1' })
    const next = applyInstructions(state, source, [phaseOutControlled()])
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
    state.objects[boltSpell.id] = boltSpell
    const cast = rules(state, {
      type: 'castSpell',
      seat: 'p2',
      objectId: boltSpell.id,
      targets: [{ kind: 'object', objectId: creature.id }],
    }, catalog)
    expect(cast.ok).toBe(false)
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

  test('full perch-shaped resolution blocks life changes and damage until next turn', () => {
    const creature = fixtureCreature('Vault Guardian')
    const filler = bears()
    let state = newGame({
      players: 2,
      battlefield: { p1: [creature] },
      libraries: { p1: [filler, filler], p2: [filler, filler] },
    })
    const guardian = Object.values(state.objects).find((o) => o.name === 'Vault Guardian')!
    const source = cardTemplate('Fictional Perch', { controller: 'p1', owner: 'p1' })
    state = applyInstructions(state, source, perchPackage)
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
      sourceId: source.id,
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
    let state = newGame({ battlefield: { p1: [creature] } })
    const stillPhased = Object.values(state.objects).find((o) => o.name === 'Still Phased')!
    const source = cardTemplate('Fictional Perch', { controller: 'p1', owner: 'p1' })
    state = applyInstructions(state, source, perchPackage)
    const restarted = structuredClone(state)
    const blocked = rules(restarted, {
      type: 'castSpell',
      seat: 'p2',
      objectId: bolt().id,
      targets: [{ kind: 'object', objectId: stillPhased.id }],
    }, catalog)
    expect(blocked.ok).toBe(false)
    expect(restarted.rules.length).toBe(state.rules.length)
  })
})
