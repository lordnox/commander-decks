import type { GameObject } from '../../types'
import type { AbilityDefinition, CardRuleDefinitionSnapshotV1 } from './schema/v1'
import {
  activated,
  amount,
  card,
  chooseCards,
  choice,
  chooseInstructions,
  may,
  chooseModes,
  revealUntil,
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
  enters,
  extraLandPlays,
  gainLife,
  keyword,
  loseLife,
  manaCost,
  mill,
  modifyStats,
  move,
  objects,
  players,
  pumpEffect,
  redirectEvent,
  ref,
  replacement,
  sequence,
  searchLibrary,
  sacrificeCost,
  select,
  self,
  spell,
  stackItems,
  staticAbility,
  target,
  untilCleanup,
  whenever,
  wouldDraw,
  wouldMove,
  replaceWith,
} from './v1'

const snapshotFor = (abilities: readonly AbilityDefinition[]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

/** Printed characteristics and executable rules share one canonical card entry. */
const CARD_TEMPLATE_CATALOG: Readonly<Record<string,
  Pick<GameObject, 'types' | 'colors' | 'manaCost' | 'manaValue'> & {
    ruleDefinition: CardRuleDefinitionSnapshotV1
  }
>> = Object.freeze({
  'Aesi, Tyrant of Gyre Strait': {
    types: ['Creature'],
    colors: ['G', 'U'],
    manaCost: '{4}{G}{U}',
    manaValue: 6,
    ruleDefinition: snapshotFor([
      staticAbility(extraLandPlays(1)),
      whenever(
        enters({ filter: { type: 'Land', controller: 'you' } }),
        { instructions: [may(draw(1))] },
      ),
    ]),
  },
  Abundance: {
    types: ['Enchantment'],
    colors: ['G'],
    manaCost: '{2}{G}{G}',
    manaValue: 4,
    ruleDefinition: snapshotFor([
      staticAbility(replacement(
        wouldDraw({ player: players({ relation: 'you' }) }),
        replaceWith(chooseInstructions({
          chooser: ref('event.player'),
          prompt: 'Draw normally, or name land or nonland for this draw.',
          options: [
            { label: 'Draw normally', instructions: [draw({ count: 1, targets: ref('event.player') })] },
            { label: 'Land', instructions: [revealUntil({
              targets: ref('event.player'),
              match: objects({ zone: 'library', type: 'Land' }),
              foundTo: 'hand',
              rest: 'orderBottom',
            })] },
            { label: 'Nonland', instructions: [revealUntil({
              targets: ref('event.player'),
              match: objects({ zone: 'library', not: { type: 'Land' } }),
              foundTo: 'hand',
              rest: 'orderBottom',
            })] },
          ],
        })),
      )),
    ]),
  },
  Aetherize: {
    types: ['Instant'],
    colors: ['U'],
    manaCost: '{3}{U}',
    manaValue: 4,
    ruleDefinition: snapshotFor([
      spell({
        instructions: [move({
          targets: objects({ zone: 'battlefield', attacking: true }),
          to: 'hand',
        })],
      }),
    ]),
  },
  'Aftermath Analyst': {
    types: ['Creature'],
    colors: ['G'],
    manaCost: '{1}{G}',
    manaValue: 2,
    ruleDefinition: snapshotFor([
      whenever(self.enters, {
        instructions: [mill({ count: 3, targets: ref('controller') })],
      }),
      activated({
        costs: [manaCost('{3}{G}'), sacrificeCost(ref('source'), 1)],
        instructions: [move({
          targets: objects({ zone: 'graveyard', owner: 'you', type: 'Land' }),
          to: 'battlefield',
          tapped: true,
        })],
      }),
    ]),
  },
  'Growth Spiral': {
    types: ['Instant'],
    colors: ['G', 'U'],
    manaCost: '{G}{U}',
    manaValue: 2,
    ruleDefinition: snapshotFor([
      spell({
        instructions: [
          draw({ count: 1, targets: ref('controller') }),
          sequence(
            chooseCards({
              bindChoice: 'land',
              chooser: ref('controller'),
              filter: objects({ zone: 'hand', owner: 'you', type: 'Land' }),
              min: 0,
              max: 1,
            }),
            move({ targets: choice('land'), to: 'battlefield' }),
          ),
        ],
      }),
    ]),
  },
  'Three Visits': {
    types: ['Sorcery'],
    colors: ['G'],
    manaCost: '{1}{G}',
    manaValue: 2,
    ruleDefinition: snapshotFor([
      spell({
        instructions: [searchLibrary({
          bindChoice: 'forest',
          chooser: ref('controller'),
          filter: objects({ zone: 'library', owner: 'you', subtypes: ['Forest'] }),
          min: 0,
          max: 1,
          to: 'battlefield',
        })],
      }),
    ]),
  },
  Dismember: {
    types: ['Instant'],
    colors: ['B'],
    manaCost: '{1}{B/P}{B/P}',
    manaValue: 3,
    ruleDefinition: snapshotFor([
      spell({
        decisions: {
          targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })],
        },
        costs: [manaCost('{1}{B/P}{B/P}')],
        instructions: [createEffect({
          targets: target(0),
          effect: pumpEffect(-5, -5),
          duration: untilCleanup(),
        })],
      }),
    ]),
  },
  Harrow: {
    types: ['Instant'],
    colors: ['G'],
    manaCost: '{2}{G}',
    manaValue: 3,
    ruleDefinition: snapshotFor([
      spell({
        costs: [sacrificeCost(objects({ zone: 'battlefield', controller: 'you', type: 'Land' }), 1)],
        instructions: [searchLibrary({
          bindChoice: 'found',
          chooser: ref('controller'),
          filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }),
          min: 0,
          max: 2,
          to: 'battlefield',
        })],
      }),
    ]),
  },
  "Nature's Lore": {
    types: ['Sorcery'],
    colors: ['G'],
    manaCost: '{1}{G}',
    manaValue: 2,
    ruleDefinition: snapshotFor([
      spell({
        instructions: [searchLibrary({
          bindChoice: 'forest',
          chooser: ref('controller'),
          filter: objects({ zone: 'library', owner: 'you', subtypes: ['Forest'] }),
          min: 0,
          max: 1,
          to: 'battlefield',
        })],
      }),
    ]),
  },
  'Counterspell': {
    types: ['Instant'],
    colors: ['U'],
    manaCost: '{U}{U}',
    manaValue: 2,
    ruleDefinition: snapshotFor([
      spell({
        decisions: { targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })] },
        instructions: [counter({ targets: target(0) })],
      }),
    ]),
  },
})

/** A caller owns its copy, including mutable types and the pinned rule snapshot. */
export const cardTemplateDefaultsFor = (name: string) => {
  const template = CARD_TEMPLATE_CATALOG[name]
  return template ? structuredClone(template) : undefined
}

/**
 * Name-keyed canonical snapshots, compiled once at module load.
 * Lookup is exact card name; this is not a kernel dispatcher.
 */
const CARD_RULE_DEFINITION_CATALOG: Readonly<Record<string, CardRuleDefinitionSnapshotV1>> = Object.freeze({
  'Aesi, Tyrant of Gyre Strait': CARD_TEMPLATE_CATALOG['Aesi, Tyrant of Gyre Strait'].ruleDefinition,
  Abundance: CARD_TEMPLATE_CATALOG.Abundance.ruleDefinition,
  Aetherize: CARD_TEMPLATE_CATALOG.Aetherize.ruleDefinition,
  'Aftermath Analyst': CARD_TEMPLATE_CATALOG['Aftermath Analyst'].ruleDefinition,
  Dismember: CARD_TEMPLATE_CATALOG.Dismember.ruleDefinition,
  Harrow: CARD_TEMPLATE_CATALOG.Harrow.ruleDefinition,
  'Absorb': snapshotFor([
    spell({
      decisions: { targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })] },
      instructions: [counter({ targets: target(0) }), gainLife({ amount: 3, targets: ref('controller') })],
    }),
  ]),
  'Counterspell': CARD_TEMPLATE_CATALOG.Counterspell.ruleDefinition,
  'Anguished Unmaking': snapshotFor([
    spell({
      decisions: {
        targets: [select({ filter: objects({ zone: 'battlefield', not: { type: 'Land' } }), count: 1 })],
      },
      instructions: [
        move({ targets: target(0), to: 'exile' }),
        loseLife({ amount: 3, targets: ref('controller') }),
      ],
    }),
  ]),
  'Duskdale Wurm': snapshotFor([keyword.trample]),
  'Wall of Omens': snapshotFor([
    keyword.defender,
    whenever(self.enters, {
      instructions: [draw({ count: 1, targets: ref('controller') })],
    }),
  ]),
  'Eternal Witness': snapshotFor([
    whenever(self.enters, {
      decisions: {
        targets: [select({ filter: objects({ zone: 'graveyard', owner: 'you', token: false }), count: 1 })],
      },
      instructions: [chooseInstructions({
        chooser: ref('controller'),
        prompt: 'Return the target card?',
        options: [
          { label: 'Return it to your hand', instructions: [move({ targets: target(0), to: 'hand' })] },
          { label: 'Decline', instructions: [] },
        ],
      })],
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
  'Buried Alive': snapshotFor([
    spell({ instructions: [searchLibrary({
      bindChoice: 'found', chooser: ref('controller'),
      filter: objects({ zone: 'library', owner: 'you', type: 'Creature' }), min: 0, max: 3, to: 'graveyard',
    })] }),
  ]),
  'Growth Spiral': CARD_TEMPLATE_CATALOG['Growth Spiral'].ruleDefinition,
  'Three Visits': CARD_TEMPLATE_CATALOG['Three Visits'].ruleDefinition,
  "Nature's Lore": CARD_TEMPLATE_CATALOG["Nature's Lore"].ruleDefinition,
  'Entomb': snapshotFor([
    spell({ instructions: [searchLibrary({
      bindChoice: 'found', chooser: ref('controller'),
      filter: objects({ zone: 'library', owner: 'you' }), count: 1, to: 'graveyard',
    })] }),
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
