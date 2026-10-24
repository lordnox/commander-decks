import { describe, expect, test } from 'bun:test'
import { evaluateObjectSelector } from './compiler/runtime'
import { captureObject } from '../../objectIdentity'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame, projectForViewer } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { card, castSpells, compileCardRuleDefinition, createRuleEffect, objects, players, spell, untilCleanup } from './v1'

const permission = createRuleEffect({ duration: untilCleanup(), effect: castSpells(
  players({ relation: 'you' }), objects({ zone: 'graveyard', owner: 'you', not: { type: 'Land' } }),
) })
const redirect = createRuleEffect({ duration: untilCleanup(), effect: {
  kind: 'replacement', event: { kind: 'move', filter: { to: 'graveyard', object: { owner: 'you', card: true } } },
  transform: { kind: 'redirect', to: 'exile' },
} })
const fixture = (...instructions: NonNullable<Parameters<typeof instructionSpell>[0]['instructions']>) => createServerGame(commanderRules, {
  hands: { p1: [instructionSpell({ instructions }), cardTemplate('First', { types: ['Instant'], manaCost: '{0}' }),
    cardTemplate('Second', { types: ['Instant'], manaCost: '{0}' }), cardTemplate('Token', { token: true, types: ['Creature'], power: 1, toughness: 1 })],
    p2: [cardTemplate('Other', { types: ['Instant'], manaCost: '{0}' })] },
})
const resolveGrant = (server: ReturnType<typeof fixture>) => resolveStack(server.rules, ok(server.rules(server.state, {
  type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
})))

describe('resolved rule effects', () => {
  test('a live zone permission permits multiple casts including cards arriving after resolution, then expires', () => {
    const server = fixture(permission)
    const [grant, first, second] = server.state.zoneOrder.p1.hand
    let state = resolveGrant(server)
    expect(projectForViewer(state, 'p2').resolvedRuleEffects).toBeUndefined()
    // The grant retains the resolution's player even if the source changes control.
    state.objects[grant].controller = 'p2'
    for (const objectId of [first, second]) {
      state = ok(server.rules(state, { type: 'move', objectId, to: 'graveyard' }))
      state = restoreJournal(createJournal(state), server.rules).current()
      state = resolveStack(server.rules, ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId })))
      expect(state.objects[objectId].zone).toBe('graveyard')
      if (objectId === first) {
        // Removing the source entirely still cannot revoke the second cast.
        const zone = state.objects[grant].zone
        state.zoneOrder.p1[zone] = state.zoneOrder.p1[zone].filter(id => id !== grant)
        state.zoneCounts.p1[zone] -= 1
        delete state.objects[grant]
      }
    }
    const offTurn = { ...state, active: 'p2', priority: 'p1', step: 'precombatMain' as const }
    // An instant still uses its ordinary timing; it does not grant another seat permission.
    expect(server.rules(offTurn, { type: 'castSpell', seat: 'p1', objectId: first }).ok).toBe(true)
    expect(server.rules({ ...state, priority: 'p2' }, { type: 'castSpell', seat: 'p2', objectId: first }).ok).toBe(false)
    state = ok(server.rules({ ...state, step: 'end', priority: 'p1' }, { type: 'advanceStep' }))
    expect(state.resolvedRuleEffects).toBeUndefined()
    expect(server.rules({ ...state, priority: 'p1' }, { type: 'castSpell', seat: 'p1', objectId: second }).ok).toBe(false)
  })

  test('replacement uses ownership from every origin, excludes tokens and other owners, survives restore and source removal', () => {
    const server = fixture(redirect)
    const [grant, first, second, token] = server.state.zoneOrder.p1.hand
    const other = server.state.zoneOrder.p2.hand[0]
    let state = resolveGrant(server)
    expect(state.objects[grant].zone).toBe('exile')
    // Put a card under another player's control before it would die.
    state = ok(server.rules(state, { type: 'move', objectId: second, to: 'battlefield', controller: 'p2' }))
    state.zoneOrder.p1[state.objects[grant].zone] = state.zoneOrder.p1[state.objects[grant].zone].filter(id => id !== grant)
    state.zoneCounts.p1[state.objects[grant].zone] -= 1
    delete state.objects[grant]
    state = restoreJournal(createJournal(state), server.rules).current()
    for (const objectId of [first, second, token, other]) {
      state = ok(server.rules(state, { type: 'move', objectId, to: 'graveyard' }))
    }
    expect(state.objects[first].zone).toBe('exile')
    expect(state.objects[second].zone).toBe('exile')
    expect(state.objects[other].zone).toBe('graveyard')
    expect(state.zoneOrder.p1.exile).not.toContain(token)
    state = ok(server.rules({ ...state, step: 'end', priority: 'p1' }, { type: 'advanceStep' }))
    state = ok(server.rules(state, { type: 'move', objectId: first, to: 'graveyard' }))
    expect(state.objects[first].zone).toBe('graveyard')
  })

  test('card selectors distinguish physical cards, tokens, and spell copies', () => {
    const server = fixture()
    const [source, physical, copy, token] = server.state.zoneOrder.p1.hand
    const state = structuredClone(server.state)
    state.objects[copy].spellCopy = true
    const context = { state, controller: 'p1', source: captureObject(state.objects[source]) }
    const matches = (card: boolean) => evaluateObjectSelector(objects({ owner: 'you', card }), context).map(object => object.id)
    expect(matches(true)).toContain(physical)
    expect(matches(true)).not.toContain(token)
    expect(matches(true)).not.toContain(copy)
    expect(matches(false).sort()).toEqual([copy, token].sort())
  })

  test('compiler restricts persistent selectors to independent contexts and the supported replacement contract', () => {
    const compile = (instruction: unknown) => compileCardRuleDefinition(card([spell({ instructions: [instruction as typeof permission] })]))
    expect(() => compile({ ...permission, duration: { kind: 'permanent' } })).toThrow()
    expect(() => compile({ ...permission, effect: { ...permission.effect, cards: { kind: 'objects', filter: { among: { kind: 'choiceRef', binding: 'gone' } } } } })).toThrow()
    expect(() => compile({ ...redirect, effect: { ...redirect.effect, transform: { kind: 'suppress' } } })).toThrow()
  })
})
