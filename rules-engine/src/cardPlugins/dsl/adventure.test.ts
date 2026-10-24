import { expect, test } from 'bun:test'
import { legalActsFor } from '../../actions'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate, forest } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import {
  card,
  choice,
  compileCardRuleDefinition,
  count,
  createDefinitionSnapshot,
  createToken,
  modifyEvent,
  objects,
  putCounters,
  ref,
  replacement,
  spell,
  staticAbility,
  token,
  wouldEnter,
} from './v1'

const snapshot = (abilities: Parameters<typeof card>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

const landProgram = snapshot([
  staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
])

const adventureProgram = snapshot([
  spell({
    instructions: [
      createToken({
        count: 1,
        targets: ref('controller'),
        token: token('Hero-1-1'),
        bindChoice: 'hero',
      }),
      putCounters({
        targets: choice('hero'),
        counter: '+1/+1',
        count: count(objects({ zone: 'battlefield', controller: 'you', type: 'Land' })),
      }),
    ],
  }),
])

const landAdventure = () => cardTemplate('Town Square // Lasting March', {
  types: ['Land'],
  subtypes: ['Town'],
  manaCost: '',
  manaValue: 0,
  colors: [],
  ruleDefinition: landProgram,
  frontFace: {
    types: ['Land'],
    subtypes: ['Town'],
    supertypes: [],
    manaCost: '',
    manaValue: 0,
    colors: [],
    oracleText: 'This land enters tapped.',
    ruleDefinition: landProgram,
  },
  backFace: {
    types: ['Sorcery'],
    subtypes: ['Adventure'],
    supertypes: [],
    manaCost: '{2}{G}',
    manaValue: 3,
    colors: ['G'],
    oracleText: 'Create a Hero and put counters.',
    ruleDefinition: adventureProgram,
  },
})

const funded = (state: ReturnType<typeof createServerGame>['state']) => ({
  ...state,
  players: {
    ...state.players,
    p1: {
      ...state.players.p1,
      mana: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 2 },
    },
  },
})

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

test('a land adventure is cast from hand, not as a land spell', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [landAdventure()] },
    battlefield: { p1: [forest()] },
  })
  const objectId = server.state.zoneOrder.p1.hand[0]!
  const ready = funded(server.state)
  const casts = legalActsFor(ready, 'p1').filter(action =>
    action.kind === 'castSpell' && action.objectId === objectId)
  expect(casts).toHaveLength(1)
  expect(casts[0]).toMatchObject({ adventureCast: true, castLabel: 'Lasting March' })
  expect(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId }).ok).toBe(false)
  expect(legalActsFor(ready, 'p1').some(action =>
    action.kind === 'playLand' && action.objectId === objectId)).toBe(true)
})

test('resolving a land adventure creates the bound token, then permits the land play', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [landAdventure()] },
    battlefield: { p1: [forest(), forest()] },
  })
  const objectId = server.state.zoneOrder.p1.hand[0]!
  const resolved = resolveStack(server.rules, ok(server.rules(funded(server.state), {
    type: 'castSpell',
    seat: 'p1',
    objectId,
    adventureCast: true,
  })))
  const hero = named(resolved, 'Hero')
  expect(hero).toMatchObject({ zone: 'battlefield', token: true, types: ['Creature'] })
  expect(hero.counters['+1/+1']).toBe(2)
  expect(resolved.objects[objectId]).toMatchObject({
    zone: 'exile',
    adventured: true,
    adventureReady: true,
    types: ['Land'],
  })
  expect(server.rules(resolved, {
    type: 'castSpell',
    seat: 'p1',
    objectId,
    adventureCast: true,
  }).ok).toBe(false)
  expect(legalActsFor(resolved, 'p1').some(action =>
    action.kind === 'castSpell' && action.objectId === objectId)).toBe(false)
  expect(legalActsFor(resolved, 'p1').some(action =>
    action.kind === 'playLand' && action.objectId === objectId)).toBe(true)

  const restored = restoreJournal(createJournal(resolved), server.rules).current()
  expect(legalActsFor(restored, 'p1').some(action =>
    action.kind === 'playLand' && action.objectId === objectId)).toBe(true)

  const played = ok(server.rules(restored, { type: 'playLand', seat: 'p1', objectId }))
  expect(played.objects[objectId]).toMatchObject({
    zone: 'battlefield',
    tapped: true,
    types: ['Land'],
  })
  expect(played.objects[objectId].adventured).toBeUndefined()
  expect(played.objects[objectId].adventureReady).toBeUndefined()
})

test('an adventured land with no controlled lands still makes a 1/1 Hero', () => {
  const server = createServerGame(commanderRules, { hands: { p1: [landAdventure()] } })
  const objectId = server.state.zoneOrder.p1.hand[0]!
  const resolved = resolveStack(server.rules, ok(server.rules(funded(server.state), {
    type: 'castSpell',
    seat: 'p1',
    objectId,
    adventureCast: true,
  })))
  expect(named(resolved, 'Hero').counters['+1/+1'] ?? 0).toBe(0)
  expect(resolved.objects[objectId]).toMatchObject({ zone: 'exile', adventured: true })
})
