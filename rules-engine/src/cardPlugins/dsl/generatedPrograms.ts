import { definitionRevisionFor } from './builders/revision'
import { RULE_DSL_SCHEMA_VERSION, type CardRuleDefinitionSnapshotV1, type GeneratedAbility, type TriggeredAbilityDefinition } from './schema/v1'

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
): CardRuleDefinitionSnapshotV1 => {
  const on: TriggeredAbilityDefinition['on'] = ability.on.kind === 'enters'
    || ability.on.kind === 'dies'
    || ability.on.kind === 'draw'
    || ability.on.kind === 'manaAdded'
    || ability.on.kind === 'manaAbilityActivated'
    || ability.on.kind === 'manaAbilityResolved'
    ? ability.on
    : { kind: 'draw', filter: {} }
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
