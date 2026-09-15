import { expect, test } from 'bun:test'
import {
  commanderRules,
  createHistory,
  createJournal,
  createServerGame,
  recordAccepted,
} from '../../rules-engine/src/index'
import { bears, forest } from '../../rules-engine/src/newGame'
import type { KernelHandle } from './kernelHost'
import { executeSimpleKernelPlan, simpleKernelPlan } from './simplePlan'

const setup = () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [forest(), bears()] },
    battlefield: {
      p1: [forest(), { ...forest(), name: 'Second Forest' }],
    },
  }, { random: () => 0.5, cardPlugins: [] })
  let journal = createJournal(server.state)
  const history = createHistory(server.state, server.rules)
  const kernel: KernelHandle = {
    get journal() {
      return journal
    },
    history,
    rules: server.rules,
    dispatch: (event) => {
      const result = history.dispatch(event)
      if (result.ok) journal = recordAccepted(journal, event)
      return result
    },
    save: () => {},
  }
  return { kernel, state: server.state }
}

test('an exact simple land plan is recognized and executed locally', () => {
  const { kernel, state } = setup()
  const plan = simpleKernelPlan(state, 'p1', 'play Forest')
  if (!plan) throw new Error('expected a simple plan')

  expect(plan.kind).toBe('playLand')
  executeSimpleKernelPlan(kernel, 'p1', plan)
  expect(kernel.history.current().zoneOrder.p1.battlefield).toContain(plan.objectId)
})

test('a choice-free permanent cast gets a deterministic mana line', () => {
  const { kernel, state } = setup()
  const plan = simpleKernelPlan(state, 'p1', 'Cast Grizzly Bears.')
  if (!plan) throw new Error('expected a simple plan')

  const events = executeSimpleKernelPlan(kernel, 'p1', plan)
  expect(events.filter((event) => event.type === 'tapForMana')).toHaveLength(2)
  expect(kernel.history.current().stack[0]?.name).toBe('Grizzly Bears')
})

test('a line with an optional cost remains a judge decision', () => {
  const { state } = setup()

  expect(simpleKernelPlan(
    state,
    'p1',
    'play Grizzly Bears and collect evidence',
  )).toBeNull()
})
