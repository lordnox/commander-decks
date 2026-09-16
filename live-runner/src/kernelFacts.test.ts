import { expect, test } from 'bun:test'
import { commanderRules, createServerGame } from '../../rules-engine/src/index'
import { cardTemplate, forest } from '../../rules-engine/src/newGame'
import { kernelFacts } from './kernelFacts'

const table = () => {
  const server = createServerGame(
    commanderRules,
    {
      hands: { p1: [forest(), cardTemplate('Blood Celebrant', { manaCost: '{B}' })] },
      battlefield: {
        p1: [
          { ...forest(), name: 'Shadowy Backstreet' },
          { ...forest(), name: 'Swamp', tapped: true },
        ],
      },
    },
    { random: () => 0.5, cardPlugins: [] },
  )
  const state = structuredClone(server.state)
  state.step = 'precombatMain'
  state.active = 'p1'
  state.priority = 'p1'
  state.players.p1.mana = { W: 1, U: 0, B: 1, R: 0, G: 0, C: 0 }
  return state
}

test('the facts name the step, pool, and untapped sources the judge kept guessing', () => {
  const facts = kernelFacts(table(), 'p1')

  expect(facts).toContain('step precombatMain')
  expect(facts).toContain('Priority p1')
  expect(facts).toContain('pool {W}{B}')
  expect(facts).toContain('Untapped mana sources for p1: Shadowy Backstreet.')
  // A tapped source is exactly the kind of thing it invented.
  expect(facts).not.toContain('Swamp.')
})

test('the internal turn counter is translated into the round players see', () => {
  const state = table()
  state.turn = 17

  const facts = kernelFacts(state, 'p1')
  expect(facts).toContain('Internal turn 17 (round 5)')
  expect(facts).toContain('say "turn 5"')
})

test('legal actions are listed so a line built from them cannot be called illegal', () => {
  const facts = kernelFacts(table(), 'p1')

  expect(facts).toContain('play Forest')
  expect(facts).toContain('must not be rejected as illegal')
})

test('a responder the judge would rule tapped out is counted, never named', () => {
  const state = table()
  state.active = 'p2'
  state.priority = 'p2'
  state.players.p2.mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  const veto = Object.values(state.objects).find(
    (object) => object.name === 'Blood Celebrant',
  )!
  veto.name = "Dovin's Veto"
  veto.types = ['Instant']
  veto.manaCost = '{W}{B}'
  veto.oracleText = 'Counter target noncreature spell.'
  state.stack = [{
    id: 'stack-1',
    kind: 'spell',
    objectId: 'other',
    controller: 'p2',
    name: 'Reanimate',
    targets: [],
  }]

  const facts = kernelFacts(state, 'p2', 'p1')

  expect(facts).toContain('p1 (1 action(s), human seat)')
  expect(facts).toContain('Do not pass priority for them')
  // A seat learns that an answer exists, never which card it is.
  expect(facts).not.toContain("Dovin's Veto")
})
