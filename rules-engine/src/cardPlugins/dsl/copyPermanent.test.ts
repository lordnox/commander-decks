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
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'

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

test('catalog Wedding Ring copies for the targeted opponent and mirrors their draws', () => {
  const named = (state: GameState, name: string) => Object.values(state.objects).find((object) => object.name === name)!
  const server = createServerGame(commanderRules, {
    players: 3,
    hands: { p1: [cardTemplate('Wedding Ring')] },
    libraries: { p1: [cardTemplate('Our Draw')], p2: [cardTemplate('Their Draw')] },
  }, { random: () => 0.5 })
  let state = structuredClone(server.state)
  state.step = 'precombatMain'
  state.players.p1.mana = { W: 2, U: 0, B: 0, R: 0, G: 0, C: 2 }
  const ring = named(state, 'Wedding Ring').id
  state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: ring }))
  state = ok(server.rules(state, { type: 'resolveTop' }))
  const pick = pendingPlayerSelectionFor(state, 'p1')
  expect(pick).toBeDefined()
  expect(pick!.candidates).toEqual(['p2', 'p3'])
  state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: pick!.id, players: ['p2'] }))
  state = resolveStack(server.rules, state)
  const token = Object.values(state.objects).find((object) => object.name === 'Wedding Ring' && object.id !== ring)!
  expect(token.controller).toBe('p2')
  expect(token.token).toBe(true)

  state.active = 'p2'
  state.priority = 'p2'
  state = ok(server.rules(state, { type: 'draw', seat: 'p2', count: 1 }))
  state = resolveStack(server.rules, state)
  expect(named(state, 'Their Draw').zone).toBe('hand')
  expect(named(state, 'Our Draw').zone).toBe('hand')
})
