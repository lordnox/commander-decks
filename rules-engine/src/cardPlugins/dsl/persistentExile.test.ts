import { linkedExileCards } from '../../rules/canonicalLinkedExile'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { captureObject } from '../../objectIdentity'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState, Plugin } from '../../types'
import { CONTROL_EVENT } from './controlConstants'
import { amountEvaluationContext, evaluateObjectSelector } from './compiler/runtime'
import { evaluateStatDelta } from './compiler/evaluate'
import { may, self, whenever, activated, card, compileCardRuleDefinition, count, createDefinitionSnapshot, forEach, linkExile, modifyStats, move, multiply, objects, ownerOf, ref, sacrificeCost, select, staticAbility, sumCharacteristics, target } from './v1'

const linked = objects({ zone: 'exile', exiledWith: ref('source') })
const definition = (signed = false) => createDefinitionSnapshot(compileCardRuleDefinition(card([
  activated({ decisions: { targets: [select({ filter: objects({ type: 'Creature' }), count: 1 })] }, instructions: [linkExile({ targets: target(0) })] }),
  activated({ costs: [sacrificeCost(ref('source'), 1)], instructions: [forEach({ of: objects({ zone: 'exile', type: 'Creature', exiledWith: ref('source') }), instructions: [move({ targets: ref('triggering.object.after'), to: 'battlefield', controller: ownerOf(ref('triggering.object.after')) })] })] }),
  staticAbility(modifyStats({ targets: objects({ among: ref('source') }), power: signed ? sumCharacteristics(linked, 'power') : multiply(count(linked), 2), toughness: signed ? sumCharacteristics(linked, 'toughness') : multiply(count(linked), 2) })),
])))
const setup = (replacement?: Plugin, signed = false) => createServerGame(commanderRules, {
  players: 2,
  battlefield: {
    p1: [cardTemplate('Holder fixture', { types: ['Creature'], power: 2, toughness: 2, ruleDefinition: definition(signed) })],
    p2: [cardTemplate('Card A', { types: ['Creature'], power: -2, toughness: 5 }), cardTemplate('Card B', { types: ['Creature'], power: 3, toughness: 4 })],
  },
}, { random: () => 0, ...(replacement ? { cardPlugins: [replacement] } : {}) })
const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!
const activate = (server: ReturnType<typeof setup>, state: GameState, index: number, targetName?: string) => resolveStack(server.rules, ok(server.rules(state, {
  type: 'activateAbility', seat: 'p1', objectId: named(state, 'Holder fixture').id, abilityId: `$.abilities[${index}]`,
  ...(targetName ? { targets: [{ kind: 'object' as const, objectId: named(state, targetName).id }] } : {}),
})))
const context = (state: GameState) => ({ state, controller: 'p1', source: captureObject(named(state, 'Holder fixture')) })

test.each([true, false])('catalog optional linked exile resolves a self target after the may choice (accept: %s)', accept => {
  const server = createServerGame(commanderRules, {
    players: 3,
    hands: { p1: [cardTemplate('Phyrexian Ingester')] },
    battlefield: {
      p1: [cardTemplate('Own Bear', { types: ['Creature'], power: 2, toughness: 2 })],
      p2: [cardTemplate('Big Foe', { types: ['Creature'], power: 4, toughness: 6 })],
    },
  }, { random: () => 0.5 })
  const source = named(server.state, 'Phyrexian Ingester')
  const entered = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'move', objectId: source.id, to: 'battlefield',
  })))
  const selection = pendingSelectionFor(entered, 'p1')!
  expect(selection.candidates).toContain(source.id)
  const targeted = resolveStack(server.rules, ok(server.rules(entered, {
    type: 'selectCards', seat: 'p1', selectionId: selection.id,
    kind: 'choose', count: 1, objectIds: [source.id],
  })))
  // Target announcement does not accept the optional effect during resolution (CR 608.2d).
  expect(targeted.objects[source.id].zone).toBe('battlefield')
  const option = pendingOptionSelection(targeted, 'p1')!
  expect(option).toBeDefined()
  const resolved = resolveStack(server.rules, ok(server.rules(targeted, {
    type: 'selectOption', seat: 'p1', selectionId: option.id,
    optionId: option.options[accept ? 0 : 1].id,
  })))
  expect(resolved.objects[source.id].zone).toBe(accept ? 'exile' : 'battlefield')
  expect(resolved.stack).toHaveLength(0)
  expect(pendingOptionSelection(resolved, 'p1')).toBeUndefined()
  for (const name of ['Own Bear', 'Big Foe']) expect(named(resolved, name).zone).toBe('battlefield')
})

test('persistent linked sets accumulate exact identities and return under their owners after source sacrifice', () => {
  const server = setup()
  let state = activate(server, server.state, 0, 'Card A')
  state = activate(server, structuredClone(state), 0, 'Card B')
  expect(evaluateObjectSelector(linked, context(state)).map(object => object.name).sort()).toEqual(['Card A', 'Card B'])
  expect(named(state, 'Holder fixture').power).toBe(6)
  state = ok(server.rules(state, { type: CONTROL_EVENT.change, objectRef: captureObject(named(state, 'Card B')).ref, controller: 'p1' }))
  state = activate(server, JSON.parse(JSON.stringify(state)), 1)
  expect(named(state, 'Holder fixture').zone).toBe('graveyard')
  for (const name of ['Card A', 'Card B']) expect(named(state, name)).toMatchObject({ zone: 'battlefield', controller: 'p2' })
})

test('a card leaving exile and returning as a new incarnation no longer belongs to the set', () => {
  const server = setup()
  let state = activate(server, server.state, 0, 'Card A')
  const id = named(state, 'Card A').id
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'graveyard' }))
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'exile' }))
  expect(evaluateObjectSelector(linked, context(state))).toHaveLength(0)
  expect(named(state, 'Holder fixture').power).toBe(2)
  state = activate(server, state, 1)
  expect(state.objects[id].zone).toBe('exile')
})

test('a fresh source incarnation cannot query or return an older source incarnation’s links', () => {
  const server = setup()
  let state = activate(server, server.state, 0, 'Card A')
  const id = named(state, 'Holder fixture').id
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'hand' }))
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'battlefield' }))
  expect(evaluateObjectSelector(linked, context(state))).toHaveLength(0)
  state = activate(server, state, 1)
  expect(named(state, 'Card A').zone).toBe('exile')
})

test.each(['redirect', 'prevent'] as const)('a %s replacement never creates a link for an unsuccessful exile', mode => {
  const replacement: Plugin = { id: 'fixture.replaceLinkedMove', replace: ({ event }) => {
    if (event.type !== 'move' || event.to !== 'exile') return
    return mode === 'redirect' ? { ...event, to: 'hand' } : null
  } }
  const server = setup(replacement)
  const state = activate(server, server.state, 0, 'Card A')
  expect(evaluateObjectSelector(linked, context(state))).toHaveLength(0)
  expect(named(state, 'Holder fixture').power).toBe(2)
  expect(named(state, 'Card A').zone).toBe(mode === 'redirect' ? 'hand' : 'battlefield')
})

test('linked selectors support graveyard cards and signed characteristic sums without sharing unrelated exile', () => {
  const server = setup()
  let state = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Card A').id, to: 'graveyard' }))
  state = activate(server, state, 0, 'Card A')
  const ctx = context(state)
  expect(evaluateStatDelta(sumCharacteristics(linked, 'power'), amountEvaluationContext(ctx))).toBe(-2)
  expect(evaluateStatDelta(sumCharacteristics(linked, 'toughness'), amountEvaluationContext(ctx))).toBe(5)
  expect(evaluateStatDelta(sumCharacteristics(objects({ zone: 'command' }), 'power'), amountEvaluationContext(ctx))).toBe(0)
  expect(() => compileCardRuleDefinition(card([activated({ instructions: [{ kind: 'draw', targets: ref('controller'), count: sumCharacteristics(linked, 'power') as never }] })]))).toThrow()
})

test('linked characteristic modifiers independently preserve signed power and toughness and recompute on departure', () => {
  const server = setup(undefined, true)
  let state = activate(server, server.state, 0, 'Card A')
  expect(named(state, 'Holder fixture')).toMatchObject({ power: 0, toughness: 7 })
  state = activate(server, state, 0, 'Card B')
  expect(named(state, 'Holder fixture')).toMatchObject({ power: 3, toughness: 11 })
  state = ok(server.rules(state, { type: 'move', objectId: named(state, 'Card A').id, to: 'hand' }))
  expect(named(state, 'Holder fixture')).toMatchObject({ power: 5, toughness: 6 })
})

describe('optional targeted linked exile and independent stat bonuses', () => {
  const sourceName = 'Entry holder fixture'
  const source = () => cardTemplate(sourceName, {
    types: ['Creature'], power: 3, toughness: 3,
    ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(self.enters, {
        decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', token: false }), count: 1 })] },
        instructions: [may(linkExile({ targets: target(0) }))],
      }),
      staticAbility(modifyStats({
        targets: objects({ among: ref('source') }),
        power: sumCharacteristics(linked, 'power'),
        toughness: sumCharacteristics(linked, 'toughness'),
      })),
    ]))),
  })
  const enter = () => {
    const server = createServerGame(commanderRules, {
      players: 3,
      hands: { p1: [source()] },
      battlefield: {
        p1: [cardTemplate('Ally fixture', { types: ['Creature'], power: 2, toughness: 2 })],
        p2: [
          cardTemplate('Prey fixture', { types: ['Creature'], power: 6, toughness: 8, counters: { '+1/+1': 2 } }),
          cardTemplate('Token fixture', { types: ['Creature'], token: true, power: 9, toughness: 9 }),
          cardTemplate('Relic fixture', { types: ['Artifact'] }),
        ],
        p3: [cardTemplate('Hexproof fixture', { types: ['Creature'], power: 5, toughness: 5, oracleText: 'Hexproof' })],
      },
    }, { random: () => 0 })
    const state = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, sourceName).id, to: 'battlefield' }))
    return { server, state }
  }
  const pick = (state: GameState, names: string[], seat = 'p1') => ({
    type: 'selectCards' as const, seat, kind: 'choose' as const, count: 1,
    objectIds: names.map(name => named(state, name).id),
  })
  const finish = (server: ReturnType<typeof createServerGame>, state: GameState, accept = true) => {
    const choosing = resolveStack(server.rules, state)
    const option = pendingOptionSelection(choosing, 'p1')!
    expect(option).toBeDefined()
    const done = resolveStack(server.rules, ok(server.rules(choosing, {
      type: 'selectOption', seat: 'p1', selectionId: option.id, optionId: option.options[accept ? 0 : 1].id,
    })))
    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
    expect(pendingOptionSelection(done, 'p1')).toBeUndefined()
    expect(done.stack).toHaveLength(0)
    return done
  }
  const imprinted = () => {
    const { server, state } = enter()
    const done = finish(server, ok(server.rules(state, pick(state, ['Prey fixture']))))
    // Counters vanish in exile: independent printed 4/6 characteristics contribute.
    expect(named(done, sourceName)).toMatchObject({ power: 7, toughness: 9 })
    return { server, done }
  }

  test('entry targeting includes self and allies but excludes tokens, noncreatures, and opposing hexproof', () => {
    const { server, state } = enter()
    const selection = pendingSelectionFor(state, 'p1')!
    expect(selection.candidates.map(id => state.objects[id].name).sort()).toEqual(['Ally fixture', sourceName, 'Prey fixture'].sort())
    expect(selection).toMatchObject({ kind: 'choose', count: 1 })
    for (const names of [['Token fixture'], ['Relic fixture'], ['Hexproof fixture'], ['Ally fixture', 'Prey fixture']]) {
      expect(server.rules(state, pick(state, names)).ok).toBe(false)
    }
    expect(server.rules(state, pick(state, ['Prey fixture'], 'p2')).ok).toBe(false)
    expect(server.rules(state, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)
    const stacked = ok(server.rules(state, pick(state, ['Prey fixture'])))
    expect(stacked.stack[0]).toMatchObject({ kind: 'ability', targets: [{ kind: 'object', objectId: named(state, 'Prey fixture').id }] })
    expect(named(stacked, 'Prey fixture').zone).toBe('battlefield')
  })

  test('exile contributes printed power and toughness permanently without returning on source death', () => {
    const { server, done } = imprinted()
    expect(named(done, 'Prey fixture').zone).toBe('exile')
    const gone = ok(server.rules(done, { type: 'move', objectId: named(done, sourceName).id, to: 'graveyard' }))
    expect(named(gone, 'Prey fixture').zone).toBe('exile')
    expect(linkedExileCards(gone, named(gone, sourceName))).toEqual([])
    expect(gone.linkedExileSets?.[0].source.incarnation).not.toBe(named(gone, sourceName).incarnation)
  })

  test.each(['hand', 'graveyard'] as const)('a fresh source returned through %s forgets the old link on decline or a second exile', via => {
    const { server, done } = imprinted()
    const id = named(done, sourceName).id
    const incarnation = done.objects[id].incarnation
    const left = ok(server.rules(done, { type: 'move', objectId: id, to: via }))
    expect(linkedExileCards(left, left.objects[id])).toEqual([])
    expect(left.linkedExileSets?.[0].source.incarnation).toBe(incarnation)
    const back = ok(server.rules(left, { type: 'move', objectId: id, to: 'battlefield' }))
    expect(back.objects[id].incarnation).toBe(incarnation + 2)
    expect(pendingSelectionFor(back, 'p1')).toBeDefined()
    expect(back.objects[id]).toMatchObject({ power: 3, toughness: 3 })
    const stacked = ok(server.rules(back, pick(back, ['Ally fixture'])))
    const declined = finish(server, stacked, false)
    expect(declined.objects[id]).toMatchObject({ power: 3, toughness: 3 })
    expect(linkedExileCards(declined, declined.objects[id])).toEqual([])
    expect(named(declined, 'Prey fixture').zone).toBe('exile')
    const second = finish(server, stacked)
    expect(named(second, 'Ally fixture').zone).toBe('exile')
    expect(linkedExileCards(second, second.objects[id]).map(object => object.id)).toEqual([named(second, 'Ally fixture').id])
    expect(second.objects[id]).toMatchObject({ power: 5, toughness: 5 })
    expect(named(second, 'Prey fixture').zone).toBe('exile')
  })

  test.each(['Ally fixture', sourceName])('a controlled creature can be exiled, including the source (%s)', name => {
    const { server, state } = enter()
    const done = finish(server, ok(server.rules(state, pick(state, [name]))))
    expect(named(done, name).zone).toBe('exile')
    if (name === 'Ally fixture') expect(named(done, sourceName)).toMatchObject({ power: 5, toughness: 5 })
  })

  test('declining the optional operation exiles nothing and opens no further choice', () => {
    const { server, state } = enter()
    const done = finish(server, ok(server.rules(state, pick(state, ['Prey fixture']))), false)
    for (const name of [sourceName, 'Ally fixture', 'Prey fixture', 'Token fixture', 'Hexproof fixture']) {
      expect(named(done, name).zone).toBe('battlefield')
    }
    expect(named(done, sourceName)).toMatchObject({ power: 3, toughness: 3 })
  })

  test('a departed target fizzles before the optional operation without retargeting or changing stats', () => {
    const { server, state } = enter()
    const stacked = ok(server.rules(state, pick(state, ['Prey fixture'])))
    const gone = ok(server.rules(stacked, { type: 'move', objectId: named(stacked, 'Prey fixture').id, to: 'graveyard' }))
    const done = resolveStack(server.rules, gone)
    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
    expect(pendingOptionSelection(done, 'p1')).toBeUndefined()
    expect(done.stack).toHaveLength(0)
    expect(named(done, 'Prey fixture').zone).toBe('graveyard')
    expect(named(done, 'Ally fixture').zone).toBe('battlefield')
    expect(named(done, sourceName)).toMatchObject({ power: 3, toughness: 3 })
  })
})

test('catalog Bishop of Binding pumps a target Vampire at attack time by its linked exile power', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Bishop of Binding')] },
    battlefield: {
      p1: [cardTemplate('Vampire Recruit', { types: ['Creature'], subtypes: ['Vampire'], power: 2, toughness: 2 })],
      p2: [cardTemplate('Tall Foe', { types: ['Creature'], power: 6, toughness: 6 })],
    },
  }, { random: () => 0.5 })
  const bishopId = named(server.state, 'Bishop of Binding').id
  const foeId = named(server.state, 'Tall Foe').id
  const vampireId = named(server.state, 'Vampire Recruit').id

  const entered = resolveStack(server.rules, ok(server.rules(server.state, { type: 'move', objectId: bishopId, to: 'battlefield' })))
  const cage = pendingSelectionFor(entered, 'p1')!
  let state = resolveStack(server.rules, ok(server.rules(entered, {
    type: 'selectCards', seat: 'p1', selectionId: cage.id, kind: 'choose', count: cage.count, objectIds: [foeId],
  })))
  expect(state.objects[foeId]).toMatchObject({ zone: 'exile', exiledWith: bishopId })
  state.objects[bishopId].summoningSickness = false
  state.active = 'p1'
  state.priority = 'p1'
  state.step = 'declareAttackers'

  state = ok(server.rules(state, { type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: bishopId, defender: 'p2' }] }))
  const pump = pendingSelectionFor(state, 'p1')
  expect(pump).toBeDefined()
  state = resolveStack(server.rules, ok(server.rules(state, {
    type: 'selectCards', seat: 'p1', selectionId: pump!.id, kind: 'choose', count: 1, objectIds: [vampireId],
  })))
  expect(state.objects[vampireId]).toMatchObject({ power: 8, toughness: 8 })
})
