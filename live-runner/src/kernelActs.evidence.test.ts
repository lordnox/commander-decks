import { expect, test } from 'bun:test'
import { commanderRules, createJournal, createServerGame, recordAccepted, restoreJournal } from '../../rules-engine/src/index'
import { cardTemplate } from '../../rules-engine/src/newGame'
import { card, collectEvidence, compileCardRuleDefinition, createDefinitionSnapshot, spell } from '../../rules-engine/src/cardPlugins/dsl/v1'
import { applyKernelAct } from './kernelActs'
import type { KernelHandle } from './kernelHandle'
import { createLobby } from './lobby'
import { parseInbox } from './protocol'

test('a structured live act keeps optional evidence selections distinct from spell targets', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({ optionalCosts: [collectEvidence(8)], instructions: [] })])))
  const server = createServerGame(commanderRules, { hands: { p1: [
    cardTemplate('Evidence spell', { types: ['Sorcery'], manaCost: '{G}', ruleDefinition: definition }),
    cardTemplate('Payment one', { zone: 'graveyard', manaValue: 5 }),
    cardTemplate('Payment two', { zone: 'graveyard', manaValue: 3 }),
  ] } }, { random: () => 0 })
  const state = structuredClone(server.state)
  state.players.p1.mana.G = 1
  let journal = createJournal(state)
  const history = restoreJournal(journal, server.rules)
  const kernel: KernelHandle = { get journal() { return journal }, history, rules: server.rules,
    dispatch: event => {
      const result = history.dispatch(event)
      if (result.ok) journal = recordAccepted(journal, event)
      return result
    }, save: () => {},
  }
  const lobby = createLobby()
  lobby.phase = 'play'
  const evidence = [...state.zoneOrder.p1.graveyard]
  const message = parseInbox(JSON.stringify({ type: 'act', kind: 'castSpell', objectId: state.zoneOrder.p1.hand[0], selectedOptionalCosts: [0], evidence: [evidence] }))
  if (!message || message.type !== 'act') throw new Error('invalid evidence action')
  applyKernelAct(kernel, lobby, 'p1', message)
  const current = history.current()
  expect(evidence.every(id => current.objects[id]!.zone === 'exile')).toBe(true)
  expect(current.stack[0]!.targets).toEqual([])
  expect(current.stack[0]!.execution?.announcement?.costChoices?.optional).toEqual([0])
})
