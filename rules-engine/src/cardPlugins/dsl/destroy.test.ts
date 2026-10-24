import { test, expect } from 'bun:test'
import {
  amount,
  keyword,
  createEffect,
  grantKeywordEffect,
  untilCleanup,
  KEYWORDS,
  destroy,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  ref,
  objects,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'

const run=(instructions:any[])=>{
 const snapshot=createDefinitionSnapshot(compileCardRuleDefinition(card([{kind:'spell',costs:[],decisions:{targets:[]},instructions}])))
 const server=createServerGame(commanderRules,{players:2,hands:{p1:[cardTemplate('Test spell',{types:['Sorcery'],manaCost:'{0}',ruleDefinition:snapshot}),cardTemplate('Keep'),cardTemplate('Discard')]},battlefield:{p1:[cardTemplate('Countered creature',{types:['Creature'],power:2,toughness:2,counters:{'+1/+1':1}})]}},{random:()=>0})
 const spell=Object.values(server.state.objects).find(o=>o.name==='Test spell')!
 const cast=server.rules(server.state,{type:'castSpell',seat:'p1',objectId:spell.id});if(!cast.ok)throw Error(cast.error)
 const answer=server.rules(cast.state,{type:'resolveTop'});if(!answer.ok)throw Error(answer.error)
 return {server,state:answer.state}
}
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


test.each([false, true])('canonical native and granted indestructible survive destroy without printed text (granted=%s)', granted => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card(granted ? [] : [keyword.indestructible])))
  const program = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [] }, instructions: [
    ...(granted ? [createEffect({ targets: objects({ zone: 'battlefield', type: 'Creature' }), effect: grantKeywordEffect(KEYWORDS.indestructible), duration: untilCleanup() })] : []),
    destroy({ targets: objects({ zone: 'battlefield', type: 'Creature' }) }),
  ] }])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Resilient fixture', { types: ['Creature'], power: 2, toughness: 2, oracleText: '', ruleDefinition: definition })] },
    hands: { p1: [cardTemplate('Destroy fixture', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: program })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.battlefield[0]
  const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] })
  if (!cast.ok) throw new Error(cast.error)
  const resolved = server.rules(JSON.parse(JSON.stringify(cast.state)), { type: 'resolveTop' })
  if (!resolved.ok) throw new Error(resolved.error)
  expect(resolved.state.objects[id].zone).toBe('battlefield')
})

test("cannotRegenerate marks each destroy event as can't-be-regenerated and still destroys", () => {
  const seen: unknown[] = []
  const watch = { id: 'test.destroyWatch', apply: ({ event }: { event: { type: string } }) => { if (event.type === 'destroy') seen.push(event) } }
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [] }, instructions: [destroy({ targets: objects({ zone: 'battlefield', type: 'Creature' }), cannotRegenerate: true })] }])))
  const server = createServerGame(commanderRules, { players: 2, battlefield: { p2: [cardTemplate('Doomed', { types: ['Creature'], power: 1, toughness: 1 })] }, hands: { p1: [cardTemplate('No regen', { types: ['Instant'], manaCost: '{0}', ruleDefinition: definition })] } }, { random: () => 0, cardPlugins: [watch] })
  const armed = server.rules(server.state, { type: 'addRule', pluginId: watch.id, sourceId: server.state.zoneOrder.p1.hand[0] })
  if (!armed.ok) throw Error(armed.error)
  const cast = server.rules(armed.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] })
  if (!cast.ok) throw Error(cast.error)
  const resolved = server.rules(cast.state, { type: 'resolveTop' })
  if (!resolved.ok) throw Error(resolved.error)
  expect(seen.length).toBeGreaterThan(0)
  expect(seen.every(event => (event as { cannotRegenerate?: true }).cannotRegenerate === true)).toBe(true)
  expect(Object.values(resolved.state.objects).find(object => object.name === 'Doomed')!.zone).toBe('graveyard')
  expect(() => compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [] }, instructions: [{ kind: 'destroy', targets: ref('source'), cannotRegenerate: false } as never] }]))).toThrow()
})
