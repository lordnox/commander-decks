import { definitionRevisionFor } from './builders/revision'
import { RULE_DSL_SCHEMA_VERSION, type GeneratedAbility, type Instruction, type TargetClause, type TriggeredAbilityDefinition } from './schema/v1'

/**
 * Generated abilities are stored outside a card definition because their
 * recipient is the source permanent.  The canonical driver still expects a
 * definition snapshot, so give each generated program a small, content pinned
 * wrapper.  A delayed program's event/step condition is already matched by
 * the delayed-trigger registry; its wrapper only needs a valid trigger shape.
 */
export const generatedAbilitySnapshot = (
  ability: GeneratedAbility,
  inheritedDecisions: GeneratedAbility['decisions'] = ability.decisions,
) => {
  let on: TriggeredAbilityDefinition['on']
  switch (ability.on.kind) {
    case 'enters':
    case 'dies':
    case 'draw':
    case 'manaAdded':
    case 'manaAbilityActivated':
    case 'manaAbilityResolved':
      on = ability.on
      break
    default:
      on = { kind: 'draw', filter: {} }
  }
  const generated: TriggeredAbilityDefinition = {
    kind: 'triggered',
    activeIn: ['battlefield'],
    on,
    decisions: {
      targets: inheritedDecisions?.targets ?? [],
      ...(inheritedDecisions?.constraints ? { constraints: inheritedDecisions.constraints } : {}),
      ...(inheritedDecisions?.variables ? { variables: inheritedDecisions.variables } : {}),
      ...(inheritedDecisions?.distributions ? { distributions: inheritedDecisions.distributions } : {}),
    },
    instructions: ability.instructions,
  }
  const definitionRevision = definitionRevisionFor({
    schemaVersion: RULE_DSL_SCHEMA_VERSION,
    abilities: [generated],
  })
  return {
    schemaVersion: RULE_DSL_SCHEMA_VERSION,
    definitionRevision,
    definition: {
      schemaVersion: RULE_DSL_SCHEMA_VERSION,
      definitionRevision,
      abilities: [generated],
    },
  }
}

type CapturedChoice = readonly ({ kind: 'object' } & { objectId: string; incarnation?: number; zone?: import('../../types').ZoneId })[]

/** Lower a parent choice into a durable target slot before compiling the generated wrapper. */
export const lowerCapturedBindings = (
  instructions: readonly Instruction[],
  inheritedTargetCount: number,
  choices: Readonly<Record<string, CapturedChoice>> = {},
  results: Readonly<Record<string, boolean | number>> = {},
) => {
  const choiceEntries = Object.entries(choices)
  const choiceClauseIndex = new Map(choiceEntries.map(([binding], index) => [binding, inheritedTargetCount + index]))
  const clauses: TargetClause[] = choiceEntries.map(([, recipients]) => ({
    filter: { kind: 'objects', filter: {} },
    min: { kind: 'constant', value: 0 },
    max: { kind: 'constant', value: recipients.length },
    distinct: true,
  }))
  const lower = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(lower)
    if (!value || typeof value !== 'object') return value
    const node = value as Record<string, unknown>
    if (node.kind === 'choiceRef' && typeof node.binding === 'string') {
      const clauseIndex = choiceClauseIndex.get(node.binding)
      if (clauseIndex !== undefined) return { kind: 'targetRef', clauseIndex }
    }
    if (node.kind === 'resultIsTrue' && node.value && typeof node.value === 'object') {
      const reference = node.value as Record<string, unknown>
      if (reference.kind === 'resultRef' && typeof reference.binding === 'string') {
        const value = results[reference.binding]
        if (typeof value === 'boolean') return value ? { kind: 'all', conditions: [] } : { kind: 'any', conditions: [] }
      }
    }
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, lower(child)]))
  }
  return {
    instructions: lower(instructions) as Instruction[],
    clauses,
    targetBindings: choiceEntries.map(([, recipients], index) => ({
      scopeId: '',
      clauseIndex: inheritedTargetCount + index,
      recipients: recipients.map((recipient) => ({
        kind: 'object' as const,
        objectId: recipient.objectId,
        ...(recipient.incarnation !== undefined ? { incarnation: recipient.incarnation } : {}),
        ...(recipient.zone !== undefined ? { zone: recipient.zone } : {}),
      })),
    })),
  }
}
