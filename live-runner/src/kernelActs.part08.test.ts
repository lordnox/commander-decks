import { expect, test } from 'bun:test'
import { applyKernelAct } from './kernelActs'
import { parseInbox, type InboxMessage } from './protocol'
import { commanderRules } from '../../rules-engine/src/formats'
import { createServerGame } from '../../rules-engine/src/runtime'
import { amount, card, compileCardRuleDefinition, createDefinitionSnapshot, manaCost, ref } from '../../rules-engine/src/cardPlugins/dsl/v1'
import { cardTemplate } from '../../rules-engine/src/newGame'
import type { GameState } from '../../rules-engine/src/types'

test('live host routes planned payment and cancellation through the kernel act protocol', () => {
  const sourceDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
    kind: 'activated', availableFrom: ['battlefield'], timing: 'anyTime', costs: [], decisions: { targets: [] },
    instructions: [{ kind: 'chooseInstructions', chooser: ref('controller'), count: amount(1), whenInsufficient: 'chooseAvailable', options: [{ instructions: [{ kind: 'addMana', amount: { G: amount(2) }, targets: ref('controller') }] }] }],
  }])))
  const spellDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [manaCost('{G}')], decisions: { targets: [] }, instructions: [] }])))
  const server = createServerGame(commanderRules, { players: 2, battlefield: { p1: [cardTemplate('Host planned source', { types: ['Artifact'], ruleDefinition: sourceDefinition })] }, hands: { p1: [cardTemplate('Host planned spell', { types: ['Sorcery'], manaCost: '{G}', ruleDefinition: spellDefinition })] } }, { random: () => 0 })
  const source = Object.values(server.state.objects).find((object) => object.name === 'Host planned source')!
  const spell = Object.values(server.state.objects).find((object) => object.name === 'Host planned spell')!
  let current: GameState = server.state
  const kernel = {
    history: { current: () => current },
    rules: server.rules,
    dispatch: (event: Parameters<typeof server.rules>[1]) => {
      const result = server.rules(current, event)
      if (result.ok) current = result.state
      return result
    },
  } as never
  const lobby = { phase: 'play', occupants: { p1: { name: 'Host', deck: 'test' } } } as never
  const cast = parseInbox(JSON.stringify({ type: 'act', kind: 'castSpell', objectId: spell.id, manaActivations: [{ objectId: source.id, abilityId: '$.abilities[0]' }] }))
  expect(cast?.type).toBe('act')
  if (!cast || cast.type !== 'act') return
  applyKernelAct(kernel, lobby, 'p1', cast)
  expect(current.provisionalAnnouncement).toBeDefined()
  const baseline = server.state
  const restarted = JSON.parse(JSON.stringify(current)) as GameState
  current = restarted
  const transactionId = restarted.provisionalAnnouncement!.id
  const cancel = parseInbox(JSON.stringify({ type: 'act', kind: 'cancelAnnouncement', transactionId })) as InboxMessage
  expect(cancel.type).toBe('act')
  if (cancel.type !== 'act') return
  applyKernelAct(kernel, lobby, 'p1', cancel)
  expect(current).toEqual(baseline)
})
