import type { AbilityDefinition, CardRuleDefinitionSnapshotV1 } from './schema/v1'
import {
  activated,
  amount,
  card,
  chooseModes,
  compileCardRuleDefinition,
  copySpell,
  counter,
  createDefinitionSnapshot,
  createEffect,
  createToken,
  damage,
  destroy,
  discard,
  discardCost,
  draw,
  draws,
  gainLife,
  keyword,
  loseLife,
  manaCost,
  modifyStats,
  move,
  objects,
  players,
  pumpEffect,
  redirectEvent,
  ref,
  replacement,
  searchLibrary,
  select,
  self,
  spell,
  stackItems,
  staticAbility,
  target,
  untilCleanup,
  whenever,
  wouldMove,
} from './v1'

const snapshotFor = (abilities: readonly AbilityDefinition[]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

/**
 * Name-keyed canonical snapshots for Part 16 families 1–7. Compiled once at
 * module load. Lookup is exact card name; this is not a kernel dispatcher.
 */
const CARD_RULE_DEFINITION_CATALOG: Readonly<Record<string, CardRuleDefinitionSnapshotV1>> = Object.freeze({
  'Duskdale Wurm': snapshotFor([keyword.trample]),
  'Wall of Omens': snapshotFor([
    keyword.defender,
    whenever(self.enters, {
      instructions: [draw({ count: 1, targets: ref('controller') })],
    }),
  ]),
  "Night's Whisper": snapshotFor([
    spell({
      instructions: [
        draw({ count: 2, targets: ref('controller') }),
        loseLife({ amount: 2, targets: ref('controller') }),
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
  'Esper Charm': snapshotFor([
    spell({
      decisions: { modes: chooseModes({ count: 1 }) },
      modes: [
        {
          decisions: {
            targets: [select({
              filter: objects({ zone: 'battlefield', type: 'Enchantment' }),
              count: 1,
            })],
          },
          instructions: [destroy({ targets: target(0) })],
        },
        {
          instructions: [draw({ count: 2, targets: ref('controller') })],
        },
        {
          decisions: {
            targets: [select({ filter: players({ relation: 'any' }), count: 1 })],
          },
          instructions: [discard({ count: 2, targets: target(0) })],
        },
      ],
    }),
  ]),
  'Reverberate': snapshotFor([
    spell({
      decisions: {
        targets: [select({
          filter: stackItems({
            kind: 'spell',
            any: [{ type: 'Instant' }, { type: 'Sorcery' }],
          }),
          count: 1,
        })],
      },
      instructions: [copySpell({
        targets: target(0),
        retarget: { kind: 'chooseNewTargets' },
      })],
    }),
  ]),
  'Diabolic Tutor': snapshotFor([
    spell({
      instructions: [searchLibrary({
        bindChoice: 'found',
        chooser: ref('controller'),
        filter: objects({ zone: 'library', owner: 'you' }),
        count: 1,
        to: 'hand',
      })],
    }),
  ]),
  'Glorious Anthem': snapshotFor([
    staticAbility(modifyStats({
      targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
      power: amount(1),
      toughness: amount(1),
    })),
  ]),
  'Rest in Peace': snapshotFor([
    whenever(self.enters, {
      instructions: [move({ targets: objects({ zone: 'graveyard' }), to: 'exile' })],
    }),
    staticAbility(replacement(wouldMove({ to: 'graveyard' }), redirectEvent('exile'))),
  ]),
  'Foil': snapshotFor([
    spell({
      costs: [manaCost('{2}{U}{U}')],
      alternativeCosts: [[
        manaCost('{0}'),
        discardCost(objects({ zone: 'hand', subtypes: ['Island'] }), 1),
        discardCost(objects({ zone: 'hand' }), 1),
      ]],
      decisions: {
        targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })],
      },
      instructions: [counter({ targets: target(0) })],
    }),
  ]),
})

export const cardRuleDefinitionSnapshotFor = (name: string) =>
  CARD_RULE_DEFINITION_CATALOG[name]
