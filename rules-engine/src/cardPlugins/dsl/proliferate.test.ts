import { test, expect } from 'bun:test'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, ref } from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'

const run=(instructions:any[])=>{
 const snapshot=createDefinitionSnapshot(compileCardRuleDefinition(card([{kind:'spell',costs:[],decisions:{targets:[]},instructions}])))
 const server=createServerGame(commanderRules,{players:2,hands:{p1:[cardTemplate('Test spell',{types:['Sorcery'],manaCost:'{0}',ruleDefinition:snapshot}),cardTemplate('Keep'),cardTemplate('Discard')]},battlefield:{p1:[cardTemplate('Countered creature',{types:['Creature'],power:2,toughness:2,counters:{'+1/+1':1}})]}},{random:()=>0})
 const spell=Object.values(server.state.objects).find(o=>o.name==='Test spell')!
 const cast=server.rules(server.state,{type:'castSpell',seat:'p1',objectId:spell.id});if(!cast.ok)throw Error(cast.error)
 const answer=server.rules(cast.state,{type:'resolveTop'});if(!answer.ok)throw Error(answer.error)
 return {server,state:answer.state}
}
test('proliferation offers counters and adds one to selected kind',()=>{
 const {state}=run([{kind:'proliferate',targets:ref('controller')}])
 const creature=Object.values(state.objects).find(o=>o.name==='Countered creature')!
 expect(Boolean(pendingSelectionFor(state,'p1'))||creature.counters['+1/+1']===2).toBe(true)
})
test('proliferation waits for an optional choice before changing counters',()=>{
 const {state}=run([{kind:'proliferate',targets:ref('controller')}])
 expect(pendingSelectionFor(state,'p1')).toBeDefined()
 expect(Object.values(state.objects).find(o=>o.name==='Countered creature')!.counters['+1/+1']).toBe(1)
})

test('permanent-only proliferate commits one counter action group',()=>{
 const {server,state}=run([{kind:'proliferate',targets:ref('controller')}])
 const selection=pendingSelectionFor(state,'p1')!
 const ids=selection.candidates.slice(0,2)
 const answered=server.rules(state,{type:'selectCards',seat:'p1',selectionId:selection.id,kind:'choose',count:selection.count,objectIds:ids})
 if(!answered.ok) throw Error(answered.error)
 expect(answered.state.resolution?.pendingEvents ?? []).toHaveLength(0)
 for (const id of ids) expect(answered.state.objects[id]?.counters['+1/+1']).toBe(2)
})
