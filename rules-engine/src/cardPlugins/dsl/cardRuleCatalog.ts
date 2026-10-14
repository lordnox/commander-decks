import type { AbilityDefinition, CardRuleDefinitionSnapshotV1 } from './schema/v1'
import {
  adaptLegacyPlayerInstruction,
  adaptLegacyTrigger,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createToken,
  damage,
  draws,
  gainLife,
  keyword,
  players,
  ref,
  self,
  spell,
  whenever,
} from './v1'

const snapshotFor = (abilities: readonly AbilityDefinition[]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

/**
 * Name-keyed canonical snapshots for Part 16 family 1 and family 2. Compiled
 * once at module load. Lookup is exact card name; this is not a kernel dispatcher.
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
  'Flame Rift': snapshotFor([
    spell({
      instructions: [
        damage({ amount: 4, targets: players({ relation: 'any' }), source: ref('source') }),
      ],
    }),
  ]),
  'Thragtusk': snapshotFor([
    whenever(self.enters, {
      instructions: [gainLife({ amount: 5, targets: ref('controller') })],
    }),
    whenever(self.leaves, {
      instructions: [createToken({
        count: 1,
        targets: ref('controller'),
        token: {
          name: 'Beast',
          types: ['Creature'],
          subtypes: ['Beast'],
          colors: ['G'],
          power: 3,
          toughness: 3,
        },
      })],
    }),
  ]),
  'Fate Unraveler': snapshotFor([
    whenever(draws({ player: players({ relation: 'opponent' }) }), {
      instructions: [damage({
        amount: 1,
        targets: ref('triggering.player'),
        source: ref('source'),
      })],
    }),
  ]),
})

export const cardRuleDefinitionSnapshotFor = (name: string) =>
  CARD_RULE_DEFINITION_CATALOG[name]
