import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  copySpell,
  select,
  spell,
  stackItems,
} from './v1'
import { copyTargets, openCanonicalCopyRetargeting, resolveCanonicalCopyTargets } from './copies'
import { InteractionStore } from '../../interaction'
import { amount, card, compileCardRuleDefinition, createDefinitionSnapshot } from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'

describe('Rule DSL Part 09 spell copies', () => {
  test('copySpell is a stack action and keeps its explicit retargeting procedure', () => {
    const compiled = compileCardRuleDefinition(card([spell({
      decisions: { targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })] },
      instructions: [copySpell({ targets: { kind: 'targetRef', clauseIndex: 0 }, retarget: { kind: 'keep' } })],
    })]))
    expect(compiled.definition.abilities[0]).toMatchObject({
      instructions: [{ kind: 'copySpell', retarget: { kind: 'keep' } }],
    })
    expect(compiled.capabilities.runtimeExecution.instructionKinds).toContain('copySpell')
  })

  test('keeping targets retains pinned identities without revalidating them', () => {
    const original = {
      id: 'spell', kind: 'spell' as const, objectId: 'card', controller: 'p1',
      name: 'Copied', targets: [{ kind: 'object' as const, objectId: 'old', incarnation: 1, zone: 'battlefield' as const }],
      x: 4,
    }
    expect(copyTargets(original)).toEqual(original.targets)
    expect(resolveCanonicalCopyTargets({} as never, original, {} as never, { kind: 'keep' })).toMatchObject({ ok: true })
  })

  test('retargeting offer survives store snapshot and rejects stale or forged answers', () => {
    const store = new InteractionStore<{ stackId: string; sourceId: string; controller: string; definitionRevision: string; originalTargets: readonly never[] }>()
    openCanonicalCopyRetargeting(store, {
      requestId: 'copy-targets', revision: 3, chooser: 'p1',
      source: { name: 'Copy spell', objectId: 'source' },
    }, {
      stackId: 'spell', sourceId: 'source', controller: 'p1', definitionRevision: 'rev-1', originalTargets: [],
    })
    const restored = new InteractionStore<typeof store extends InteractionStore<infer T> ? T : never>()
    restored.restore(store.snapshot())
    expect(restored.answer({ requestId: 'copy-targets', revision: 2, chooser: 'p1', selection: { kind: 'selectOptions', ids: ['keep'] } })).toMatchObject({ kind: 'invalid' })
    expect(restored.answer({ requestId: 'copy-targets', revision: 3, chooser: 'p2', selection: { kind: 'selectOptions', ids: ['keep'] } })).toMatchObject({ kind: 'invalid' })
    expect(restored.answer({ requestId: 'copy-targets', revision: 3, chooser: 'p1', selection: { kind: 'selectOptions', ids: ['forged'] } })).toMatchObject({ kind: 'invalid' })
    expect(restored.answer({ requestId: 'copy-targets', revision: 3, chooser: 'p1', selection: { kind: 'selectOptions', ids: ['keep'] } })).toMatchObject({ kind: 'accepted' })
  })

  test('runtime retarget answer persists the changed player binding and removes only the copy', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell', costs: [],
      decisions: { targets: [{ filter: { kind: 'players', filter: {} }, min: amount(1), max: amount(1), distinct: true }] },
      instructions: [{ kind: 'gainLife', amount: amount(3), targets: { kind: 'targetRef', clauseIndex: 0 } }],
    }])))
    const server = createServerGame(commanderRules, { players: 2, hands: { p1: [cardTemplate('Copyable', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] } }, { random: () => 0 })
    const original = Object.values(server.state.objects).find((object) => object.name === 'Copyable')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: original.id, targets: [{ kind: 'player', player: 'p1' }] })
    if (!cast.ok) throw new Error(cast.error)
    const copied = server.rules(cast.state, { type: 'copySpell', stackId: cast.state.stack[0].id, controller: 'p1', targets: [{ kind: 'player', player: 'p2' }], retarget: true })
    if (!copied.ok) throw new Error(copied.error)
    expect(copied.state.stack).toHaveLength(2)
    const resolved = server.rules(copied.state, { type: 'resolveTop' })
    if (!resolved.ok) throw new Error(resolved.error)
    expect(resolved.state.players.p2.life).toBe(43)
    expect(resolved.state.stack).toHaveLength(1)
  })
})
