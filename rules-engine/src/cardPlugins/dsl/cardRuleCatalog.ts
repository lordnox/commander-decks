import type { AbilityDefinition, CardRuleDefinitionSnapshotV1 } from './schema/v1'
import {
  adaptLegacyPlayerInstruction,
  adaptLegacyTrigger,
  activated,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createEffect,
  createToken,
  damage,
  destroy,
  discardCost,
  draw,
  draws,
  gainLife,
  keyword,
  loseLife,
  objects,
  players,
  pumpEffect,
  ref,
  select,
  self,
  spell,
  target,
  untilCleanup,
  whenever,
} from './v1'

const snapshotFor = (abilities: readonly AbilityDefinition[]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

/**
 * Name-keyed canonical snapshots for Part 16 families 1–3. Compiled once at
 * module load. Lookup is exact card name; this is not a kernel dispatcher.
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
  'Murder': snapshotFor([
    spell({
      decisions: {
        targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })],
      },
      instructions: [destroy({ targets: target(0) })],
    }),
  ]),
  'Sign in Blood': snapshotFor([
    spell({
      decisions: {
        targets: [select({ filter: players({ relation: 'any' }), count: 1 })],
      },
      instructions: [
        draw({ count: 2, targets: target(0) }),
        loseLife({ amount: 2, targets: target(0) }),
      ],
    }),
  ]),
  'Vampire Hounds': snapshotFor([
    activated({
      costs: [discardCost(objects({ zone: 'hand', type: 'Creature' }), 1)],
      instructions: [createEffect({
        targets: ref('source'),
        effect: pumpEffect(2, 2),
        duration: untilCleanup(),
      })],
    }),
  ]),
})

export const cardRuleDefinitionSnapshotFor = (name: string) =>
  CARD_RULE_DEFINITION_CATALOG[name]
