import type { GameObject } from '../types'
import {
  ability,
  alternateCast,
  activate,
  becomeCopyOfTarget,
  allCreatureTypes,
  animateUntilEot,
  attachedCopyOrToken,
  attackTax,
  attacks,
  basicLand,
  embalm,
  bestow,
  blink,
  blockTax,
  cleave,
  controlledLands,
  convoke,
  copyAllCreaturesUntilEot,
  copyControlledCreature,
  copySelf,
  copyTargetCreature,
  createTokenInstruction,
  createTreasures,
  crew,
  devour,
  dealDamageToChosenTarget,
  draw,
  drawGreatestPower,
  encore,
  enters,
  entersIfCastOption,
  entersTarget,
  entersTapped,
  gift,
  ifGiftPromised,
  grantProtectionFromEverything,
  lifeTotalCannotChange,
  phaseOutControlled,
  exileOpponentGraveyard,
  extraEnters,
  extraLandfall,
  exileColoredPermanentsAtMostX,
  gainLife,
  graveyardCards,
  graveyardCardTypes,
  handler,
  handlerIdsFromEffects,
  landToGraveyard,
  landToGraveyardOnce,
  landfall,
  linkExile,
  linkedExileUntilLeaves,
  legendRuleOff,
  loseAbilitiesBecome,
  kicker,
  multikicker,
  putChargeCountersFromTimesKicked,
  loyalty,
  loyaltyX,
  lookTopPick,
  lookTopPutLand,
  mayCastFromHandWithoutPayingMana,
  mayPayLifeDraw,
  millTarget,
  modalCommanderChooseBoth,
  onResolve,
  onResolveIfCastOption,
  optionalMill,
  otherLands,
  opponentsSacrifice,
  playLandsFromGraveyard,
  pluginIdsFromEffects,
  ptEqualsLife,
  putFromHand,
  putLandFromHand,
  putMilledLandTapped,
  putPermanentsFromHand,
  revealPick,
  revealUntil,
  opponentMayPayMana,
  attackBanUntilEot,
  putHandCardOnLibraryBottom,
  reduceGenericIf,
  reanimateCreatureFromGraveyards,
  returnTargetFromGraveyard,
  returnOwnedGraveyardLands,
  searchSpell,
  sacrificePermanentsThenDraw,
  secretCouncil,
  selfMill,
  spree,
  spreeMode,
  staticExtraLandPlays,
  staticGrant,
  staticPlayLandsFromLibraryTop,
  staticRevealLibraryTop,
  scry,
  surveil,
  triggerOn,
  teferiSunsetEmblem,
  teferiSunsetPlusOne,
  targetOnResolve,
  targetOnResolveKicked,
  upkeep,
  chooseModes,
  chooseCreatureType,
  chooseVotesThisTurn,
  eachPlayerDiscard,
  eachPlayerDraw,
  eachPlayerLoseLife,
  eachPlayerSacrifice,
  exchangeControlUntilEot,
  addUntilCleanupRule,
  ifGiftNotPromised,
  ward,
  yourUpkeep,
  yourUpkeepTarget,
  type CardEffect,
  type CardInstruction,
  playExiledWithLife,
  yourEndTargetingOpponent,
  cumulativeUpkeepOpponentLife,
  restrictedCreatureMana,
  restrictedLegendaryMana,
  createHeroWithLandCounters,
  removeTarget,
  vote,
  forEachVoter,
  forEachVotedOption,
  putCountersOnTriggeringObject,
  tapTriggeringObject,
  onVotesFinished,
  playerAuraDeal,
  targetingRequirement,
  opponentMayDrawThenStealCast,
  flashback,
  grantRetrace,
  warp,
  ifTargetTypes,
  opponentsLoseLife,
  pumpAttached,
  pumpTargetEqualToLands,
  sagaChapters,
  tapAttached,
  bounceCreaturesExcept,
  addPlusCountersEqualToLands,
  escape,
  hiddenPileNegotiation,
  opponentPiles,
  repeatIf,
  ifYouDoExileFromGraveyard,
  ptEqualsCount,
  addChosenColorMana,
  destroyTargetPermanent,
  secondCardDrawn,
  loseLifeTargetPlayer,
  onUnlock,
  unearth,
  bounceAll,
  persist,
  annihilator,
  shuffleIntoLibraryInstead,
  opponentsCantBlock,
  opponentsCantCast,
  entersTargeting,
  permanentSacrificed,
  putTriggeringCardOntoBattlefield,
} from './effects'

const insectToken = {
  name: 'Insect',
  types: ['Creature'],
  subtypes: ['Insect'],
  power: 1,
  toughness: 1,
}

const insect = createTokenInstruction(insectToken)

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
  'Archangel of Tithes': [
    attackTax(1, { whileUntapped: true }),
    blockTax(1, { whileAttacking: true }),
  ],
  'Baird, Steward of Argive': [attackTax(1)],
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
  'Cavern of Souls': [
    enters(chooseCreatureType('setChosenType')),
    restrictedCreatureMana(),
  ],
  'Cling to Dust': [
    escape('{3}{B}', 5),
    targetOnResolve(
      'exile',
      { zone: 'graveyard' },
      ifTargetTypes(['Creature'], [gainLife(3)], [draw(1)]),
    ),
  ],
  Colossification: [
    targetOnResolve('select', { zone: 'battlefield', type: 'Creature' }),
    enters(tapAttached(), pumpAttached(20, 20)),
  ],
  'Concordant Crossroads': [staticGrant('sharedHaste'), handler('sharedHaste')],
  'Courser of Kruphix': [
    staticRevealLibraryTop(),
    staticPlayLandsFromLibraryTop(),
    handler('courserOfKruphix'),
    landfall(gainLife(1)),
  ],
  'Crawling Sensation': [
    yourUpkeep(optionalMill(2)),
    landToGraveyardOnce(insect),
  ],
  'Curious Colossus': [enters(loseAbilitiesBecome('Coward', 1, 1))],
  'Círdan the Shipwright': [enters(secretCouncil()), attacks(secretCouncil())],
  'Darksteel Colossus': [shuffleIntoLibraryInstead()],
  'Delighted Halfling': [restrictedLegendaryMana()],
  'Drag to the Roots': [
    reduceGenericIf(2, graveyardCardTypes(4)),
    targetOnResolve('destroy', { zone: 'battlefield', nonland: true }),
  ],
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
  'Everflowing Chalice': [
    multikicker('{2}'),
    enters(putChargeCountersFromTimesKicked()),
  ],
  'Everybody Lives!': [handler('combatPreventionCards')],
  'Famished Worldsire': [
    ward({ mana: 3 }),
    handler('ward'),
    enters(
      devour(['Land'], 3, lookTopPutLand(0, {
        countFromPower: true,
        anyNumber: true,
        tapped: true,
        shuffleAfter: true,
      })),
    ),
  ],
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
  'Getaway Glamer': [
    spree([
      spreeMode(
        'blink',
        '+ {1} — Exile target nontoken creature. Return it to the battlefield under its owner\'s control at the beginning of the next end step.',
        '{1}',
        [blink({ when: 'nextEndStep', returnController: 'owner', targetIndex: 0 })],
      ),
      spreeMode(
        'kill',
        '+ {2} — Destroy target creature if no other creature has greater power.',
        '{2}',
        [dealDamageToChosenTarget(9999)],
      ),
    ]),
    targetOnResolve('select', { zone: 'battlefield', type: 'Creature' }),
  ],
  'Glorious Protector': [
    handler('linkedExile'),
    linkedExileUntilLeaves(),
    enters(linkExile(
      { type: 'Creature', other: true, excludeSubtypes: ['Angel'] },
      { controlled: true, optional: true },
    )),
  ],
  'Hagra Mauling // Hagra Broodpit': [
    entersTapped(),
    targetOnResolve('destroy', { zone: 'battlefield', type: 'Creature' }),
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
  'Icetill Explorer': [
    staticExtraLandPlays(1),
    playLandsFromGraveyard(),
    landfall(selfMill(1)),
  ],
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
  'It That Betrays': [
    annihilator(2),
    permanentSacrificed(
      { controller: 'opponent', nontoken: true },
      putTriggeringCardOntoBattlefield(),
    ),
  ],
  'Jace, Multiverse Architect': [
    triggerOn('beginCombat', {
      if: { kind: 'notActivePlayer' },
      do: [
        opponentMayPayMana('{2}', [
          attackBanUntilEot({
            zone: 'battlefield',
            types: ['Planeswalker'],
            subtypes: ['Jace'],
            controller: 'you',
          }),
        ]),
      ],
    }),
    ability({ id: 'jace.plus-one' }, loyalty(1), draw(2), putHandCardOnLibraryBottom()),
    ability(
      {
        id: 'jace.minus-three',
        targets: {
          filter: {
            zone: 'battlefield',
            types: ['Creature', 'Planeswalker'],
            controller: 'you',
            other: true,
          },
        },
      },
      loyalty(-3),
      removeTarget('exile'),
      revealUntil(1, { types: ['Creature', 'Planeswalker'] }, 'battlefield', 'bottomRandom'),
    ),
    handler('optionalManaPay'),
  ],
  'Joint Exploration': [onResolve(draw(1)), handler('jointExploration')],
  'Kederekt Leviathan': [
    enters(bounceAll({ nonland: true, other: true })),
    unearth('{6}{U}'),
  ],
  'Kindred Dominance': [onResolve(chooseCreatureType('destroyOthers'))],
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
  'Lotho, Corrupt Shirriff': [handler('blinkValue')],
  'Lumra, Bellow of the Woods': [
    ptEqualsCount('Land'),
    enters(selfMill(4), returnOwnedGraveyardLands()),
  ],
  'Masked Vandal': [
    allCreatureTypes(),
    entersTarget(
      { types: ['Artifact', 'Enchantment'], controller: 'opponent' },
      ifYouDoExileFromGraveyard({ type: 'Creature' }),
    ),
  ],
  'Maskwood Nexus': [
    allCreatureTypes(),
    activate({
      id: 'maskwood.token',
      costs: { mana: '{3}', tap: true },
      do: [createTokenInstruction({
        name: 'Shapeshifter',
        types: ['Creature'],
        subtypes: ['Shapeshifter'],
        power: 2,
        toughness: 2,
        oracleText: 'Changeling',
      })],
    }),
  ],
  Mirrorweave: [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', nonlegendary: true },
      copyAllCreaturesUntilEot(false),
    ),
  ],
  'Mole Man, Moloid Master': [
    playLandsFromGraveyard(),
    landfall(createTokenInstruction({
      name: 'Moloid',
      types: ['Creature'],
      subtypes: ['Minion'],
      power: 1,
      toughness: 1,
      oracleText: 'Whenever this token attacks, you may mill a card.',
      effects: [attacks(optionalMill(1))],
    })),
  ],
  Mulldrifter: [
    alternateCast('evoke', 'Evoke {2}{U}', '{2}{U}'),
    entersIfCastOption('evoke', { kind: 'sacrificeSelf' }),
    enters(draw(2)),
  ],
  'Nanogene Conversion': [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', controller: 'you' },
      copyAllCreaturesUntilEot(),
    ),
  ],
  'Niv-Mizzet, Ghost Counsel': [
    triggerOn('gainLife', { if: { seat: 'controller' }, do: [mayPayLifeDraw()] }),
    activate({
      id: 'nivMizzetGhostCounsel.drain',
      costs: { tap: true },
      do: [opponentsLoseLife(1), gainLife(1)],
    }),
  ],
  'Parting Gust': [
    gift({
      label: 'Gift a tapped Fish',
      token: {
        name: 'Fish',
        types: ['Creature'],
        subtypes: ['Fish'],
        power: 1,
        toughness: 1,
        tapped: true,
      },
    }),
    targetOnResolve(
      'exile',
      { zone: 'battlefield', type: 'Creature' },
      ifGiftNotPromised(blink({
        when: 'nextEndStep',
        plusCounters: 1,
        returnController: 'owner',
        targetIndex: 0,
      })),
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
  'Pile On': [
    convoke(),
    targetOnResolve('destroy', { zone: 'battlefield', types: ['Creature', 'Planeswalker'] }, surveil(2)),
  ],
  'Pitiless Carnage': [onResolve(sacrificePermanentsThenDraw())],
  'Portal to Phyrexia': [
    enters(opponentsSacrifice('Creature', 3)),
    upkeep(reanimateCreatureFromGraveyards('Phyrexian')),
  ],
  'Price of Fame': [
    reduceGenericIf(2, {
      kind: 'target',
      filter: { zone: 'battlefield', type: 'Creature', supertype: 'Legendary' },
    }),
    targetOnResolve('destroy', { zone: 'battlefield', type: 'Creature' }, surveil(2)),
  ],
  'Quantum Misalignment': [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', controller: 'you' },
      copyTargetCreature({ notLegendary: true }),
    ),
  ],
  'Rain of Filth': [
    onResolve(addUntilCleanupRule('sacrificeLandMana')),
  ],
  'Raise the Palisade': [onResolve(chooseCreatureType('bounceOthers'))],
  'Rankle, Master of Pranks': [
    triggerOn('combatDamage', {
      do: [chooseModes('any', [
        {
          id: 'discard',
          label: 'Each player discards a card',
          do: [eachPlayerDiscard(1)],
        },
        {
          id: 'drain',
          label: 'Each player loses 1 life and draws a card',
          do: [eachPlayerLoseLife(1), eachPlayerDraw(1)],
        },
        {
          id: 'sacrifice',
          label: 'Each player sacrifices a creature',
          do: [eachPlayerSacrifice('Creature')],
        },
      ])],
    }),
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
  'Sire of Seven Deaths': [ward({ life: 7 })],
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
  'Springheart Nantuko': [
    bestow('{1}{G}', { power: 1, toughness: 1 }),
    landfall(attachedCopyOrToken('{1}{G}', insectToken)),
  ],
  'Standard Bearer': [targetingRequirement('flagbearer')],
  'Starfield of Nyx': [
    staticGrant('starfieldOfNyx'),
    yourUpkeepTarget(
      { zone: 'graveyard', type: 'Enchantment', controller: 'you' },
      [returnTargetFromGraveyard('battlefield', false, true)],
    ),
  ],
  'Summon: Leviathan': [sagaChapters(
    {
      numbers: [1],
      do: [bounceCreaturesExcept('Kraken', 'Leviathan', 'Merfolk', 'Octopus', 'Serpent')],
    },
    {
      numbers: [2, 3],
      do: [addUntilCleanupRule('attackSubtypeDraw', {
        subtypes: ['Kraken', 'Leviathan', 'Merfolk', 'Octopus', 'Serpent'],
      })],
    },
  )],
  'Tear Asunder': [
    kicker('{1}{B}'),
    targetOnResolveKicked(
      'exile',
      { zone: 'battlefield', types: ['Artifact', 'Enchantment'] },
      { zone: 'battlefield', nonland: true },
    ),
  ],
  'Teferi, Who Slows the Sunset': [
    ability({
      id: 'teferi.plus-one',
      targets: 'teferiSunsetPlusOne',
    }, loyalty(1), teferiSunsetPlusOne()),
    ability({
      id: 'teferi.minus-two',
    }, loyalty(-2), lookTopPick(3, 1)),
    ability({
      id: 'teferi.minus-seven',
    }, loyalty(-7), teferiSunsetEmblem()),
    handler('teferiSunset'),
  ],
  'Tenuous Truce': [playerAuraDeal()],
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
  'Ugin, the Spirit Dragon': [
    ability({
      id: 'ugin.plus-two',
      targets: 'any',
    }, loyalty(2), dealDamageToChosenTarget(3)),
    ability({
      id: 'ugin.minus-x',
    }, loyaltyX(), exileColoredPermanentsAtMostX()),
    ability({
      id: 'ugin.minus-ten',
    }, loyalty(-10), gainLife(7), draw(7), putPermanentsFromHand(7)),
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
  'Void Winnower': [
    opponentsCantCast({ parity: 'even' }),
    opponentsCantBlock({ parity: 'even' }),
  ],
  'Walk-In Closet': [playLandsFromGraveyard()],
  'Wall of Shards': [yourUpkeep(cumulativeUpkeepOpponentLife())],
  'Wash Away': [
    cleave('{1}{U}{U}'),
    targetOnResolve('counter', {
      zone: 'stack',
      bracketed: { castFromNot: 'hand' },
    }),
  ],
  'Wedding Ring': [
    triggerOn('enters', {
      if: { fromSpell: true },
      targets: 'opponent',
      do: [copySelf({ for: 'targetPlayer' })],
    }),
    triggerOn('draw', {
      if: { seat: 'opponent', duringActiveTurn: true, opponentControlsSameName: true },
      do: [draw(1)],
    }),
    triggerOn('gainLife', {
      if: { seat: 'opponent', duringActiveTurn: true, opponentControlsSameName: true },
      do: [gainLife('triggerAmount')],
    }),
  ],
  'Will of the Sultai': [modalCommanderChooseBoth(
    {
      id: 'lands',
      label: 'Target player mills three cards. Return all land cards from your graveyard tapped.',
      do: [millTarget(3), returnOwnedGraveyardLands()],
    },
    {
      id: 'pump',
      label: 'Put X +1/+1 counters on target creature, where X is the number of lands you control. It gains trample.',
      do: [addPlusCountersEqualToLands(), pumpTargetEqualToLands(true)],
    },
  )],
  'Woodfall Primus': [
    entersTargeting(
      { zone: 'battlefield', permanent: true, noncreature: true },
      destroyTargetPermanent(),
    ),
    persist(),
  ],
  'Yarok, the Desecrated': [extraEnters(1), extraLandfall(1)],
  'Zanarkand, Ancient Metropolis // Lasting Fayth': [
    entersTapped(),
    alternateCast('adventure', 'Lasting Fayth — {4}{G}{G}', '{4}{G}{G}', {
      fromZone: 'hand',
      exileAfterUse: true,
    }),
    onResolveIfCastOption('adventure', createHeroWithLandCounters()),
  ],
  'Zimone and Dina': [
    triggerOn('draw', {
      if: secondCardDrawn(),
      targets: 'opponent',
      do: [loseLifeTargetPlayer(2), gainLife(2)],
    }),
    activate({
      id: 'zimone.draw',
      costs: { tap: true, sacrificeTarget: 'creature', sacrificeOther: true },
      do: [
        draw(1),
        putLandFromHand(true),
        repeatIf(controlledLands({ min: 8 }), draw(1), putLandFromHand(true)),
      ],
    }),
  ],
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
