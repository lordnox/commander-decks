import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  copySpell,
  select,
  spell,
  stackItems,
} from './v1'
import { copyTargets, resolveCanonicalCopyTargets } from './copies'

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
})
