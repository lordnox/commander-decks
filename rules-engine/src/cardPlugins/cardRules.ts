import type { GameObject } from '../types'
import {
  ability,
  alternateCast,
  activate,
  becomeCopyOfTarget,
  allCreatureTypes,
  animateUntilEot,
  attacks,
  basicLand,
  embalm,
  copyAllCreaturesUntilEot,
  copyControlledCreature,
  copyTargetCreature,
  createTokenInstruction,
  createTreasures,
  crew,
  draw,
  drawGreatestPower,
  encore,
  enters,
  entersTapped,
  gift,
  ifGiftPromised,
  grantProtectionFromEverything,
  lifeTotalCannotChange,
  phaseOutControlled,
  exileOpponentGraveyard,
  extraEnters,
  extraLandfall,
  gainLife,
  graveyardCards,
  handler,
  handlerIdsFromEffects,
  landToGraveyard,
  linkExile,
  linkedExileUntilLeaves,
  legendRuleOff,
  mayCastFromHandWithoutPayingMana,
  onResolve,
  optionalMill,
  otherLands,
  playLandsFromGraveyard,
  pluginIdsFromEffects,
  ptEqualsLife,
  putFromHand,
  putMilledLandTapped,
  revealPick,
  reanimateCreatureFromGraveyards,
  searchSpell,
  sacrificePermanentsThenDraw,
  secretCouncil,
  selfMill,
  staticGrant,
  scry,
  targetOnResolve,
  chooseCreatureType,
  chooseVotesThisTurn,
  exchangeControlUntilEot,
  ward,
  type CardEffect,
  type CardInstruction,
  playExiledWithLife,
  yourEndTargetingOpponent,
  vote,
  forEachVoter,
  forEachVotedOption,
  putCountersOnTriggeringObject,
  tapTriggeringObject,
  onVotesFinished,
  opponentMayDrawThenStealCast,
  flashback,
  grantRetrace,
  warp,
  ifTargetTypes,
  escape,
  hiddenPileNegotiation,
  opponentPiles,
  addChosenColorMana,
  onUnlock,
  unearth,
  bounceAll,
  shuffleIntoLibraryInstead,
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
  'Ancient Greenwarden': [playLandsFromGraveyard(), extraLandfall(1)],
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
  'Blightsteel Colossus': [shuffleIntoLibraryInstead()],
  'Cling to Dust': [
    escape('{3}{B}', 5),
    targetOnResolve(
      'exile',
      { zone: 'graveyard' },
      ifTargetTypes(['Creature'], [gainLife(3)], [draw(1)]),
    ),
  ],
  'Concordant Crossroads': [staticGrant('sharedHaste'), handler('sharedHaste')],
  'Círdan the Shipwright': [enters(secretCouncil()), attacks(secretCouncil())],
  'Darksteel Colossus': [shuffleIntoLibraryInstead()],
  'Dread Return': [
    flashback('Flashback—Sacrifice three creatures.', '', {
      sacrifice: { type: 'Creature', count: 3 },
    }),
    targetOnResolve('reanimate', { zone: 'graveyard', type: 'Creature' }),
  ],
  Ephemerate: [handler('blinkValue')],
  'Erestor of the Council': [onVotesFinished(
    forEachVoter('opponentsAgreeing', createTreasures(1, 'triggeringPlayer')),
    scry({ voters: 'opponentsDisagreeing' }),
    draw(1),
  )],
  'Eureka': [onResolve(putFromHand('each', { repeat: true }))],
  'Everybody Lives!': [handler('combatPreventionCards')],
  'Firdoch Core': [
    allCreatureTypes(),
    activate({
      id: 'firdoch.mana',
      manaAbility: true,
      costs: { tap: true },
      do: [addChosenColorMana()],
    }),
    activate({
      id: 'animate.firdochCore',
      costs: { mana: '{4}' },
      do: [animateUntilEot(4, 4)],
    }),
  ],
  'Forgotten Cellar': [onUnlock()],
  "Fortune's Favor": [
    targetOnResolve(
      'select',
      { players: 'opponent' },
      opponentPiles(4, { reveal: 'look', piles: 'facedown-faceup' }),
    ),
  ],
  'Glorious Protector': [
    handler('linkedExile'),
    linkedExileUntilLeaves(),
    enters(linkExile(
      { type: 'Creature', other: true, excludeSubtypes: ['Angel'] },
      { controlled: true, optional: true },
    )),
  ],
  'Hall of Storm Giants': [
    entersTapped(otherLands({ min: 2 })),
    activate({
      id: 'hall.animate',
      costs: { mana: '{6}{U}' },
      if: graveyardCards(7),
      do: [animateUntilEot(7, 7)],
    }),
  ],
  'Hedge Shredder': [
    attacks(optionalMill(2)),
    landToGraveyard(putMilledLandTapped()),
    crew(1),
  ],
  'Hostile Negotiations': [onResolve(hiddenPileNegotiation(3, 3))],
  'Hypergenesis': [onResolve(putFromHand('each', {
    types: ['Artifact', 'Creature', 'Enchantment', 'Land'],
    repeat: true,
  }))],
  'Illusion of Choice': [onResolve(chooseVotesThisTurn(), draw(1))],
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
  'Lair of the Hydra': [
    entersTapped(otherLands({ min: 2 })),
    activate({
      id: 'lair.animate',
      costs: { mana: '{X}{G}', xMana: true },
      do: [animateUntilEot(0, 0, { fromX: true })],
    }),
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
  'Rings of Brighthearth': [handler('stackCopy')],
  "Rishkar's Expertise": [
    onResolve(drawGreatestPower(), mayCastFromHandWithoutPayingMana(5)),
  ],
  'Roaming Throne': [
    ward({ mana: 2 }),
    handler('ward'),
    enters(chooseCreatureType('addToSource')),
  ],
  'Sakashima of a Thousand Faces': [
    legendRuleOff(),
    enters(copyControlledCreature({ keepName: true })),
  ],
  'Show and Tell': [onResolve(putFromHand('each', {
    types: ['Artifact', 'Creature', 'Enchantment', 'Land'],
  }))],
  Six: [
    attacks(selfMill(3), revealPick(3, { type: 'Land' })),
    grantRetrace(),
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
  'Trap the Trespassers': [
    onResolve(vote(
      'Secretly vote for a creature the caster does not control.',
      {
        kind: 'objects',
        filter: { zone: 'battlefield', type: 'Creature', controller: 'opponent' },
      },
      [forEachVotedOption(
        putCountersOnTriggeringObject('stun', 'triggerAmount'),
        tapTriggeringObject(),
      )],
      true,
    )),
  ],
  'Valgavoth, Terror Eater': [
    ward({ sacrifice: { count: 3, nonland: true } }),
    staticGrant('exiledWith'),
    exileOpponentGraveyard(),
    playExiledWithLife(),
    handler('ward'),
    handler('exiledWith'),
  ],
  'Vanish into Memory': [handler('blinkValue')],
  'Vantress Visions': [
    targetOnResolve('copy', { zone: 'stack', types: ['Instant', 'Sorcery'] }),
  ],
  'Virtue of Knowledge': [extraEnters(1), extraLandfall(1)],
  'Walk-In Closet': [playLandsFromGraveyard()],
  'Yarok, the Desecrated': [extraEnters(1), extraLandfall(1)],
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
