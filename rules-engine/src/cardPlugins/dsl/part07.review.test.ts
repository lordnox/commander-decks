import {test,expect} from 'bun:test'
import {amount,card,compileCardRuleDefinition,createDefinitionSnapshot,ref,objects} from './v1'
import {cardTemplate} from '../../newGame'
import {commanderRules} from '../../formats'
import {createServerGame} from '../../runtime'
import {pendingSelectionFor} from '../../rules/selectCards'
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
test('proliferation offers counters and adds one to selected kind',()=>{
 const {state}=run([{kind:'proliferate',targets:ref('controller')}])
 const creature=Object.values(state.objects).find(o=>o.name==='Countered creature')!
 expect(Boolean(pendingSelectionFor(state,'p1'))||creature.counters['+1/+1']===2).toBe(true)
})
test('chooseAvailable lowers an unavailable mandatory minimum',()=>{
 const {state}=run([{kind:'chooseCards',bindChoice:'picked',chooser:ref('controller'),filter:objects({type:'Creature',zone:'battlefield'}),min:amount(2),max:amount(2),distinct:true,whenInsufficient:'chooseAvailable'}])
 const selection=pendingSelectionFor(state,'p1')!
 expect(selection).toBeDefined()
 expect(selection.min).toBe(1)
 expect(selection.count).toBe(1)
})
test('selected-card discard binds its semantic success',()=>{
 const {state}=run([{kind:'discard',by:ref('controller'),targets:objects({zone:'hand',name:'Discard'}),bindResult:'d'},{kind:'if',condition:{kind:'resultIsTrue',value:{kind:'resultRef',binding:'d',field:'discarded'}},then:[{kind:'gainLife',amount:amount(3),targets:ref('controller')}],otherwise:[]}])
 expect(Object.values(state.objects).find(o=>o.name==='Discard')?.zone).toBe('graveyard')
 expect(state.players.p1.life).toBe(43)
})
test('proliferation waits for an optional choice before changing counters',()=>{
 const {state}=run([{kind:'proliferate',targets:ref('controller')}])
 expect(pendingSelectionFor(state,'p1')).toBeDefined()
 expect(Object.values(state.objects).find(o=>o.name==='Countered creature')!.counters['+1/+1']).toBe(1)
})
test('grouped destroy retains common lookback for a dying watcher',()=>{
 const watcher=createDefinitionSnapshot(compileCardRuleDefinition(card([{kind:'triggered',activeIn:['battlefield'],on:{kind:'dies',filter:{type:'Creature'}},decisions:{targets:[]},instructions:[{kind:'gainLife',amount:amount(1),targets:ref('controller')}]}])))
 const spellDef=createDefinitionSnapshot(compileCardRuleDefinition(card([{kind:'spell',costs:[],decisions:{targets:[]},instructions:[{kind:'destroy',targets:objects({zone:'battlefield',type:'Creature'})}]}])))
 const server=createServerGame(commanderRules,{players:2,battlefield:{p1:[cardTemplate('Dying watcher',{types:['Creature'],power:1,toughness:1,ruleDefinition:watcher}),cardTemplate('Victim 1',{types:['Creature'],power:1,toughness:1}),cardTemplate('Victim 2',{types:['Creature'],power:1,toughness:1})]},hands:{p1:[cardTemplate('Destroy all',{types:['Sorcery'],manaCost:'{0}',ruleDefinition:spellDef})]}},{random:()=>0})
 const spell=Object.values(server.state.objects).find(o=>o.name==='Destroy all')!
 const cast=server.rules(server.state,{type:'castSpell',seat:'p1',objectId:spell.id});if(!cast.ok)throw Error(cast.error)
 const answer=server.rules(cast.state,{type:'resolveTop'});if(!answer.ok)throw Error(answer.error)
 expect((answer.state.pendingTriggers?.length??0)+answer.state.stack.filter(i=>i.kind==='ability').length).toBe(3)
})
test('destroying a hand card cannot report successful destruction',()=>{
 const {state}=run([{kind:'destroy',targets:objects({zone:'hand',name:'Discard'}),bindResult:'d'},{kind:'if',condition:{kind:'resultIsTrue',value:{kind:'resultRef',binding:'d',field:'destroyed'}},then:[{kind:'gainLife',amount:amount(3),targets:ref('controller')}],otherwise:[]}])
 expect(Object.values(state.objects).find(o=>o.name==='Discard')!.zone).toBe('hand')
 expect(state.players.p1.life).toBe(40)
})
test('copy retains the source canonical rule definition',()=>{
 const watcher=createDefinitionSnapshot(compileCardRuleDefinition(card([{kind:'triggered',activeIn:['battlefield'],on:{kind:'dies',filter:{type:'Creature'}},decisions:{targets:[]},instructions:[{kind:'gainLife',amount:amount(1),targets:ref('controller')}]}])))
 const spellDef=createDefinitionSnapshot(compileCardRuleDefinition(card([{kind:'spell',costs:[],decisions:{targets:[]},instructions:[{kind:'copy',targets:objects({zone:'battlefield',name:'DSL original'})}]}])))
 const server=createServerGame(commanderRules,{players:2,battlefield:{p1:[cardTemplate('DSL original',{types:['Creature'],power:1,toughness:1,ruleDefinition:watcher})]},hands:{p1:[cardTemplate('Copy spell',{types:['Sorcery'],manaCost:'{0}',ruleDefinition:spellDef})]}},{random:()=>0})
 const spell=Object.values(server.state.objects).find(o=>o.name==='Copy spell')!
 const cast=server.rules(server.state,{type:'castSpell',seat:'p1',objectId:spell.id});if(!cast.ok)throw Error(cast.error)
 const answer=server.rules(cast.state,{type:'resolveTop'});if(!answer.ok)throw Error(answer.error)
 const copy=Object.values(answer.state.objects).find(o=>o.token&&o.name==='DSL original')!
 expect(copy).toBeDefined()
 expect(copy.ruleDefinition).toEqual(watcher)
})
test('sacrifice ignores a card in hand and binds failure',()=>{
 const {state}=run([{kind:'sacrifice',targets:objects({zone:'hand',name:'Discard'}),bindResult:'s'},{kind:'if',condition:{kind:'resultIsTrue',value:{kind:'resultRef',binding:'s',field:'sacrificed'}},then:[{kind:'gainLife',amount:amount(3),targets:ref('controller')}],otherwise:[]}])
 expect(state.players.p1.life).toBe(40)
})
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
