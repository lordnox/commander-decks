import type { GameObject } from '../types'
import {
  ability,
  alternateCast,
  becomeCopyOfTarget,
  allCreatureTypes,
  basicLand,
  embalm,
  copyAllCreaturesUntilEot,
  copyControlledCreature,
  copyTargetCreature,
  createTokenInstruction,
  draw,
  encore,
  enters,
  gift,
  ifGiftPromised,
  grantProtectionFromEverything,
  lifeTotalCannotChange,
  phaseOutControlled,
  gainLife,
  handler,
  handlerIdsFromEffects,
  linkExile,
  linkedExileUntilLeaves,
  legendRuleOff,
  onResolve,
  playLandsFromGraveyard,
  pluginIdsFromEffects,
  ptEqualsLife,
  putFromHand,
  reanimateCreatureFromGraveyards,
  searchSpell,
  sacrificePermanentsThenDraw,
  selfMill,
  staticGrant,
  targetOnResolve,
  exchangeControlUntilEot,
  type CardEffect,
  type CardInstruction,
  yourEndTargetingOpponent,
  opponentMayDrawThenStealCast,
  flashback,
  warp,
  ifTargetTypes,
  escape,
  onUnlock,
  unearth,
  bounceAll,
} from './effects'

const bird = createTokenInstruction({
  name: 'Bird',
  types: ['Creature'],
  subtypes: ['Bird'],
  power: 2,
  toughness: 2,
  oracleText: 'Flying',
})

const changelingShapeshifter = () => createTokenInstruction({
  name: 'Shapeshifter',
  types: ['Creature'],
  subtypes: ['Shapeshifter'],
  power: 1,
  toughness: 1,
  oracleText: 'Changeling',
})

const perchBirds = (): CardInstruction[] => [bird, bird, bird, bird]

// Keep leftover registrations sorted by Unicode card name until this object is removed.
export const CARD_RULES: Record<string, CardEffect[]> = {
  'All-Fates Stalker': [
    ...warp('{1}{W}'),
    handler('linkedExile'),
    linkedExileUntilLeaves(),
    {
      op: 'trigger',
      on: 'enters',
      targets: { filter: { type: 'Creature', excludeSubtypes: ['Assassin'] } },
      do: [linkExile(
        { type: 'Creature', excludeSubtypes: ['Assassin'] },
        { optional: true, max: 1 },
      )],
    },
  ],
  'Analyze the Pollen': [
    searchSpell({
      prompt: 'Choose one basic land card for Analyze the Pollen.',
      kickedPrompt: 'Choose one creature or land card for Analyze the Pollen.',
      match: basicLand,
      kickedMatch: (object) =>
        object.types.includes('Creature') || object.types.includes('Land'),
      destination: 'hand',
      min: 1,
      max: 1,
      reveal: true,
    }),
  ],
  'Angel of Sanctions': [
    handler('linkedExile'),
    linkedExileUntilLeaves(),
    embalm('{5}{W}', { colors: ['W'], extraSubtypes: ['Zombie'] }),
    enters(linkExile({ nonland: true, controller: 'opponent' }, { optional: true })),
  ],
  Belonging: [
    enters(
      changelingShapeshifter(),
      changelingShapeshifter(),
      changelingShapeshifter(),
    ),
    allCreatureTypes(),
    encore('{6}{W}{W}'),
  ],
  'Cling to Dust': [
    escape('{3}{B}', 5),
    targetOnResolve(
      'exile',
      { zone: 'graveyard' },
      ifTargetTypes(['Creature'], [gainLife(3)], [draw(1)]),
    ),
  ],
  'Concordant Crossroads': [staticGrant('sharedHaste'), handler('sharedHaste')],
  'Dread Return': [
    flashback('Flashback—Sacrifice three creatures.', '', {
      sacrifice: { type: 'Creature', count: 3 },
    }),
    targetOnResolve('reanimate', { zone: 'graveyard', type: 'Creature' }),
  ],
  Ephemerate: [handler('blinkValue')],
  'Everybody Lives!': [handler('combatPreventionCards')],
  'Forgotten Cellar': [onUnlock()],
  'Glorious Protector': [
    handler('linkedExile'),
    linkedExileUntilLeaves(),
    enters(linkExile(
      { type: 'Creature', other: true, excludeSubtypes: ['Angel'] },
      { controlled: true, optional: true },
    )),
  ],
  'Hypergenesis': [onResolve(putFromHand('each', {
    types: ['Artifact', 'Creature', 'Enchantment', 'Land'],
    repeat: true,
  }))],
  'Incarnation Technique': [
    onResolve(selfMill(5), reanimateCreatureFromGraveyards()),
    handler('demonstrate'),
  ],
  "Irenicus's Vile Duplication": [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', controller: 'you' },
      copyTargetCreature({ notLegendary: true, flying: true }),
    ),
  ],
  'Kederekt Leviathan': [
    enters(bounceAll({ nonland: true, other: true })),
    unearth('{6}{U}'),
  ],
  'Kuroki, Thief of Talents': [
    yourEndTargetingOpponent(opponentMayDrawThenStealCast(4)),
  ],
  Mirrorweave: [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', nonlegendary: true },
      copyAllCreaturesUntilEot(false),
    ),
  ],
  'Nanogene Conversion': [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', controller: 'you' },
      copyAllCreaturesUntilEot(),
    ),
  ],
  'Perch Protection': [
    gift({ label: 'Gift an extra turn', extraTurn: true }),
    onResolve(
      ...perchBirds(),
      ifGiftPromised(
        phaseOutControlled(),
        grantProtectionFromEverything(),
        lifeTotalCannotChange(),
      ),
    ),
  ],
  'Pitiless Carnage': [onResolve(sacrificePermanentsThenDraw())],
  'Quantum Misalignment': [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', controller: 'you' },
      copyTargetCreature({ notLegendary: true }),
    ),
  ],
  'Reins of Power': [onResolve(exchangeControlUntilEot()), handler('reinsOfPower')],
  'Sakashima of a Thousand Faces': [
    legendRuleOff(),
    enters(copyControlledCreature({ keepName: true })),
  ],
  'Snuff Out': [
    alternateCast('pay-4-life', 'Pay 4 life', '', {
      life: 4,
      controlledSubtype: 'Swamp',
    }),
    targetOnResolve('destroy', { zone: 'battlefield', type: 'Creature', nonblack: true }),
  ],
  'Soul of Eternity': [
    ptEqualsLife({ who: 'controller' }),
    encore('{7}{W}{W}'),
  ],
  'Spark Double': [enters(copyControlledCreature({ notLegendary: true, plusCounters: 1 }))],
  'Thespian\'s Stage': [
    ability(
      { id: 'thespiansStage.copy', sorcery: true },
      { mana: '{2}', tap: true },
      becomeCopyOfTarget({
        filter: { zone: 'battlefield', type: 'Land' },
        keepAbility: true,
      }),
    ),
  ],
  'Vanish into Memory': [handler('blinkValue')],
  'Walk-In Closet': [playLandsFromGraveyard()],
}

export const effectsFor = (name: string): CardEffect[] => CARD_RULES[name] ?? []

/** Every handler module a host has to load for this table's cards. */
export const allHandlerIds = () =>
  [...new Set(Object.values(CARD_RULES).flatMap(handlerIdsFromEffects))].sort()

/** Handlers required by the named cards, not the whole Oracle table. */
export const handlerIdsForNames = (names: string[]) =>
  [...new Set(names.flatMap((name) => handlerIdsFromEffects(effectsFor(name))))].sort()

export const effectsOf = (
  object: Pick<GameObject, 'name'> & Partial<Pick<GameObject, 'effects' | 'ruleDefinition'>>,
) => {
  if (object.ruleDefinition && !(object.effects && object.effects.length > 0)) return []
  return object.effects && object.effects.length > 0 ? object.effects : effectsFor(object.name)
}

export const cardDefinition = (name: string) => {
  const effects = CARD_RULES[name]
  if (!effects) return
  return {
    name,
    pluginIds: pluginIdsFromEffects(effects),
    handlerIds: handlerIdsFromEffects(effects),
    effects,
  }
}
