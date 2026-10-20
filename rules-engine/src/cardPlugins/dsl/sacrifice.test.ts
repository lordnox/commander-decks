import { test, expect } from 'bun:test'
import {
  amount,
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
