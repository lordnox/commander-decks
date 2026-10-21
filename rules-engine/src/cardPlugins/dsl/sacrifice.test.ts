import { test, expect } from 'bun:test'
import type { GameEvent, GameState, Plugin } from '../../types'
import { pendingOptionSelection } from '../../rules/selectOptions'
import {
  amount,
  count,
  createDelayed,
  ifThen,
  result,
  resultAmount,
  staticAbility,
  replacement,
  redirectEvent,
  wouldMove,
  chooseCards,
  choice,
  sacrifice,
  gainLife,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  ref,
  objects,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'

const run=(instructions:any[])=>{
 const snapshot=createDefinitionSnapshot(compileCardRuleDefinition(card([{kind:'spell',costs:[],decisions:{targets:[]},instructions}])))
 const server=createServerGame(commanderRules,{players:2,hands:{p1:[cardTemplate('Test spell',{types:['Sorcery'],manaCost:'{0}',ruleDefinition:snapshot}),cardTemplate('Keep'),cardTemplate('Discard')]},battlefield:{p1:[cardTemplate('Countered creature',{types:['Creature'],power:2,toughness:2,counters:{'+1/+1':1}})]}},{random:()=>0})
 const spell=Object.values(server.state.objects).find(o=>o.name==='Test spell')!
 const cast=server.rules(server.state,{type:'castSpell',seat:'p1',objectId:spell.id});if(!cast.ok)throw Error(cast.error)
 const answer=server.rules(cast.state,{type:'resolveTop'});if(!answer.ok)throw Error(answer.error)
 return {server,state:answer.state}
}
test('sacrifice ignores a card in hand and binds failure',()=>{
 const {state}=run([{kind:'sacrifice',targets:objects({zone:'hand',name:'Discard'}),bindResult:'s'},{kind:'if',condition:{kind:'resultIsTrue',value:{kind:'resultRef',binding:'s',field:'sacrificed'}},then:[{kind:'gainLife',amount:amount(3),targets:ref('controller')}],otherwise:[]}])
 expect(state.players.p1.life).toBe(40)
})


test.each([0, 1, 3].flatMap(lands => [false, true].map(countered => ({ lands, countered }))))('resolution sacrifices wait for resolution, do as much as possible, and resume after restore (%j)', ({ lands, countered }) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: Array.from({ length: lands }, (_, index) => cardTemplate(`Land fixture ${index}`, { types: ['Land'] })) },
    hands: { p1: [instructionSpell({ instructions: [
      chooseCards({ bindChoice: 'lands', chooser: ref('controller'), filter: objects({ zone: 'battlefield', controller: 'you', type: 'Land' }), min: 2, max: 2 }),
      sacrifice({ targets: choice('lands') }),
      gainLife({ targets: ref('controller'), amount: 1 }),
    ] })] },
  }, { random: () => 0 })
  let state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] }))
  expect(state.zoneOrder.p1.battlefield).toHaveLength(lands)
  expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
  if (countered) state = ok(server.rules(state, { type: 'counterStackItem', stackId: state.stack[0].id }))
  state = resolveStack(server.rules, state)
  const selection = pendingSelectionFor(state, 'p1')
  if (selection) state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: selection.count, objectIds: selection.candidates.slice(0, Math.min(2, lands)) }))
  expect(state.zoneOrder.p1.battlefield).toHaveLength(countered ? lands : Math.max(0, lands - 2))
  expect(state.players.p1.life).toBe(countered ? 40 : 41)
})

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!
const begin = (server: ReturnType<typeof createServerGame>) => resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] })))
const choose = (server: ReturnType<typeof createServerGame>, state: GameState, ids: string[]) => {
  const selection = pendingSelectionFor(state, 'p1')!
  return ok(server.rules(state, { type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: selection.count, objectIds: ids }))
}

const eligible = objects({ zone: 'battlefield', controller: 'you', type: 'Creature' })
const countProgram = [
  chooseCards({ chooser: ref('controller'), filter: eligible, bindChoice: 'offering', min: 0, max: count(eligible) }),
  sacrifice({ targets: choice('offering'), bindCount: 'total', bindResult: 'success' }),
  gainLife({ targets: ref('controller'), amount: resultAmount('total') }),
  ifThen(result('success', 'sacrificed'), { then: [gainLife({ targets: ref('controller'), amount: 10 })] }),
]

test.each([0, 1, 3])('optional sacrifice selection binds a numeric total and independent success flag (%s selected)', number => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: countProgram })] },
    battlefield: { p1: Array.from({ length: 3 }, (_, i) => cardTemplate(`Offering ${i}`, { types: ['Creature'], power: 1, toughness: 1 })) },
  }, { random: () => 0 })
  const pending = begin(server)
  const ids = pendingSelectionFor(pending, 'p1')!.candidates.slice(0, number)
  const direct = choose(server, pending, ids)
  expect(choose(server, JSON.parse(JSON.stringify(pending)), ids)).toEqual(direct)
  expect(direct.players.p1.life).toBe(40 + number + (number > 0 ? 10 : 0))
  expect(direct.zoneOrder.p1.battlefield).toHaveLength(3 - number)
})

test.each([false, true])('tokens and indestructible permanents count even when graveyard moves are replaced (%s)', redirected => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: countProgram })] },
    battlefield: { p1: [
      cardTemplate('Token offering', { types: ['Creature'], token: true, power: 1, toughness: 1 }),
      cardTemplate('Indestructible offering', { types: ['Creature'], power: 1, toughness: 1, oracleText: 'Indestructible' }),
    ] },
  }, { random: () => 0, ...(redirected ? { cardPlugins: [{ id: 'fixture.sacrificeExile', replace: ({ event }: { event: GameEvent }) => event.type === 'move' && event.to === 'graveyard' ? { ...event, to: 'exile' as const } : undefined }] } : {}) })
  const state = begin(server)
  const done = choose(server, state, pendingSelectionFor(state, 'p1')!.candidates)
  expect(done.players.p1.life).toBe(52)
  expect(done.zoneOrder.p1.battlefield).toHaveLength(0)
  expect(named(done, 'Indestructible offering').zone).toBe(redirected ? 'exile' : 'graveyard')
})

test('a suppressed selected sacrifice and an unrelated nested sacrifice do not inflate the count', () => {
  const nested: Plugin = {
    id: 'fixture.nestedSacrifice',
    replace: ({ event, state }) => event.type === 'sacrifice' && state.objects[event.objectId]?.name === 'Prevented' ? null : undefined,
    apply: ({ event, draft }) => {
      if (event.type === 'sacrifice' && draft.objects[event.objectId]?.name === 'Performed') {
        const extra = Object.values(draft.objects).find(object => object.name === 'Unrelated')!
        draft.enqueue({ type: 'sacrifice', objectId: extra.id })
      }
    },
  }
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: [sacrifice({ targets: objects({ zone: 'battlefield', type: 'Creature' }), bindCount: 'total' }), gainLife({ targets: ref('controller'), amount: resultAmount('total') })] })] },
    battlefield: { p1: [cardTemplate('Performed', { types: ['Creature'] }), cardTemplate('Prevented', { types: ['Creature'] }), cardTemplate('Unrelated', { types: ['Artifact'] })] },
  }, { random: () => 0, cardPlugins: [nested] })
  const done = begin(server)
  expect(done.players.p1.life).toBe(41)
  expect(named(done, 'Prevented').zone).toBe('battlefield')
  expect(named(done, 'Unrelated').zone).toBe('graveyard')
})

test('sacrifice counts persist through competing zone replacements without replaying or counting twice', () => {
  const replacementFor = (name: string, to: 'exile' | 'hand') => cardTemplate(name, {
    types: ['Enchantment'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(replacement(wouldMove({ object: { zone: 'battlefield' }, to: 'graveyard' }), redirectEvent(to))),
    ]))),
  })
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: [sacrifice({ targets: eligible, bindCount: 'total' }), gainLife({ targets: ref('controller'), amount: resultAmount('total') })] })] },
    battlefield: { p1: [cardTemplate('Offering 0', { types: ['Creature'] }), cardTemplate('Offering 1', { types: ['Creature'] }), replacementFor('Exile replacement', 'exile'), replacementFor('Hand replacement', 'hand')] },
  }, { random: () => 0 })
  let state = begin(server)
  expect(pendingOptionSelection(state, 'p1')).toBeDefined()
  for (let i = 0; i < 4; i++) {
    const selection = pendingOptionSelection(state, 'p1')
    if (!selection) break
    const answer = { type: 'selectOption' as const, seat: 'p1', selectionId: selection.id, optionId: selection.options[0]!.id }
    const response = server.rules(state, answer)
    const direct = ok(response)
    expect(ok(server.rules(JSON.parse(JSON.stringify(state)), answer))).toEqual(direct)
    state = direct
  }
  expect(state.resolution).toBeUndefined()
  expect(state.players.p1.life).toBe(42)
})

test.each([false, true])('generated programs preserve captured counts alongside local bindCount declarations (local=%s)', shadow => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: [
      sacrifice({ targets: objects({ name: 'Outer offering' }), bindCount: 'total' }),
      createDelayed({ condition: { kind: 'event', type: 'draw' }, instructions: [
        ...(shadow ? [sacrifice({ targets: objects({ zone: 'battlefield', type: 'Creature' }), bindCount: 'local' })] : []),
        gainLife({ targets: ref('controller'), amount: resultAmount(shadow ? 'local' : 'total') }),
      ] }),
    ] })] },
    battlefield: { p1: ['Outer offering', 'Inner 0', 'Inner 1'].map(name => cardTemplate(name, { types: ['Creature'] })) },
    libraries: { p1: [cardTemplate('Draw fixture')] },
  }, { random: () => 0 })
  const state = begin(server)
  const done = resolveStack(server.rules, ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'draw', seat: 'p1', count: 1 })))
  expect(done.players.p1.life).toBe(shadow ? 42 : 41)
})

test.each([0, 2])('catalog sacrifice-to-draw composition counts only the chosen eligible permanents (%s)', number => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Reprocess', { manaCost: '{0}' })] },
    battlefield: { p1: [cardTemplate('Eligible artifact', { types: ['Artifact'] }), cardTemplate('Eligible land', { types: ['Land'] }), cardTemplate('Ineligible enchantment', { types: ['Enchantment'] })], p2: [cardTemplate('Enemy artifact', { types: ['Artifact'] })] },
    libraries: { p1: Array.from({ length: 3 }, (_, i) => cardTemplate(`Draw ${i}`)) },
  }, { random: () => 0 })
  const state = begin(server)
  const selection = pendingSelectionFor(state, 'p1')!
  expect(selection.candidates.map(id => state.objects[id].name)).toEqual(['Eligible artifact', 'Eligible land'])
  const done = choose(server, state, selection.candidates.slice(0, number))
  expect(done.zoneOrder.p1.hand).toHaveLength(number)
})

test.each(['none', 'suppressed', 'performed'])('catalog sacrifice-then-return composition requires actual sacrifice success (%s)', outcome => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Victimize', { manaCost: '{0}' }), cardTemplate('Return 0', { types: ['Creature'], zone: 'graveyard' }), cardTemplate('Return 1', { types: ['Creature'], zone: 'graveyard' })] },
    battlefield: { p1: outcome === 'none' ? [] : [cardTemplate('Offering', { types: ['Creature'] })] },
  }, { random: () => 0, ...(outcome === 'suppressed' ? { cardPlugins: [{ id: 'fixture.suppressSacrifice', replace: ({ event }: { event: GameEvent }) => event.type === 'sacrifice' ? null : undefined }] } : {}) })
  const targets = server.state.zoneOrder.p1.graveyard.map(objectId => ({ kind: 'object' as const, objectId }))
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0], targets })))
  const selection = pendingSelectionFor(state, 'p1')
  if (selection) state = choose(server, JSON.parse(JSON.stringify(state)), selection.candidates)
  for (const name of ['Return 0', 'Return 1']) {
    expect(named(state, name).zone).toBe(outcome === 'performed' ? 'battlefield' : 'graveyard')
    if (outcome === 'performed') expect(named(state, name).tapped).toBe(true)
  }
})

test('sacrifice count bindings reject invalid names, collisions, and boolean use', () => {
  for (const instructions of [
    [sacrifice({ targets: eligible, bindCount: '' })],
    [sacrifice({ targets: eligible, bindCount: 'same', bindResult: 'same' })],
    [sacrifice({ targets: eligible, bindCount: 'total' }), ifThen(result('total', 'sacrificed'), { then: [] })],
  ]) expect(() => compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [] }, instructions }]))).toThrow()
})
