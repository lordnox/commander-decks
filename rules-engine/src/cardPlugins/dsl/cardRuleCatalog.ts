import type { AbilityDefinition, CardRuleDefinitionSnapshotV1 } from './schema/v1'
import {
  adaptLegacyPlayerInstruction,
  adaptLegacyTrigger,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  keyword,
  spell,
} from './v1'

const snapshotFor = (abilities: readonly AbilityDefinition[]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

/**
 * Name-keyed canonical snapshots for Part 16 family 1. Compiled once at module
 * load. Lookup is exact card name; this is not a kernel dispatcher.
 */
const CARD_RULE_DEFINITION_CATALOG: Readonly<Record<string, CardRuleDefinitionSnapshotV1>> = Object.freeze({
  'Duskdale Wurm': snapshotFor([keyword.trample]),
  'Wall of Omens': snapshotFor([
    keyword.defender,
    adaptLegacyTrigger({
      op: 'trigger',
      on: 'enters',
      do: [{ kind: 'draw', count: 1 }],
    }),
  ]),
  "Night's Whisper": snapshotFor([
    spell({
      instructions: [
        adaptLegacyPlayerInstruction({ kind: 'draw', count: 2 }),
        adaptLegacyPlayerInstruction({ kind: 'loseLife', amount: 2, who: 'controller' }),
      ],
    }),
  ]),
})

export const cardRuleDefinitionSnapshotFor = (name: string) =>
  CARD_RULE_DEFINITION_CATALOG[name]
