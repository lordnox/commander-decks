import { test, expect } from 'bun:test'
import {
  amount,
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

const run=(instructions:any[])=>{
 const snapshot=createDefinitionSnapshot(compileCardRuleDefinition(card([{kind:'spell',costs:[],decisions:{targets:[]},instructions}])))
 const server=createServerGame(commanderRules,{players:2,hands:{p1:[cardTemplate('Test spell',{types:['Sorcery'],manaCost:'{0}',ruleDefinition:snapshot}),cardTemplate('Keep'),cardTemplate('Discard')]},battlefield:{p1:[cardTemplate('Countered creature',{types:['Creature'],power:2,toughness:2,counters:{'+1/+1':1}})]}},{random:()=>0})
 const spell=Object.values(server.state.objects).find(o=>o.name==='Test spell')!
 const cast=server.rules(server.state,{type:'castSpell',seat:'p1',objectId:spell.id});if(!cast.ok)throw Error(cast.error)
 const answer=server.rules(cast.state,{type:'resolveTop'});if(!answer.ok)throw Error(answer.error)
 return {server,state:answer.state}
}
test('player count discard asks the player which card to discard',()=>{
 const {state}=run([{kind:'discard',targets:ref('controller'),count:amount(1)}])
 expect(pendingSelectionFor(state,'p1')).toBeDefined()
 expect(Object.values(state.objects).filter(o=>['Keep','Discard'].includes(o.name)).every(o=>o.zone==='hand')).toBe(true)
})
test('selected-card discard binds its semantic success',()=>{
 const {state}=run([{kind:'discard',by:ref('controller'),targets:objects({zone:'hand',name:'Discard'}),bindResult:'d'},{kind:'if',condition:{kind:'resultIsTrue',value:{kind:'resultRef',binding:'d',field:'discarded'}},then:[{kind:'gainLife',amount:amount(3),targets:ref('controller')}],otherwise:[]}])
 expect(Object.values(state.objects).find(o=>o.name==='Discard')?.zone).toBe('graveyard')
 expect(state.players.p1.life).toBe(43)
})
