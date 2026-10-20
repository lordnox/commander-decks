import type { GameObject } from '../types'
import {
  ability,
  addManaChoice,
  alternateCast,
  activate,
  becomeCopyOfTarget,
  allCreatureTypes,
  animateUntilEot,
  chooseColorOnEnter,
  drawHandSize,
  enchantedManaBoost,
  noMaximumHandSize,
  attachedCopyOrToken,
  attackTax,
  attacks,
  becomeMonarch,
  basicLand,
  embalm,
  exileUntilOpponentBecomesMonarch,
  bestow,
  blink,
  blockTax,
  bounceSelf,
  branch,
  castModal,
  casts,
  cleave,
  controlledLands,
  controllerLife,
  convoke,
  copyAllCreaturesUntilEot,
  copyControlledCreature,
  copySelf,
  copyTargetCreature,
  counterTargetSpell,
  counterUnlessPay,
  createTokenInstruction,
  createTreasures,
  crew,
  devour,
  discardCards,
  discardHandsThenDrawGreatest,
  dredge,
  doublePlusCounters,
  dealDamageToChosenTarget,
  draw,
  drawX,
  drawAtNextUpkeep,
  drawGreatestPower,
  drawHandDifference,
  encore,
  enters,
  entersIfCastOption,
  entersTargetingOpponent,
  entersTarget,
  entersTargetingUpToOne,
  entersTapped,
  gift,
  ifGiftPromised,
  grantProtectionFromEverything,
  lifeTotalCannotChange,
  opponentDealtCombatDamageByLegendaryThisTurn,
  opponentHasMore,
  phaseOutControlled,
  exileOpponentGraveyard,
  extraEnters,
  extraLandfall,
  exileColoredPermanentsAtMostX,
  fightOwnedVsOpponent,
  gainControlPermanent,
  gainLife,
  grantControlledUntilEot,
  graveyardCards,
  graveyardCardTypes,
  handler,
  handlerIdsFromEffects,
  hasSubtype,
  landToGraveyard,
  landToGraveyardOnce,
  landfall,
  linkExile,
  linkedExileUntilLeaves,
  legendRuleOff,
  loseAbilitiesBecome,
  loseLife,
  loseLifeTargetController,
  kicker,
  multikicker,
  putChargeCountersFromTimesKicked,
  loyalty,
  loyaltyX,
  lookTopPick,
  lookTopPutLand,
  lockOrUnlockDoor,
  manaIf,
  mayCastFromHandWithoutPayingMana,
  mayDraw,
  mayPayLifeDraw,
  millHalfTargetPlayers,
  millTarget,
  modalChooseOne,
  modalChooseTwo,
  modalCommanderChooseBoth,
  onResolve,
  onResolveIfCastOption,
  optionalMill,
  otherLands,
  opponentsSacrifice,
  opponentLostLifeThisTurn,
  playLandsFromGraveyard,
  pluginIdsFromEffects,
  ptEqualsLife,
  pumpTargetX,
  pumpSelf,
  pumpControlled,
  pumpControlledNonHuman,
  pumpFromLinkedExilePower,
  pumpPerLinkedExile,
  putFromHand,
  putLandFromHand,
  putMilledLandTapped,
  putPermanentsFromHand,
  revealPick,
  revealMatchingToHand,
  revealUntil,
  goadRevealUntilMatches,
  pairDonateRevealUntilMatches,
  opponentMayPayMana,
  attackBanUntilEot,
  putHandCardOnLibraryBottom,
  reduceGenericIf,
  reanimateCreatureFromGraveyards,
  returnChosenLandFromGraveyard,
  returnCreatureManaValueX,
  returnTargetFromGraveyard,
  returnLinkedExile,
  returnOwnedGraveyardLands,
  searchAbility,
  searchLibrary,
  searchSpell,
  sacrificePermanentsThenDraw,
  secretCouncil,
  selfMill,
  sharedBasicLandType,
  spree,
  spreeMode,
  staticExtraLandPlays,
  stackXAtLeast,
  staticGrant,
  staticPlayLandsFromLibraryTop,
  staticRevealLibraryTop,
  scry,
  surveil,
  tapAll,
  triggerOn,
  tapUnlessPayLife,
  tapUnlessRevealSubtype,
  typecycleHand,
  teferiSunsetEmblem,
  teferiSunsetPlusOne,
  targetOnResolve,
  targetOnResolveKicked,
  uniqueLandNames,
  upkeep,
  chooseModes,
  chooseCreatureType,
  chooseVotesThisTurn,
  eachPlayerDiscard,
  eachPlayerDraw,
  eachPlayerLoseLife,
  eachPlayerSacrifice,
  exchangeControlUntilEot,
  exchangeLifeWithOpponent,
  fightUpToOne,
  manaFrom,
  addUntilCleanupRule,
  gainLifeLostThisTurn,
  ifGiftNotPromised,
  revealDrawLoseLife,
  ward,
  xMana,
  yourUpkeep,
  yourUpkeepTarget,
  type CardEffect,
  type CardInstruction,
  payLifeX,
  playExiledWithLife,
  setAllLifeToLowest,
  winGame,
  yourUpkeepIf,
  yourEndTargetingOpponent,
  cumulativeUpkeepOpponentLife,
  uncounterable,
  restrictedCreatureMana,
  restrictedLegendaryMana,
  phaseOutTarget,
  putSelfOntoBattlefield,
  createHeroWithLandCounters,
  searchTargetControllerForBasicLandType,
  removeTarget,
  combatDialogueUntilEot,
  copyTargetForEachOtherPlayer,
  exileVoteWinners,
  vote,
  ifVoteLeads,
  forEachVoter,
  forEachVotedOption,
  copyTargetSpell,
  putCountersOnTriggeringObject,
  tapTriggeringObject,
  onVotesFinished,
  eachPlayerReturn,
  eachPlayerMayWheel,
  exileThisSpell,
  destroyAll,
  playerAuraDeal,
  targetingRequirement,
  addManaAtNextMainFromTarget,
  addPlusCountersToControlled,
  opponentMayDrawThenStealCast,
  flashback,
  grantRetrace,
  warp,
  ifTargetTypes,
  opponentsLoseLife,
  pumpAttached,
  pumpTargetEqualToLands,
  putTargetOnLibraryTop,
  revealTopLandsTapped,
  sagaChapters,
  tapAttached,
  destroyAllCreatures,
  bounceCreaturesExcept,
  addPlusCountersEqualToLands,
  escape,
  hiddenPileNegotiation,
  opponentPiles,
  millThenRecover,
  yourFirstMain,
  repeatIf,
  ifYouDoExileFromGraveyard,
  ptEqualsCount,
  reduceActivationCost,
  staticBoardPump,
  targetsOnResolve,
  optionalTargetOnResolve,
  upToTargetsOnResolve,
  addChosenColorMana,
  destroyTargetPermanent,
  mayDiscard,
  secondCardDrawn,
  loseLifeTargetPlayer,
  onUnlock,
  delve,
  unearth,
  bounceAll,
  blinkSelf,
  pumpFromLinkedExileStats,
  persist,
  annihilator,
  shuffleIntoLibraryInstead,
  opponentsCantBlock,
  opponentsCantCast,
  grantCreatureTrigger,
  mayFightGrantSource,
  leaves,
  eachPlayerDrawDamageDealtToSource,
  entersTargetingUpTo,
  entersTargeting,
  destroyThenTokenForController,
  permanentSacrificed,
  putTriggeringCardOntoBattlefield,
  permanentEnters,
  triggeringCreatureNameUnique,
} from './effects'

const fetchBasic = (prompt: string, extra: {
  life?: number
  tapped?: boolean
  manaCost?: string
  min?: number
  max?: number
  untapWithFourLands?: boolean
  validateSelection?: typeof sharedBasicLandType
} = {}): CardEffect => {
  const { life, manaCost, ...spec } = extra
  return searchAbility({
    prompt,
    match: basicLand,
    destination: 'battlefield',
    min: spec.min ?? 1,
    max: spec.max ?? 1,
    ...spec,
  }, {
    tap: true,
    sacrifice: 'self',
    ...(life ? { life } : {}),
    ...(manaCost ? { mana: manaCost } : {}),
  })
}

const insectToken = {
  name: 'Insect',
  types: ['Creature'],
  subtypes: ['Insect'],
  power: 1,
  toughness: 1,
}

const insect = createTokenInstruction(insectToken)

const eldraziSpawn = createTokenInstruction({
  name: 'Eldrazi Spawn',
  types: ['Creature'],
  subtypes: ['Eldrazi', 'Spawn'],
  power: 0,
  toughness: 1,
  oracleText: 'Sacrifice this token: Add {C}.',
  sacrificeForMana: { C: 1 },
})

const bird = createTokenInstruction({
  name: 'Bird',
  types: ['Creature'],
  subtypes: ['Bird'],
  power: 2,
  toughness: 2,
  oracleText: 'Flying',
})

const fish = createTokenInstruction({
  name: 'Fish',
  types: ['Creature'],
  subtypes: ['Fish'],
  colors: ['U'],
  power: 1,
  toughness: 1,
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

/**
 * Sin, Spira's Punishment: exile a random permanent card from your graveyard and
 * copy it tapped, repeating while the exiled card is a land.
 */
const specificSinSpiraPunishmentTriggeredAbility = (): CardInstruction => ({
  kind: 'randomExileCopyWhile',
  repeatWhileType: 'Land',
  tapped: true,
})

const artifactWithManaAbility = (object: GameObject) =>
  object.types.includes('Artifact')
  && (
    Boolean(object.tapProduces)
    || /\{T\}: Add /i.test(object.oracleText)
    || (object.effects ?? []).some((effect) =>
      effect.op === 'activate' && effect.manaAbility)
  )

// Keep leftover registrations sorted by Unicode card name until this object is removed.
export const CARD_RULES: Record<string, CardEffect[]> = {
  'Alabaster Host Intercessor': [
    linkedExileUntilLeaves(),
    enters(linkExile({ type: 'Creature', controller: 'opponent' })),
    typecycleHand('plainscycling.alabasterHostIntercessor', '{2}', 'Plains'),
  ],
  'Alchemist\'s Refuge': [
    activate({
      id: 'alchemistsRefuge.flash',
      costs: { mana: '{G}{U}', tap: true },
      do: [addUntilCleanupRule('flashGrant')],
    }),
  ],
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
  "Animist's Awakening": [xMana(), onResolve(revealTopLandsTapped())],
  'Apex Altisaur': [enters(fightUpToOne())],
  'Arcane Denial': [
    targetOnResolve('counter', { zone: 'stack' }, drawAtNextUpkeep(1), drawAtNextUpkeep(2, 'targetController', true)),
  ],
  "Archaeomancer's Map": [
    {
      op: 'search',
      via: 'enters',
      spec: {
        prompt: 'Search your library for up to two basic Plains cards, reveal them, put them into your hand, then shuffle.',
        match: (object) => basicLand(object) && hasSubtype('Plains')(object),
        destination: 'hand',
        min: 0,
        max: 2,
        reveal: true,
      },
    },
    triggerOn('playLand', {
      if: { seat: 'opponent' },
      do: [
        branch(opponentHasMore('lands'), [putLandFromHand()], []),
      ],
    }),
  ],
  'Archangel of Tithes': [
    attackTax(1, { whileUntapped: true }),
    blockTax(1, { whileAttacking: true }),
  ],
  "Archdruid's Charm": [modalChooseOne(
    {
      id: 'search',
      label: 'Search your library for a creature or land card.',
      do: [searchLibrary({
        prompt: 'Search for a creature or land card.',
        match: (object) => object.types.includes('Creature') || object.types.includes('Land'),
        destination: 'hand',
        min: 1,
        max: 1,
        reveal: true,
      })],
    },
    {
      id: 'fight',
      label: 'Put a +1/+1 counter on a creature you control. It fights.',
      do: [fightOwnedVsOpponent()],
    },
    {
      id: 'exile',
      label: 'Exile target artifact or enchantment.',
      do: [{ kind: 'destroyTargetPermanent', types: ['Artifact', 'Enchantment'] }],
    },
  )],
  'Archetype of Endurance': [
    staticBoardPump(0, 0, ['Creature'], { grantKeywords: ['hexproof'] }),
    staticBoardPump(0, 0, ['Creature'], {
      controller: 'opponent',
      suppressKeywords: ['hexproof'],
    }),
  ],
  'Awaken the Honored Dead': [
    sagaChapters(
      {
        numbers: [1],
        targets: { filter: { zone: 'battlefield', nonland: true, permanent: true } },
        do: [destroyTargetPermanent()],
      },
      { numbers: [2], do: [selfMill(3)] },
      {
        numbers: [3],
        do: [mayDiscard(1, {
          filter: { zone: 'graveyard', types: ['Creature', 'Land'] },
          do: [returnTargetFromGraveyard('hand')],
        })],
      },
    ),
  ],
  'Baird, Steward of Argive': [attackTax(1)],
  'Banisher Priest': [
    handler('linkedExile'),
    linkedExileUntilLeaves(),
    enters(linkExile({ type: 'Creature', controller: 'opponent' })),
  ],
  'Batwing Brume': [handler('combatPreventionCards')],
  Belonging: [
    enters(
      changelingShapeshifter(),
      changelingShapeshifter(),
      changelingShapeshifter(),
    ),
    allCreatureTypes(),
    encore('{6}{W}{W}'),
  ],
  'Bender\'s Waterskin': [staticGrant('extraUntap')],
  'Beza, the Bounding Spring': [
    enters(
      branch(opponentHasMore('lands'), [createTreasures(1, 'you')]),
      branch(opponentHasMore('life'), [gainLife(4)]),
      branch(opponentHasMore('creatures'), [fish, fish]),
      branch(opponentHasMore('cardsInHand'), [draw(1)]),
    ),
  ],
  'Bishop of Binding': [
    handler('linkedExile'),
    handler('exilePayoffs'),
    linkedExileUntilLeaves(),
    enters(linkExile({ type: 'Creature', controller: 'opponent' })),
    {
      op: 'trigger',
      on: 'attacks',
      targets: { filter: { type: 'Creature' } },
      do: [pumpFromLinkedExilePower('stackTarget')],
    },
  ],
  'Black Sun\'s Twilight': [
    xMana(),
    optionalTargetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature' },
      pumpTargetX(-1),
      returnCreatureManaValueX(5, true),
    ),
  ],
  'Blanket of Night': [staticGrant('swampOverlay')],
  'Blightsteel Colossus': [shuffleIntoLibraryInstead()],
  Blitzball: [
    ability(
      { id: 'blitzball.goal' },
      {
        tap: true,
        sacrifice: 'self',
        if: opponentDealtCombatDamageByLegendaryThisTurn(),
      },
      draw(2),
    ),
  ],
  'Blossoming Tortoise': [
    enters(selfMill(3), returnChosenLandFromGraveyard()),
    attacks(selfMill(3), returnChosenLandFromGraveyard()),
    reduceActivationCost(1),
    staticBoardPump(1, 1, ['Land']),
  ],
  'Boggart Trawler // Boggart Bog': [
    { op: 'replacement', on: 'enters', do: 'tapUnlessPayLife', life: 3, if: { kind: 'sourceType', type: 'Land' } },
    { op: 'trigger', on: 'enters', targets: 'player', sourceTypeAtTrigger: 'Creature', do: [{ kind: 'exileTargetPlayerGraveyard' }] },
  ],
  'Boseiju, Who Endures': [
    activate({
      id: 'channel.boseiju',
      zone: 'hand',
      costs: {
        mana: '{1}{G}',
        discard: 'self',
        reducePerLegendaryCreature: 1,
      },
      targets: {
        zone: 'battlefield',
        types: ['Artifact', 'Enchantment', 'Land'],
        controller: 'opponent',
        nonbasic: true,
      },
      do: [
        removeTarget('destroy'),
        searchTargetControllerForBasicLandType(),
      ],
    }),
  ],
  'Braids, Conjurer Adept': [upkeep(putFromHand('active', { types: ['Artifact', 'Creature', 'Land'] }))],
  'Breena, the Demagogue': [
    triggerOn('playerAttacks', {
      do: [
        { kind: 'draw', count: 1, who: 'triggeringPlayer' },
        addPlusCountersToControlled(2),
      ],
    }),
  ],
  'Bridgeworks Battle // Tanglespan Bridgeworks': [tapUnlessPayLife(3)],
  'Bubbling Muck': [onResolve(addUntilCleanupRule('extraSwampMana', { each: true }))],
  'Cavern of Souls': [
    enters(chooseCreatureType('setChosenType')),
    restrictedCreatureMana(),
  ],
  'Cephalid Coliseum': [
    activate({
      id: 'pain.cephalid',
      manaAbility: true,
      costs: { tap: true },
      do: [{ kind: 'addMana', mana: { U: 1 } }, { kind: 'dealDamageToSelf', amount: 1 }],
    }),
    activate({
      id: 'threshold.cephalid',
      costs: { mana: '{U}', tap: true, sacrifice: 'self' },
      if: graveyardCards(7),
      targets: { filter: { players: 'any' } },
      do: [draw(3, 'target'), discardCards(3, 'target')],
    }),
  ],
  'Children of Korlis': [
    ability(
      { id: 'childrenOfKorlis.recover' },
      { sacrifice: 'self' },
      gainLifeLostThisTurn(),
    ),
  ],
  'Choked Estuary': [tapUnlessRevealSubtype('Island', 'Swamp')],
  'City of Brass': [
    triggerOn('tapped', { do: [{ kind: 'dealDamageToSelf', amount: 1 }] }),
  ],
  'Cling to Dust': [
    escape('{3}{B}', 5),
    targetOnResolve(
      'exile',
      { zone: 'graveyard' },
      ifTargetTypes(['Creature'], [gainLife(3)], [draw(1)]),
    ),
  ],
  'Coercive Portal': [yourUpkeep(vote(
    'Vote for carnage or homage.',
    {
      kind: 'named',
      options: [{ id: 'carnage', label: 'Carnage' }, { id: 'homage', label: 'Homage' }],
    },
    [ifVoteLeads(
      'carnage',
      [{ kind: 'sacrificeSelf' }, destroyAll({ nonland: true })],
      [draw(1)],
    )],
  ))],
  Colossification: [
    targetOnResolve('select', { zone: 'battlefield', type: 'Creature' }),
    enters(tapAttached(), pumpAttached(20, 20)),
  ],
  Comeuppance: [handler('combatPreventionCards')],
  'Concordant Crossroads': [staticGrant('sharedHaste'), handler('sharedHaste')],
  "Council's Judgment": [
    onResolve(vote(
      'Vote for a nonland permanent you do not control.',
      {
        kind: 'objects',
        filter: { zone: 'battlefield', nonland: true, controller: 'opponent' },
      },
      [exileVoteWinners()],
    )),
  ],
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
  'Crypt Ghast': [staticGrant('extraSwampMana'), handler('extort')],
  'Curious Colossus': [enters(loseAbilitiesBecome('Coward', 1, 1))],
  'Círdan the Shipwright': [enters(secretCouncil()), attacks(secretCouncil())],
  'Dack Fayden, Helping Hand': [
    enters(
      revealUntil(
        'opponentCount',
        { type: 'Creature' },
        'battlefield',
        'shuffle',
        goadRevealUntilMatches(),
        pairDonateRevealUntilMatches(),
      ),
    ),
  ],
  'Dakmor Salvage': [dredge(2), entersTapped()],
  'Dark Confidant': [yourUpkeep(revealDrawLoseLife())],
  'Dark Tutelage': [yourUpkeep(revealDrawLoseLife())],
  'Darksteel Colossus': [shuffleIntoLibraryInstead()],
  'Decisive Denial': [modalChooseOne(
    {
      id: 'fight',
      label: 'Target creature you control fights target creature you don\'t control.',
      do: [fightOwnedVsOpponent()],
    },
    {
      id: 'counter',
      label: 'Counter target noncreature spell unless its controller pays {3}.',
      do: [counterUnlessPay(3)],
    },
  )],
  'Delighted Halfling': [restrictedLegendaryMana()],
  Desertion: [
    targetOnResolve(
      'counter',
      { zone: 'stack', stealIfTypes: ['Artifact', 'Creature'] },
    ),
  ],
  'Dig Through Time': [delve(), onResolve(lookTopPick(7, 2))],
  "Dovin's Veto": [
    uncounterable(),
    targetOnResolve('counter', { zone: 'stack', noncreature: true }),
  ],
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
  'Endless Sands': [
    handler('linkedExile'),
    ability(
      {
        id: 'endlessSands.exile',
        targets: { filter: { zone: 'battlefield', type: 'Creature', controller: 'you' } },
      },
      { mana: '{2}', tap: true },
      linkExile({ type: 'Creature', controller: 'you' }, {}),
    ),
    ability(
      { id: 'endlessSands.return' },
      { mana: '{4}', tap: true, sacrifice: 'self' },
      returnLinkedExile(),
    ),
  ],
  'Energy Arc': [handler('combatPreventionCards')],
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
  'Exotic Orchard': [manaFrom('opponentsLands')],
  'Fact or Fiction': [onResolve(opponentPiles(5, { reveal: 'public', piles: 'public' }))],
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
  'Fell the Profane': [
    targetOnResolve(
      'destroy',
      { zone: 'battlefield', types: ['Creature', 'Planeswalker'] },
      loseLifeTargetController(2),
    ),
  ],
  'Fell the Profane // Fell Mire': [
    tapUnlessPayLife(3),
    targetOnResolve(
      'destroy',
      { zone: 'battlefield', types: ['Creature', 'Planeswalker'] },
    ),
  ],
  'Fellwar Stone': [manaFrom('opponentsLands')],
  'Field of the Dead': [
    entersTapped(),
    landfall({
      kind: 'if',
      if: uniqueLandNames(7),
      whenTrue: [createTokenInstruction({
        name: 'Zombie',
        types: ['Creature'],
        subtypes: ['Zombie'],
        power: 2,
        toughness: 2,
      })],
    }),
  ],
  'Fiend Hunter': [
    handler('linkedExile'),
    linkedExileUntilLeaves(),
    enters(linkExile({ type: 'Creature', other: true }, { optional: true })),
  ],
  'Finale of Devastation': [
    xMana(),
    searchSpell({
      prompt: 'Search your library and/or graveyard for a creature card with mana value X or less and put it onto the battlefield.',
      match: (object) => object.types.includes('Creature'),
      maxManaValue: 'x',
      zones: ['library', 'graveyard'],
      destination: 'battlefield',
      min: 0,
      max: 1,
      shuffleIfSearched: true,
      then: [
        branch(stackXAtLeast(10), [
          pumpControlled(0, 0, { fromStackX: true }),
          grantControlledUntilEot('haste'),
        ]),
      ],
    }),
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
  'Flooded Grove': [
    activate({
      id: 'floodedGrove.filter',
      manaAbility: true,
      costs: { mana: '{G/U}', tap: true },
      do: [addManaChoice({ G: 2 }, { G: 1, U: 1 }, { U: 2 })],
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
  'Fractured Identity': [
    targetOnResolve(
      'exile',
      { zone: 'battlefield', nonland: true },
      copyTargetForEachOtherPlayer(),
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
  'Ghost Town': [
    activate({
      id: 'selfBounceLand.ghostTown',
      costs: {},
      if: { kind: 'notActivePlayer' },
      do: [bounceSelf()],
    }),
  ],
  'Glorious Protector': [
    handler('linkedExile'),
    linkedExileUntilLeaves(),
    enters(linkExile(
      { type: 'Creature', other: true, excludeSubtypes: ['Angel'] },
      { controlled: true, optional: true },
    )),
  ],
  'Grothama, All-Devouring': [
    grantCreatureTrigger({ controller: 'any', other: true }, 'attacks', mayFightGrantSource()),
    leaves(eachPlayerDrawDamageDealtToSource()),
  ],
  'Guardian Project': [
    permanentEnters(
      { type: 'Creature', controller: 'you', nontoken: true },
      { if: triggeringCreatureNameUnique(), do: [draw(1)] },
    ),
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
  'Homer, the Hermit': [handler('homer')],
  'Horizon of Progress': [
    activate({
      id: 'horizon.putLand',
      costs: { mana: '{3}', tap: true },
      do: [putLandFromHand(true)],
    }),
    manaFrom('controlledLands'),
    activate({
      id: 'horizon.draw',
      costs: { mana: '{1}', tap: true, sacrifice: 'self' },
      do: [draw(1)],
    }),
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
  Inkshield: [handler('combatPreventionCards')],
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
  'Keep Safe': [
    targetOnResolve(
      'counter',
      { zone: 'stack', spellTargetsControlledPermanent: true },
      draw(1),
    ),
  ],
  'Kindred Dominance': [onResolve(chooseCreatureType('destroyOthers'))],
  'Kiora Bests the Sea God': [sagaChapters(
    {
      numbers: [1],
      do: [createTokenInstruction({
        name: 'Kraken',
        types: ['Creature'],
        subtypes: ['Kraken'],
        colors: ['U'],
        power: 8,
        toughness: 8,
        oracleText: 'Hexproof',
      })],
    },
    {
      numbers: [2],
      targets: { filter: { players: 'opponent' } },
      do: [tapAll(
        { zone: 'battlefield', nonland: true },
        { ofTargetPlayer: true, skipNextUntap: true },
      )],
    },
    {
      numbers: [3],
      targets: { filter: { zone: 'battlefield', permanent: true, controller: 'opponent' } },
      do: [gainControlPermanent(true)],
    },
  )],
  'Kogla, the Titan Ape': [enters(fightUpToOne())],
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
  'Life from the Loam': [
    dredge(3),
    upToTargetsOnResolve(3, 'bounce', { zone: 'graveyard', type: 'Land' }),
  ],
  'Lotho, Corrupt Shirriff': [handler('blinkValue')],
  'Lumbering Battlement': [
    handler('linkedExile'),
    handler('exilePayoffs'),
    linkedExileUntilLeaves(),
    pumpPerLinkedExile(2, 2),
    enters(linkExile(
      { type: 'Creature', other: true },
      { controlled: true, optional: true },
    )),
  ],
  'Lumra, Bellow of the Woods': [
    ptEqualsCount('Land'),
    enters(selfMill(4), returnOwnedGraveyardLands()),
  ],
  'Malevolent Rumble': [onResolve(revealPick(4, { permanent: true }), eldraziSpawn)],
  'Mana Drain': [
    targetOnResolve(
      'counter',
      { zone: 'stack' },
      addManaAtNextMainFromTarget(),
    ),
  ],
  'Marina Vendrell': [
    enters(revealMatchingToHand(7, 'Enchantment')),
    activate({
      id: 'marina.lockOrUnlock',
      costs: { tap: true },
      targets: { zone: 'battlefield', subtype: 'Room', controller: 'you' },
      sorcery: true,
      do: [lockOrUnlockDoor()],
    }),
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
  Millikin: [
    activate({
      id: 'selfMill.millikin',
      manaAbility: true,
      costs: { tap: true, mill: 1 },
      do: [{ kind: 'addMana', mana: { C: 1 } }],
    }),
  ],
  'Mirkwood Bats': [
    enters({ filter: { controller: 'you', token: true }, createdOnly: true }, opponentsLoseLife(1)),
    permanentSacrificed({ controller: 'you', token: true }, opponentsLoseLife(1)),
  ],
  'Mirror Universe': [
    ability({
      id: 'mirrorUniverse.exchange',
      targets: 'opponent',
      if: { kind: 'controllerUpkeep' },
    }, { tap: true, sacrifice: 'self' }, exchangeLifeWithOpponent()),
  ],
  Mirrorweave: [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', nonlegendary: true },
      copyAllCreaturesUntilEot(false),
    ),
  ],
  'Mister Negative': [
    entersTargetingOpponent(exchangeLifeWithOpponent({ optional: true, drawLifeLost: true })),
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
  'Moonsilver Key': [
    searchAbility({
      prompt: 'Search your library for an artifact card with a mana ability or a basic land card, reveal it, put it into your hand, then shuffle.',
      match: (object) => basicLand(object) || artifactWithManaAbility(object),
      destination: 'hand',
      min: 1,
      max: 1,
      reveal: true,
    }, { mana: '{1}', tap: true, sacrifice: 'self' }),
  ],
  'Mossborn Hydra': [landfall(doublePlusCounters()), handler('mossborn-hydra')],
  Mulldrifter: [
    alternateCast('evoke', 'Evoke {2}{U}', '{2}{U}'),
    entersIfCastOption('evoke', { kind: 'sacrificeSelf' }),
    enters(draw(2)),
  ],
  'Myriad Landscape': [
    entersTapped(),
    fetchBasic(
      'Search your library for up to two basic land cards that share a land type. They enter tapped.',
      {
        tapped: true,
        min: 0,
        max: 2,
        manaCost: '{2}',
        validateSelection: sharedBasicLandType,
      },
    ),
  ],
  'Mystic Sanctuary': [
    entersTapped(otherLands({ max: 2, subtype: 'Island' })),
    {
      op: 'trigger',
      on: 'enters',
      if: otherLands({ min: 3, subtype: 'Island' }),
      targets: { filter: { zone: 'graveyard', types: ['Instant', 'Sorcery'], controller: 'you' } },
      do: [putTargetOnLibraryTop()],
    },
  ],
  'Nanogene Conversion': [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', controller: 'you' },
      copyAllCreaturesUntilEot(),
    ),
  ],
  Necrologia: [payLifeX({ timing: 'yourEndStep' }), onResolve(drawX())],
  'Nezahal, Primal Tide': [
    uncounterable(),
    staticGrant('noMaxHand'),
    handler('noMaxHand'),
    casts(draw(1), { castBy: 'opponent', noncreatureOnly: true }),
    ability(
      { id: 'nezahal.reset' },
      { discard: 'any', discardCount: 3 },
      blinkSelf({ when: 'nextEndStep', tapped: true }),
    ),
  ],
  'Nirkana Revenant': [
    staticGrant('extraSwampMana'),
    activate({
      id: 'nirkanaRevenant.pump',
      costs: { mana: '{B}' },
      do: [pumpSelf(1, 1)],
    }),
  ],
  'Niv-Mizzet, Ghost Counsel': [
    triggerOn('gainLife', { if: { seat: 'controller' }, do: [mayPayLifeDraw()] }),
    activate({
      id: 'nivMizzetGhostCounsel.drain',
      costs: { tap: true },
      do: [opponentsLoseLife(1), gainLife(1)],
    }),
  ],
  'Otawara, Soaring City': [
    activate({
      id: 'channel.otawara',
      zone: 'hand',
      costs: {
        mana: '{3}{U}',
        discard: 'self',
        reducePerLegendaryCreature: 1,
      },
      targets: {
        zone: 'battlefield',
        types: ['Artifact', 'Creature', 'Enchantment', 'Planeswalker'],
      },
      do: [removeTarget('bounce')],
    }),
  ],
  'Overwhelming Stampede': [
    onResolve(pumpControlled(0, 0, { trample: true, powerFromGreatest: true })),
  ],
  'Palace Jailer': [
    enters(
      becomeMonarch(),
      exileUntilOpponentBecomesMonarch({ type: 'Creature', controller: 'opponent' }),
    ),
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
  'Pathbreaker Ibex': [
    attacks(pumpControlled(0, 0, { trample: true, powerFromGreatest: true })),
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
  'Phial of Galadriel': [staticGrant('phialReplacement')],
  'Phyrexian Ingester': [
    pumpFromLinkedExileStats(),
    {
      op: 'trigger',
      on: 'enters',
      targets: { filter: { type: 'Creature', nontoken: true }, min: 0 },
      do: [linkExile({ type: 'Creature', nontoken: true }, { optional: true, max: 1 })],
    },
  ],
  'Pile On': [
    convoke(),
    targetOnResolve('destroy', { zone: 'battlefield', types: ['Creature', 'Planeswalker'] }, surveil(2)),
  ],
  'Pit of Offerings': [entersTapped(), handler('pit-of-offerings')],
  'Pitiless Carnage': [onResolve(sacrificePermanentsThenDraw())],
  'Planar Genesis': [onResolve(lookTopPutLand(4, { orHand: true }))],
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
  'Profane Command': [
    xMana(),
    modalChooseTwo(
      {
        id: 'drain',
        label: 'Target player loses X life.',
        do: [{ kind: 'loseLifeTargetPlayer', amount: 0 }],
      },
      {
        id: 'reanimate',
        label: 'Return a creature card with mana value X or less from your graveyard.',
        do: [returnCreatureManaValueX()],
      },
      {
        id: 'shrink',
        label: 'Target creature gets -X/-X until end of turn.',
        do: [pumpTargetX(-1)],
      },
      {
        id: 'fear',
        label: 'Up to X target creatures gain fear until end of turn.',
        do: [{ kind: 'grantUntilEot', keywords: ['fear'], maxFromX: true }],
      },
    ),
  ],
  'Quantum Misalignment': [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', controller: 'you' },
      copyTargetCreature({ notLegendary: true }),
    ),
  ],
  'Queza, Augur of Agonies': [handler('blinkValue')],
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
  'Reflecting Pool': [manaFrom('controlledLands')],
  'Reins of Power': [onResolve(exchangeControlUntilEot()), handler('reinsOfPower')],
  'Repay in Kind': [onResolve(setAllLifeToLowest())],
  Reprocess: [
    onResolve(sacrificePermanentsThenDraw(['Artifact', 'Creature', 'Land'])),
  ],
  'Return of the Wildspeaker': [modalChooseOne(
    {
      id: 'draw',
      label: 'Draw cards equal to the greatest power among non-Human creatures you control.',
      do: [drawGreatestPower({ nonHuman: true })],
    },
    {
      id: 'pump',
      label: 'Non-Human creatures you control get +3/+3 until end of turn.',
      do: [pumpControlledNonHuman(3, 3)],
    },
  )],
  'Rings of Brighthearth': [handler('stackCopy')],
  'Ripples of Undeath': [yourFirstMain(millThenRecover(3, { mana: '{1}', life: 3 }))],
  "Rishkar's Expertise": [
    onResolve(drawGreatestPower(), mayCastFromHandWithoutPayingMana(5)),
  ],
  'Roaming Throne': [
    ward({ mana: 2 }),
    handler('ward'),
    enters(chooseCreatureType('addToSource')),
  ],
  'Sail into the West': [
    onResolve(vote(
      'Vote for return or embark.',
      {
        kind: 'named',
        options: [{ id: 'return', label: 'Return' }, { id: 'embark', label: 'Embark' }],
      },
      [ifVoteLeads(
        'return',
        [eachPlayerReturn(2), exileThisSpell()],
        [eachPlayerMayWheel(7)],
      )],
    )),
  ],
  'Sakashima of a Thousand Faces': [
    legendRuleOff(),
    enters(copyControlledCreature({ keepName: true })),
  ],
  'Sandstone Oracle': [entersTargetingOpponent(drawHandDifference())],
  'Satyr Wayfinder': [enters(revealPick(4, { type: 'Land' }))],
  Scapeshift: [
    searchSpell({
      prompt: 'Search your library for that many land cards. They enter tapped.',
      match: (object) => object.types.includes('Land'),
      destination: 'battlefield',
      tapped: true,
      min: 0,
      max: 99,
      sacrificeOnResolve: 'any',
    }),
  ],
  'Scute Swarm': [
    landfall(branch(controlledLands({ min: 6 }), [copySelf()], [insect])),
  ],
  'Sea Gate Restoration // Sea Gate, Reborn': [
    tapUnlessPayLife(3),
    onResolve(drawHandSize(1), noMaximumHandSize()),
  ],
  "Selvala's Stampede": [
    onResolve(vote(
      'Vote for wild or free.',
      {
        kind: 'named',
        options: [{ id: 'wild', label: 'Wild' }, { id: 'free', label: 'Free' }],
      },
      [
        revealUntil({ voters: { votedFor: 'wild' } }, { type: 'Creature' }, 'battlefield', 'shuffle'),
        putPermanentsFromHand({ voters: { votedFor: 'free' } }),
      ],
    )),
  ],
  'Settle the Wreckage': [handler('combatPreventionCards')],
  'Show and Tell': [onResolve(putFromHand('each', {
    types: ['Artifact', 'Creature', 'Enchantment', 'Land'],
  }))],
  'Silverback Elder': [castModal({
    choose: 'one',
    modes: [
      {
        id: 'destroy',
        label: 'Destroy target artifact or enchantment.',
        do: [{ kind: 'destroyTargetPermanent', types: ['Artifact', 'Enchantment'] }],
      },
      {
        id: 'land',
        label: 'Look at the top five cards of your library. You may put a land card from among them onto the battlefield tapped.',
        do: [{ kind: 'lookTopPutLand', count: 5 }],
      },
      {
        id: 'life',
        label: 'You gain 4 life.',
        do: [gainLife(4)],
      },
    ],
  }, { creatureOnly: true })],
  "Sin, Spira's Punishment": [
    enters(specificSinSpiraPunishmentTriggeredAbility()),
    attacks(specificSinSpiraPunishmentTriggeredAbility()),
  ],
  'Singularity Rupture': [
    onResolve(destroyAllCreatures(), millHalfTargetPlayers()),
    targetOnResolve('select', { players: 'any' }),
  ],
  'Sink into Stupor // Soporific Springs': [
    tapUnlessPayLife(3),
    targetOnResolve(
      'bounce',
      { zones: ['stack', 'battlefield'], nonland: true, controller: 'opponent' },
    ),
  ],
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
  'Sokrates, Athenian Teacher': [
    targetingRequirement('hexproof-while-untapped'),
    activate({
      id: 'sokrates.dialogue',
      costs: { tap: true },
      targets: 'creature',
      do: [combatDialogueUntilEot()],
    }),
    handler('combatDialogue'),
  ],
  'Soul of Eternity': [
    ptEqualsLife({ who: 'controller' }),
    encore('{7}{W}{W}'),
  ],
  'Souls of the Faultless': [
    triggerOn('dealtCombatDamage', {
      do: [
        gainLife('triggerAmount'),
        loseLife('triggerAmount', 'triggeringPlayer'),
      ],
    }),
  ],
  'Spark Double': [enters(copyControlledCreature({ notLegendary: true, plusCounters: 1 }))],
  'Split Decision': [
    targetOnResolve(
      'select',
      { zone: 'stack', types: ['Instant', 'Sorcery'] },
      vote(
        'Vote for denial or duplication.',
        {
          kind: 'named',
          options: [{ id: 'denial', label: 'Denial' }, { id: 'duplication', label: 'Duplication' }],
        },
        [ifVoteLeads('denial', [counterTargetSpell(true)], [copyTargetSpell()])],
      ),
    ),
  ],
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
  'Summon: Titan': [sagaChapters(
    { numbers: [1], do: [selfMill(5)] },
    { numbers: [2], do: [returnOwnedGraveyardLands()] },
    { numbers: [3], do: [pumpTargetEqualToLands(true)] },
  )],
  'Sygg, River Cutthroat': [
    triggerOn('end', {
      if: opponentLostLifeThisTurn(3),
      do: [mayDraw(1)],
    }),
  ],
  'Tainted Sigil': [
    ability(
      { id: 'taintedSigil.recover' },
      { tap: true, sacrifice: 'self' },
      gainLifeLostThisTurn('all'),
    ),
  ],
  'Talon Gates of Madara': [
    entersTargetingUpToOne(
      { zone: 'battlefield', type: 'Creature' },
      phaseOutTarget(),
    ),
    activate({
      id: 'talon.any-mana',
      manaAbility: true,
      costs: { mana: '{1}', tap: true },
      do: [{ kind: 'addChosenColorMana' }],
    }),
    activate({
      id: 'talon.put',
      zone: 'hand',
      costs: { mana: '{4}' },
      do: [putSelfOntoBattlefield()],
    }),
  ],
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
  'Temple of the False God': [manaIf(controlledLands({ min: 5 }))],
  'Tenuous Truce': [playerAuraDeal()],
  Terastodon: [
    entersTargetingUpTo(
      3,
      { zone: 'battlefield', permanent: true, noncreature: true },
      destroyThenTokenForController({
        name: 'Elephant',
        types: ['Creature'],
        subtypes: ['Elephant'],
        colors: ['G'],
        power: 3,
        toughness: 3,
      }),
    ),
  ],
  'Test of Endurance': [
    yourUpkeepIf(controllerLife(50), winGame()),
  ],
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
  'Thunderfoot Baloth': [
    staticBoardPump(2, 2, ['Creature'], {
      if: { kind: 'controlsCommander' },
      affects: 'self',
    }),
    staticBoardPump(2, 2, ['Creature'], {
      if: { kind: 'controlsCommander' },
      affects: 'others',
      grantKeywords: ['trample'],
    }),
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
  'Urborg, Tomb of Yawgmoth': [staticGrant('swampOverlay')],
  'Utopia Sprawl': [chooseColorOnEnter(), enchantedManaBoost({ chosenColor: true })],
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
  'Victimize': [
    targetsOnResolve(
      'reanimate',
      { zone: 'graveyard', type: 'Creature', controller: 'you' },
      { count: 2, tapped: true, sacrificeThen: { type: 'Creature' } },
    ),
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
  'Waterlogged Teachings // Inundated Archive': [
    entersTapped(),
    searchSpell({
      prompt: 'Search your library for an instant card or a card with flash.',
      match: (object) =>
        object.types.includes('Instant') || /\bflash\b/i.test(object.oracleText),
      destination: 'hand',
      min: 1,
      max: 1,
      reveal: true,
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
  'Werefox Bodyguard': [
    handler('linkedExile'),
    linkedExileUntilLeaves(),
    enters(linkExile(
      { type: 'Creature', other: true, excludeSubtypes: ['Fox'] },
      { optional: true, max: 1 },
    )),
    ability(
      { id: 'werefoxBodyguard.gain' },
      { mana: '{W}', sacrifice: 'self' },
      gainLife(2),
    ),
  ],
  'Wild Growth': [enchantedManaBoost({ mana: 'G' })],
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
  Windfall: [onResolve(discardHandsThenDrawGreatest())],
  'Woodfall Primus': [
    entersTargeting(
      { zone: 'battlefield', permanent: true, noncreature: true },
      destroyTargetPermanent(),
    ),
    persist(),
  ],
  'Yarok, the Desecrated': [extraEnters(1), extraLandfall(1)],
  'Yavimaya, Cradle of Growth': [staticGrant('forestOverlay')],
  'Yurlok of Scorch Thrash': [
    staticGrant('manaBurn'),
    activate({
      id: 'yurlok.mana-rain',
      manaAbility: true,
      costs: { tap: true, mana: '{1}' },
      do: [{ kind: 'addManaToEachPlayer', mana: { B: 1, R: 1, G: 1 } }],
    }),
  ],
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
