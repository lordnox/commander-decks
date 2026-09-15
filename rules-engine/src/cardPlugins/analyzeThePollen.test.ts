import { expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createServerGame } from '../runtime'
import type { CardTemplate } from '../newGame'
import {
  analyzeThePollen,
  ANALYZE_THE_POLLEN_CHOSEN,
  ANALYZE_THE_POLLEN_SEARCH,
} from './analyzeThePollen'

const card = (name: string, types: string[], manaCost = ''): CardTemplate => ({
  name,
  types,
  manaCost,
  subtypes: [],
  supertypes: [],
  oracleText: '',
  power: null,
  toughness: null,
  grantedRules: [],
  tapped: false,
  summoningSickness: false,
  damageMarked: 0,
  counters: {},
  attachedTo: null,
  attacking: null,
  blocking: null,
  token: false,
  tags: [],
})

test('Analyze the Pollen stays on the stack until its library search is chosen', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [{ ...card('Forest', ['Land']), tapProduces: { G: 1 } }] },
    hands: { p1: [card('Analyze the Pollen', ['Sorcery'], '{G}')] },
    libraries: { p1: [card('Oracle of Mul Daya', ['Creature'], '{3}{G}')] },
  }, { random: () => 0.5, cardPlugins: [analyzeThePollen] })
  let state = server.state
  const spell = state.zoneOrder.p1.hand[0]
  const forest = state.zoneOrder.p1.battlefield[0]
  const tapped = server.rules(state, { type: 'tapForMana', seat: 'p1', objectId: forest })
  if (!tapped.ok) throw new Error(tapped.error)
  const cast = server.rules(tapped.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: spell,
    kicked: true,
  })
  if (!cast.ok) throw new Error(cast.error)
  expect(cast.state.stack[0]?.kicked).toBe(true)

  state = cast.state
  for (const seat of ['p1', 'p2', 'p3', 'p4'] as const) {
    const passed = server.rules(state, { type: 'passPriority', seat })
    if (!passed.ok) throw new Error(passed.error)
    state = passed.state
  }

  expect(state.stack[0]?.name).toBe('Analyze the Pollen')
  expect(state.objects[spell].zone).toBe('stack')
  expect(state.players.p1.data[ANALYZE_THE_POLLEN_SEARCH]).toBe(true)
  expect(state.log).toContain('p1 searches for Analyze the Pollen')

  const blocked = server.rules(state, { type: 'passPriority', seat: 'p1' })
  expect(blocked.ok).toBe(false)

  const choice = state.zoneOrder.p1.library[0]
  for (const event of [
    {
      type: 'reveal',
      seat: 'p1',
      objectIds: [choice],
      source: 'Analyze the Pollen',
    } as const,
    { type: 'move', objectId: choice, to: 'hand' } as const,
    { type: 'shuffleLibrary', seat: 'p1' } as const,
    { type: 'custom', name: ANALYZE_THE_POLLEN_CHOSEN, seat: 'p1' } as const,
    { type: 'resolveTop' } as const,
  ]) {
    const result = server.rules(state, event)
    if (!result.ok) throw new Error(result.error)
    state = result.state
  }

  expect(state.objects[choice].zone).toBe('hand')
  expect(state.objects[spell].zone).toBe('graveyard')
  expect(state.players.p1.data[ANALYZE_THE_POLLEN_SEARCH]).toBeUndefined()
  // The card is mandatorily revealed, so the table log must name it.
  expect(state.log).toContain('p1 reveals Oracle of Mul Daya for Analyze the Pollen')
})
