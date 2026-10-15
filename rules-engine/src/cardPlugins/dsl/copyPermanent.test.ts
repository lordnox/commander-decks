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
