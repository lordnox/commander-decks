import { test, expect } from 'bun:test'
import { amount, card, compileCardRuleDefinition, createDefinitionSnapshot } from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'

test('a conditional nested in a selected mode retains that mode target scope',()=>{
 const snapshot=createDefinitionSnapshot(compileCardRuleDefinition(card([{kind:'triggered',activeIn:['battlefield'],on:{kind:'draw',filter:{}},decisions:{targets:[],modes:{count:amount(1),repeatable:false}},modes:[{decisions:{targets:[{filter:{kind:'players',filter:{}},min:amount(1),max:amount(1),distinct:true}]},instructions:[{kind:'if',condition:{kind:'compareAmount',left:amount(1),operator:'eq',right:amount(1)},then:[{kind:'gainLife',amount:amount(2),targets:{kind:'targetRef',clauseIndex:0}}],otherwise:[]}]}]}])))
 const server=createServerGame(commanderRules,{players:2,battlefield:{p1:[cardTemplate('Modal watcher',{types:['Enchantment'],ruleDefinition:snapshot})]},libraries:{p1:[cardTemplate('Draw me')]}},{random:()=>0})
 const reduce=(state:any,event:any)=>{const r=server.rules(state,event);if(!r.ok)throw Error(r.error);return r.state}
 let state=reduce(server.state,{type:'draw',seat:'p1',count:1})
 const mode=state.players.p1.data['kernel.pendingOptionSelection'] as any
 state=reduce(state,{type:'selectOption',seat:'p1',selectionId:mode.id,optionId:'mode:0'})
 const targets=(state.players.p1.data['kernel.pendingPlayerSelection'] as any[])[0]
 state=reduce(state,{type:'selectPlayers',seat:'p1',selectionId:targets.id,players:['p2']})
 state=reduce(state,{type:'resolveTop'})
 expect(state.players.p2.life).toBe(42)
})
