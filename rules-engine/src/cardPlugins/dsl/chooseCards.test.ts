import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame, projectForViewer } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { amount, card, chooseCards, choice, compileCardRuleDefinition, createDefinitionSnapshot, draw, move, objects, ref, sequence } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find((object) => object.name === name)!
const setup = () => createServerGame(commanderRules, {
  players: 2,
  hands: {
    p1: [
      instructionSpell({ instructions: [
        draw({ count: 1, targets: ref('controller') }),
        sequence(
          chooseCards({
            bindChoice: 'picked',
            chooser: ref('controller'),
            filter: objects({ zone: 'hand', owner: 'you', type: 'Land' }),
            min: 0,
            max: 1,
          }),
          move({ targets: choice('picked'), to: 'battlefield' }),
        ),
      ] }),
      cardTemplate('Selected land', { types: ['Land'] }),
      cardTemplate('Nonland card', { types: ['Sorcery'] }),
    ],
    p2: [cardTemplate('Opponent secret', { types: ['Creature'] })],
  },
  libraries: { p1: [cardTemplate('Drawn land', { types: ['Land'] })] },
}, { random: () => 0 })

const begin = (server: ReturnType<typeof setup>) => {
  const cast = ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id,
  }))
  return resolveStack(server.rules, cast)
}

test('chooseCards offers an optional typed selection and moves only the chosen card', () => {
  const server = setup()
  const choosing = begin(server)
  const pending = pendingSelectionFor(choosing, 'p1')!
  const land = named(choosing, 'Selected land')
  expect(pending.candidates).toEqual([named(choosing, 'Drawn land').id, land.id])
  expect(pending.min).toBe(0)
  expect(pending.count).toBe(1)
  expect(pendingSelectionFor(projectForViewer(choosing, 'p2'), 'p1')).toBeUndefined()
  expect(server.rules(choosing, {
    type: 'selectCards', seat: 'p1', selectionId: pending.id, kind: 'choose', count: 1,
    objectIds: [named(choosing, 'Nonland card').id],
  }).ok).toBe(false)

  const declined = ok(server.rules(choosing, {
    type: 'selectCards', seat: 'p1', selectionId: pending.id, kind: 'choose', count: 1, objectIds: [],
  }))
  expect(named(declined, 'Selected land').zone).toBe('hand')
  expect(declined.resolution).toBeUndefined()

  const restored = restoreJournal(createJournal(choosing), server.rules).current()
  const resumed = ok(server.rules(restored, {
    type: 'selectCards', seat: 'p1', selectionId: pending.id, kind: 'choose', count: 1,
    objectIds: [named(restored, 'Drawn land').id],
  }))
  expect(named(resumed, 'Drawn land').zone).toBe('battlefield')
  expect(named(resumed, 'Selected land').zone).toBe('hand')
  expect(resumed.resolution).toBeUndefined()
})

const run=(instructions:any[])=>{
 const snapshot=createDefinitionSnapshot(compileCardRuleDefinition(card([{kind:'spell',costs:[],decisions:{targets:[]},instructions}])))
 const server=createServerGame(commanderRules,{players:2,hands:{p1:[cardTemplate('Test spell',{types:['Sorcery'],manaCost:'{0}',ruleDefinition:snapshot}),cardTemplate('Keep'),cardTemplate('Discard')]},battlefield:{p1:[cardTemplate('Countered creature',{types:['Creature'],power:2,toughness:2,counters:{'+1/+1':1}})]}},{random:()=>0})
 const spell=Object.values(server.state.objects).find(o=>o.name==='Test spell')!
 const cast=server.rules(server.state,{type:'castSpell',seat:'p1',objectId:spell.id});if(!cast.ok)throw Error(cast.error)
 const answer=server.rules(cast.state,{type:'resolveTop'});if(!answer.ok)throw Error(answer.error)
 return {server,state:answer.state}
}
test('chooseAvailable lowers an unavailable mandatory minimum',()=>{
 const {state}=run([{kind:'chooseCards',bindChoice:'picked',chooser:ref('controller'),filter:objects({type:'Creature',zone:'battlefield'}),min:amount(2),max:amount(2),distinct:true,whenInsufficient:'chooseAvailable'}])
 const selection=pendingSelectionFor(state,'p1')!
 expect(selection).toBeDefined()
 expect(selection.min).toBe(1)
 expect(selection.count).toBe(1)
})
