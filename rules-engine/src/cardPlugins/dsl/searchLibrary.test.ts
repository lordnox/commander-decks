import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame, projectForViewer } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { activated, card, compileCardRuleDefinition, createDefinitionSnapshot, lifeCost, objects, ref, sacrificeCost, searchLibrary, tapCost } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find((object) => object.name === name)!
const singleSearchSetup = (library = ['Prize', 'Filler A', 'Filler B']) => createServerGame(commanderRules, {
  players: 2,
  hands: { p1: [instructionSpell({ instructions: [searchLibrary({ bindChoice: 'found', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you' }), count: 1, to: 'graveyard' })] })] },
  libraries: { p1: library.map((name) => cardTemplate(name)), p2: [cardTemplate('Their Secret')] },
}, { random: () => 0 })
const singleSearchBegin = (server: ReturnType<typeof singleSearchSetup>) => {
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id }))
  return resolveStack(server.rules, cast)
}
const singleSearchFinish = (server: ReturnType<typeof singleSearchSetup>, state: GameState) => {
  const pick = pendingSelectionFor(state, 'p1')!
  return ok(server.rules(state, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [named(state, 'Prize').id] }))
}

test('searchLibrary count privately chooses any owned card and shuffles', () => {
  const server = singleSearchSetup()
  const searching = singleSearchBegin(server)
  const pick = pendingSelectionFor(searching, 'p1')!
  expect(pick.viewLibrary).toBe(true)
  expect(pick.candidates).toEqual(searching.zoneOrder.p1.library)
  expect(pick.min).toBe(1)
  expect(pick.count).toBe(1)
  expect(server.rules(searching, {
    type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [],
  }).ok).toBe(false)
  expect(pendingSelectionFor(projectForViewer(searching, 'p2'), 'p1')).toBeUndefined()
  expect(Object.values(projectForViewer(searching, 'p2').objects).some((object) => object.name === 'Prize')).toBe(false)
  const found = singleSearchFinish(server, searching)
  expect(named(found, 'Prize').zone).toBe('graveyard')
  expect(named(found, 'Their Secret').zone).toBe('library')
  expect(found.zoneOrder.p1.library).toEqual([named(found, 'Filler B').id, named(found, 'Filler A').id])
  expect(named(found, 'Instruction fixture').zone).toBe('graveyard')
  expect(found.resolution).toBeUndefined()
})

test('searchLibrary resumes its typed pending choice after journal restore', () => {
  const server = singleSearchSetup()
  const searching = singleSearchBegin(server)
  const restored = restoreJournal(createJournal(searching), server.rules).current()
  expect(singleSearchFinish(server, restored)).toEqual(singleSearchFinish(server, searching))
})

test('searchLibrary finishes resolving an empty library without a selection', () => {
  const server = singleSearchSetup([])
  const resolved = singleSearchBegin(server)
  expect(pendingSelectionFor(resolved, 'p1')).toBeUndefined()
  expect(resolved.resolution).toBeUndefined()
  expect(named(resolved, 'Instruction fixture').zone).toBe('graveyard')
})

const forestSearchSetup = (tapped?: boolean) => createServerGame(commanderRules, {
  players: 2,
  hands: {
    p1: [
      instructionSpell({ instructions: [searchLibrary({
        bindChoice: 'forest',
        chooser: ref('controller'),
        filter: objects({ zone: 'library', owner: 'you', subtypes: ['Forest'] }),
        min: 0,
        max: 1,
        to: 'battlefield',
        ...(tapped !== undefined ? { tapped } : {}),
      })] }),
      cardTemplate('Hand Forest', { types: ['Land'], subtypes: ['Forest'] }),
    ],
  },
  libraries: {
    p1: [
      cardTemplate('Library Forest', { types: ['Land'], subtypes: ['Forest'] }),
      cardTemplate('Library Island', { types: ['Land'], subtypes: ['Island'] }),
    ],
    p2: [cardTemplate('Their Secret')],
  },
}, { random: () => 0 })

test.each([false, true])('searchLibrary moves a filtered land onto the battlefield with tapped=%s', (tapped) => {
  const server = forestSearchSetup(tapped)
  const searching = singleSearchBegin(server)
  const pick = pendingSelectionFor(searching, 'p1')!
  expect(pick.candidates).toEqual([named(searching, 'Library Forest').id])
  expect(pendingSelectionFor(projectForViewer(searching, 'p2'), 'p1')).toBeUndefined()

  const restored = restoreJournal(createJournal(searching), server.rules).current()
  const found = ok(server.rules(restored, {
    type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1,
    objectIds: [named(restored, 'Library Forest').id],
  }))
  expect(named(found, 'Library Forest')).toMatchObject({ zone: 'battlefield', controller: 'p1', tapped })
  expect(named(found, 'Library Island').zone).toBe('library')
  expect(found.resolution).toBeUndefined()
  const played = ok(server.rules(found, {
    type: 'playLand', seat: 'p1', objectId: named(found, 'Hand Forest').id,
  }))
  expect(named(played, 'Hand Forest').zone).toBe('battlefield')
  expect(played.players.p1.landsPlayed).toBe(1)
})

test('searchLibrary permits failing to find a matching card during a hidden-zone search', () => {
  const server = forestSearchSetup()
  const searching = singleSearchBegin(server)
  const pick = pendingSelectionFor(searching, 'p1')!
  const declined = ok(server.rules(searching, {
    type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [],
  }))
  expect(named(declined, 'Library Forest').zone).toBe('library')
  expect(declined.resolution).toBeUndefined()
})

const boundedSearchSetup = () => createServerGame(commanderRules, {
  players: 2,
  hands: { p1: [instructionSpell({ instructions: [searchLibrary({ bindChoice: 'found', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Creature' }), min: 0, max: 3, to: 'graveyard' })] })] },
  libraries: {
    p1: [...['First', 'Second', 'Third', 'Fourth'].map((name) => cardTemplate(name, { types: ['Creature'] })), cardTemplate('Noncreature', { types: ['Instant'] })],
    p2: [cardTemplate('Their Creature', { types: ['Creature'] })],
  },
}, { random: () => 0 })
const boundedSearchBegin = (server: ReturnType<typeof boundedSearchSetup>) => {
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id }))
  return resolveStack(server.rules, cast)
}
const boundedSearchSelection = (state: GameState, names: string[]) => ({
  type: 'selectCards' as const, seat: 'p1', selectionId: pendingSelectionFor(state, 'p1')!.id,
  kind: 'choose' as const, count: pendingSelectionFor(state, 'p1')!.count, objectIds: names.map((name) => named(state, name).id),
})

test('searchLibrary privately chooses up to three creatures, moves them once, and shuffles', () => {
  const server = boundedSearchSetup()
  const searching = boundedSearchBegin(server)
  const pick = pendingSelectionFor(searching, 'p1')!
  expect(pick.candidates.map((id) => searching.objects[id].name)).toEqual(['First', 'Second', 'Third', 'Fourth'])
  expect(pendingSelectionFor(projectForViewer(searching, 'p2'), 'p1')).toBeUndefined()
  expect(server.rules(searching, boundedSearchSelection(searching, ['Noncreature'])).ok).toBe(false)
  expect(server.rules(searching, boundedSearchSelection(searching, ['First', 'Second', 'Third', 'Fourth'])).ok).toBe(false)
  expect(server.rules(searching, boundedSearchSelection(searching, ['First', 'First'])).ok).toBe(false)
  const found = ok(server.rules(searching, boundedSearchSelection(searching, ['First', 'Second', 'Third'])))
  expect(found.zoneOrder.p1.graveyard.map((id) => found.objects[id].name)).toEqual(['First', 'Second', 'Third', 'Instruction fixture'])
  expect(found.zoneOrder.p1.library.map((id) => found.objects[id].name)).toEqual(['Noncreature', 'Fourth'])
  expect(found.resolution).toBeUndefined()
})

test('searchLibrary allows choosing none and shuffles even without a found card', () => {
  const server = boundedSearchSetup()
  const searching = boundedSearchBegin(server)
  const found = ok(server.rules(searching, boundedSearchSelection(searching, [])))
  expect(found.zoneOrder.p1.graveyard.map((id) => found.objects[id].name)).toEqual(['Instruction fixture'])
  expect(found.zoneOrder.p1.library).not.toEqual(searching.zoneOrder.p1.library)
  expect(found.zoneOrder.p1.library).toHaveLength(5)
})

test('searchLibrary restores a private pending choice before moving two cards', () => {
  const server = boundedSearchSetup()
  const searching = boundedSearchBegin(server)
  const restored = restoreJournal(createJournal(searching), server.rules).current()
  const event = boundedSearchSelection(searching, ['First', 'Second'])
  expect(ok(server.rules(restored, event))).toEqual(ok(server.rules(searching, event)))
})


test('an activated search pays life and source costs before its stack resolution opens a typed choice', () => {
  const ruleDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    activated({ costs: [lifeCost(1), tapCost(), sacrificeCost(ref('source'), 1)], instructions: [searchLibrary({ bindChoice: 'found', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land' }), min: 0, max: 1, to: 'battlefield', tapped: true })] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Search source', { types: ['Land'], ruleDefinition })] },
    libraries: { p1: [cardTemplate('Found land', { types: ['Land'] }), cardTemplate('Other card', { types: ['Artifact'] })] },
  }, { random: () => 0 })
  const source = named(server.state, 'Search source').id
  const activatedState = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source, abilityId: '$.abilities[0]' }))
  expect(activatedState.players.p1.life).toBe(39)
  expect(activatedState.objects[source].zone).toBe('graveyard')
  expect(activatedState.stack).toHaveLength(1)
  expect(pendingSelectionFor(activatedState, 'p1')).toBeUndefined()
  const searching = resolveStack(server.rules, JSON.parse(JSON.stringify(activatedState)))
  const pick = pendingSelectionFor(searching, 'p1')!
  const found = named(searching, 'Found land').id
  expect(pick.candidates).toEqual([found])
  expect(server.rules(searching, { type: 'activateAbility', seat: 'p1', objectId: source, abilityId: '$.abilities[0]' }).ok).toBe(false)
  const resolved = ok(server.rules(searching, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [found] }))
  expect(resolved.objects[found]).toMatchObject({ zone: 'battlefield', tapped: true })
  expect(resolved.stack).toHaveLength(0)
  expect(resolved.resolution).toBeUndefined()
})

test('searchLibrary reveals the chosen card before moving it into a publicly known hand', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [searchLibrary({ bindChoice: 'found', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you' }), min: 0, max: 1, to: 'hand', reveal: true })] })] },
    libraries: { p1: [cardTemplate('Chosen'), cardTemplate('Still secret')] },
  }, { random: () => 0 })
  const searching = singleSearchBegin(server)
  expect(Object.values(server.project(searching, 'p2').objects).some(object => object.name === 'Chosen')).toBe(false)
  const pick = pendingSelectionFor(searching, 'p1')!
  const resolved = ok(server.rules(searching, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [named(searching, 'Chosen').id] }))
  const projected = server.project(resolved, 'p2')
  expect(Object.values(projected.objects).find(object => object.name === 'Chosen')?.zone).toBe('hand')
  expect(Object.values(projected.objects).some(object => object.name === 'Still secret')).toBe(false)
})


test.each([2, 3, 4])('a searched land is counted before conditional untap with %s other lands', others => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Fabled Passage'), ...Array.from({ length: others }, (_, index) => cardTemplate(`Existing land ${index}`, { types: ['Land'], tapped: true }))] },
    libraries: { p1: [cardTemplate('Basic prize', { types: ['Land'], supertypes: ['Basic'] }), cardTemplate('Nonbasic decoy', { types: ['Land'] })] },
  }, { random: () => 0 })
  const source = named(server.state, 'Fabled Passage').id
  const activated = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source, abilityId: '$.abilities[0]' }))
  expect(activated.objects[source].zone).toBe('graveyard')
  const searching = resolveStack(server.rules, activated)
  const pick = pendingSelectionFor(searching, 'p1')!
  const prize = named(searching, 'Basic prize').id
  expect(pick.candidates).toEqual([prize])
  const finished = ok(server.rules(JSON.parse(JSON.stringify(searching)), { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [prize] }))
  expect(finished.objects[prize]).toMatchObject({ zone: 'battlefield', tapped: others < 3 })
  expect(named(finished, 'Existing land 0').tapped).toBe(true)
  expect(finished.players.p1.landsPlayed).toBe(0)
  expect(finished.stack).toHaveLength(0)
  expect(finished.resolution).toBeUndefined()
})

test('an optional basic search can find no card without untapping an existing land', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Fabled Passage'), ...Array.from({ length: 4 }, (_, index) => cardTemplate(`Existing land ${index}`, { types: ['Land'], tapped: true }))] },
    libraries: { p1: [cardTemplate('Basic prize', { types: ['Land'], supertypes: ['Basic'] })] },
  }, { random: () => 0 })
  const activated = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: named(server.state, 'Fabled Passage').id, abilityId: '$.abilities[0]' }))
  const searching = resolveStack(server.rules, activated)
  const pick = pendingSelectionFor(searching, 'p1')!
  const finished = ok(server.rules(searching, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [] }))
  expect(named(finished, 'Basic prize').zone).toBe('library')
  expect(finished.zoneOrder.p1.battlefield.every(id => finished.objects[id].tapped)).toBe(true)
  expect(finished.resolution).toBeUndefined()
})
