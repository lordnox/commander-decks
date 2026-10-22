import { expect, test } from 'bun:test'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, gainLife, ref, spell } from '../cardPlugins/dsl/v1'
import { evaluateObjectReference } from '../cardPlugins/dsl/compiler/runtime'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { Plugin } from '../types'
import { queueSourceLessTrigger } from './sourceLessTriggers'

test('source-less programs wait until the current resolution finishes and expose no source or LKI', () => {
  let pendingDuringResolution = false
  const fixture: Plugin = {
    id: 'fixture.inherentTrigger',
    apply: ({ event, draft }) => {
      if (event.type !== 'gainLife') return
      if (event.amount === 1) queueSourceLessTrigger(draft, {
        controller: 'p1', name: 'Inherent fixture',
        ability: { kind: 'triggered', on: { kind: 'stepBegins', step: 'end' }, instructions: [gainLife({ targets: ref('controller'), amount: 5 })] },
      })
      if (event.amount === 2) pendingDuringResolution = draft.pendingTriggers?.length === 1 && draft.resolution?.kind === 'canonicalSpell'
    },
  }
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    spell({ instructions: [gainLife({ targets: ref('controller'), amount: 1 }), gainLife({ targets: ref('controller'), amount: 2 })] }),
  ])))
  const server = createServerGame(commanderRules, { players: 2, hands: { p1: [cardTemplate('Program fixture', { types: ['Instant'], manaCost: '{0}', ruleDefinition: definition })] } }, { random: () => 0, cardPlugins: [fixture] })
  let state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] }))
  state = ok(server.rules(state, { type: 'resolveTop' }))
  expect(pendingDuringResolution).toBe(true)
  expect(state.players.p1.life).toBe(43)
  expect(state.stack).toHaveLength(1)
  const item = state.stack[0]
  expect(item.sourceLess).toBe(true)
  expect(state.objects[item.objectId]).toBeUndefined()
  const context = { state, controller: item.controller, source: item.execution!.source, sourceLess: true as const }
  expect(evaluateObjectReference(ref('source'), context, 'current')).toEqual([])
  expect(evaluateObjectReference(ref('source'), context, 'currentOrLastKnown')).toEqual([])
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(state.players.p1.life).toBe(48)
})
