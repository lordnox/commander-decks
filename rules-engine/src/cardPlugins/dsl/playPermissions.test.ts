import { describe, expect, test } from 'bun:test'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, objects, players, playLands, revealLibraryTop, staticAbility } from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { availableActions } from '../../actions'
import { ok } from '../../testHelpers'
import { createJournal, restoreJournal } from '../../journal'

const fixture = (zone: 'graveyard' | 'library', topOnly?: true) => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    ...(zone === 'library' ? [staticAbility(revealLibraryTop(players({ relation: 'you' })))] : []),
    staticAbility(playLands(players({ relation: 'you' }), objects({ zone, owner: 'you', type: 'Land' }), topOnly ? { topOnly } : {})),
  ])))
  return createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Permission source', { types: ['Artifact'], ruleDefinition: definition })] },
    libraries: { p1: [cardTemplate('First', { types: ['Land'] }), cardTemplate('Second', { types: ['Land'] })] },
  }, { random: () => 0.5 })
}

describe('canonical land permissions', () => {
  test('graveyard permission survives restore, uses ordinary limits, and disappears with its source', () => {
    const server = fixture('graveyard')
    const source = server.state.zoneOrder.p1.battlefield[0]
    const land = server.state.zoneOrder.p1.library[0]
    const moved = ok(server.rules(server.state, { type: 'move', objectId: land, to: 'graveyard' }))
    const restored = restoreJournal(createJournal(moved), server.rules).current()
    expect(availableActions(restored, 'p1').some(action => action.kind === 'playLand' && action.objectId === land)).toBe(true)
    const played = ok(server.rules(restored, { type: 'playLand', seat: 'p1', objectId: land }))
    expect(played.objects[land].zone).toBe('battlefield')
    expect(played.players.p1.landsPlayed).toBe(1)
    const again = ok(server.rules(played, { type: 'move', objectId: land, to: 'graveyard' }))
    expect(server.rules(again, { type: 'playLand', seat: 'p1', objectId: land }).ok).toBe(false)
    const removed = ok(server.rules(restored, { type: 'move', objectId: source, to: 'graveyard' }))
    expect(server.rules(removed, { type: 'playLand', seat: 'p1', objectId: land }).ok).toBe(false)
  })

  test('only the live top qualifies and normal timing remains required', () => {
    const server = fixture('library', true)
    const [first, second] = server.state.zoneOrder.p1.library
    expect(server.state.objects[first].knownTo).toEqual(server.state.playerOrder)
    expect(server.state.objects[second].knownTo).toBeUndefined()
    expect(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: second }).ok).toBe(false)
    const changed = ok(server.rules(server.state, { type: 'move', objectId: first, to: 'graveyard' }))
    expect(changed.objects[second].knownTo).toEqual(changed.playerOrder)
    expect(availableActions(changed, 'p1').some(action => action.kind === 'playLand' && action.objectId === second)).toBe(true)
    expect(server.rules({ ...changed, step: 'declareAttackers' }, { type: 'playLand', seat: 'p1', objectId: second }).ok).toBe(false)
    const source = changed.zoneOrder.p1.battlefield[0]
    const removed = ok(server.rules(changed, { type: 'move', objectId: source, to: 'graveyard' }))
    expect(removed.objects[second].knownTo).toBeUndefined()
    expect(ok(server.rules(changed, { type: 'playLand', seat: 'p1', objectId: second })).objects[second].zone).toBe('battlefield')
  })

  test('top visibility updates within a multi-card draw', () => {
    const server = fixture('library', true)
    const [first, second] = server.state.zoneOrder.p1.library
    const drawn = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 2 }))
    expect(drawn.zoneOrder.p1.hand).toContain(first)
    expect(drawn.zoneOrder.p1.hand).toContain(second)
    // Each card was public immediately before its own draw.
    expect(drawn.objects[first].knownTo).toEqual(drawn.playerOrder)
    expect(drawn.objects[second].knownTo).toEqual(drawn.playerOrder)
  })

  test('a phased source cannot authorize a library land', () => {
    const server = fixture('library', true)
    const state = structuredClone(server.state)
    const source = state.objects[state.zoneOrder.p1.battlefield[0]]
    source.phasedOut = true
    const land = state.zoneOrder.p1.library[0]
    expect(server.rules(state, { type: 'playLand', seat: 'p1', objectId: land }).ok).toBe(false)
    expect(availableActions(state, 'p1').some(action => action.kind === 'playLand' && action.objectId === land)).toBe(false)
  })


  test('land permissions evaluate the played face of a modal double-faced card', () => {
    const server = fixture('library', true)
    const state = structuredClone(server.state)
    const land = state.objects[state.zoneOrder.p1.library[0]]
    land.types = ['Instant']
    land.frontFace = { types: ['Instant'], subtypes: [], supertypes: [], manaCost: '{U}', manaValue: 1, colors: 'U' }
    land.backFace = { types: ['Land'], subtypes: [], supertypes: [], manaCost: '', manaValue: 0, colors: '' }
    expect(server.rules(state, { type: 'playLand', seat: 'p1', objectId: land.id, face: 'front' }).ok).toBe(false)
    expect(availableActions(state, 'p1').some(action => action.kind === 'playLand' && action.objectId === land.id)).toBe(true)
    const played = ok(server.rules(state, { type: 'playLand', seat: 'p1', objectId: land.id, face: 'back' }))
    expect(played.objects[land.id].types).toEqual(['Land'])
  })

})
