import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createEffect,
  objects,
  pumpEffect,
  ref,
  spell,
  untilStep,
  forTurns,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'

describe('effectDuration', () => {

  test.each([
    ['Firdoch Core', '$.abilities[2]', { C: 4 }, undefined, 4, 'Artifact'],
    ['Hall of Storm Giants', '$.abilities[2]', { U: 1, C: 5 }, undefined, 7, 'Land'],
    ['Lair of the Hydra', '$.abilities[2]', { G: 1, C: 2 }, 2, 2, 'Land'],
  ] as const)('%s animation is temporary and cannot attack the turn it entered', (name, abilityId, mana, x, stats, baseType) => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [cardTemplate(name, { summoningSickness: true })] },
    }, { random: () => 0 })
    const id = server.state.zoneOrder.p1.battlefield[0]!
    Object.assign(server.state.players.p1.mana, mana)
    const activated = server.rules(server.state, {
      type: 'activateAbility', seat: 'p1', objectId: id, abilityId, ...(x === undefined ? {} : { x }),
    })
    expect(activated.ok).toBe(true)
    if (!activated.ok) return
    const animated = server.rules(activated.state, { type: 'resolveTop' })
    expect(animated.ok).toBe(true)
    if (!animated.ok) return
    expect(animated.state.objects[id]?.types).toContain('Creature')
    expect(animated.state.objects[id]).toMatchObject({ power: stats, toughness: stats })
    const attack = server.rules({ ...structuredClone(animated.state), step: 'declareAttackers', priority: 'p1' }, {
      type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: id, defender: 'p2' }],
    })
    expect(attack.ok).toBe(false)
    if (!attack.ok) expect(attack.error).toContain('summoning sickness')
    const expired = server.rules({ ...structuredClone(animated.state), step: 'end' }, { type: 'advanceStep' })
    expect(expired.ok).toBe(true)
    if (expired.ok) expect(expired.state.objects[id]).toMatchObject({ types: [baseType], power: null, toughness: null })
  })

  test('canonical pump durations retain their declared step and turn deadlines', () => {
    const makeDefinition = (duration: Parameters<typeof createEffect>[0]['duration']) =>
      createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
        costs: [],
        decisions: { targets: [] },
        instructions: [createEffect({
          targets: objects({ zone: 'battlefield', name: 'Duration recipient' }),
          effect: pumpEffect(1, 1),
          duration,
        })],
      })])))
    const run = (definition: ReturnType<typeof makeDefinition>) => {
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: { p1: [cardTemplate('Duration source', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
        battlefield: { p1: [cardTemplate('Duration recipient', { types: ['Creature'], power: 2, toughness: 2 })] },
      }, { random: () => 0 })
      const source = Object.values(server.state.objects).find((object) => object.name === 'Duration source')!
      const recipient = Object.values(server.state.objects).find((object) => object.name === 'Duration recipient')!
      const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source.id })
      if (!cast.ok) throw new Error(cast.error)
      const resolved = server.rules(cast.state, { type: 'resolveTop' })
      if (!resolved.ok) throw new Error(resolved.error)
      return { server, state: resolved.state, recipient }
    }
    const until = run(makeDefinition(untilStep('beginCombat')))
    expect(until.state.objects[until.recipient.id]?.power).toBe(3)
    const advanced = until.server.rules({ ...until.state, step: 'precombatMain', priority: 'p1', passedInRow: [] }, { type: 'advanceStep' })
    expect(advanced.ok).toBe(true)
    if (advanced.ok) expect(advanced.state.objects[until.recipient.id]?.power).toBe(2)

    const turns = run(makeDefinition(forTurns(2)))
    const nextTurn = turns.server.rules({ ...turns.state, step: 'cleanup', priority: 'p1', passedInRow: [] }, { type: 'advanceStep' })
    expect(nextTurn.ok).toBe(true)
    if (nextTurn.ok) expect(nextTurn.state.objects[turns.recipient.id]?.power).toBe(3)
  })

  test('an omitted untilStep active seat waits for the next matching step', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      costs: [], decisions: { targets: [] },
      instructions: [createEffect({
        targets: objects({ zone: 'battlefield', name: 'Next upkeep recipient' }),
        effect: pumpEffect(1, 1), duration: untilStep('upkeep'),
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Next upkeep source', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: { p1: [cardTemplate('Next upkeep recipient', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Next upkeep source')!
    const recipient = Object.values(server.state.objects).find((object) => object.name === 'Next upkeep recipient')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    let state = resolved.state
    for (let index = 0; index < 20 && !(state.active === 'p2' && state.step === 'upkeep'); index += 1) {
      const next = server.rules(state, { type: 'advanceStep' })
      expect(next.ok).toBe(true)
      if (!next.ok) return
      state = next.state
    }
    expect(state.active).toBe('p2')
    expect(state.step).toBe('upkeep')
    expect(state.objects[recipient.id]?.power).toBe(2)
  })

  test('an explicit untilStep deadline waits through extra turns queued after creation', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      costs: [], decisions: { targets: [] },
      instructions: [createEffect({
        targets: objects({ zone: 'battlefield', name: 'Extra turn recipient' }),
        effect: pumpEffect(1, 1), duration: untilStep('upkeep', ref('controller')),
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Extra turn source', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: { p1: [cardTemplate('Extra turn recipient', { types: ['Creature'], power: 2, toughness: 2 })] },
      libraries: {
        p1: Array.from({ length: 10 }, () => cardTemplate('Extra turn draw')),
        p2: Array.from({ length: 10 }, () => cardTemplate('Extra turn draw')),
      },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Extra turn source')!
    const recipient = Object.values(server.state.objects).find((object) => object.name === 'Extra turn recipient')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    let state = JSON.parse(JSON.stringify(resolved.state))
    state.extraTurns = ['p2', 'p2']
    for (let index = 0; index < 50 && !(state.turn === resolved.state.turn + 2 && state.step === 'upkeep'); index += 1) {
      const next = server.rules(state, { type: 'advanceStep' })
      expect(next.ok).toBe(true)
      if (!next.ok) return
      state = next.state
    }
    expect(state.active).toBe('p2')
    expect(state.step).toBe('upkeep')
    expect(state.objects[recipient.id]?.power).toBe(3)
    for (let index = 0; index < 25 && !(state.active === 'p1' && state.step === 'untap'); index += 1) {
      const next = server.rules(state, { type: 'advanceStep' })
      expect(next.ok).toBe(true)
      if (!next.ok) return
      state = next.state
    }
    expect(state.objects[recipient.id]?.power).toBe(3)
    const next = server.rules(state, { type: 'advanceStep' })
    expect(next.ok).toBe(true)
    if (next.ok) expect(next.state.objects[recipient.id]?.power).toBe(2)
  })
})
