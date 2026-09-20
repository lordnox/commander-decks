import type { GameObject } from '../types'
import {
  ability,
  alternateCast,
  activate,
  becomeCopyOfTarget,
  allCreatureTypes,
  animateUntilEot,
  addPlusCountersInstruction,
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
  bounceChosenLand,
  bounceSelf,
  branch,
  castModal,
  casts,
  cleave,
  controlledBasicLands,
  controlledCreaturePower,
  controlledLands,
  controllerLife,
  convoke,
  copyAllCreaturesUntilEot,
  copyControlledCreature,
  copySelf,
  copyTargetCreature,
  counterTargetSpell,
  bounceTargetPermanent,
  counterUnlessPay,
  cycleHand,
  createTokenInstruction,
  createTreasures,
  crew,
  createXTokens,
  dies,
  discardCards,
  discardHandsThenDrawGreatest,
  dredge,
  doublePlusCounters,
  dealDamageToChosenTarget,
  dealDamageTargetX,
  draw,
  drawX,
  drainOpponentsX,
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
  extraEnters,
  extraLandfall,
  extraLandPlays,
  exileColoredPermanentsAtMostX,
  fightOwnedVsOpponent,
  gainLife,
  grantUntilEot,
  graveyardCards,
  graveyardCardTypes,
  graveyardPermanentCards,
  handler,
  handlerIdsFromEffects,
  hasSubtype,
  landToGraveyard,
  landToGraveyardOnce,
  landfall,
  landfallTargeting,
  linkExile,
  linkedExileUntilLeaves,
  legendRuleOff,
  loseAbilitiesBecome,
  loseLife,
  loseLifeTargetManaValue,
  loseLifeTargetController,
  kicker,
  multikicker,
  putChargeCountersFromTimesKicked,
  loyalty,
  loyaltyX,
  lookTopChooseOne,
  lookTopPutLand,
  lockOrUnlockDoor,
  manaIf,
  mayDraw,
  millHalfTargetPlayers,
  millTarget,
  modalChooseOne,
  modalChooseTwo,
  modalCommanderChooseBoth,
  onResolve,
  onResolveIfCastOption,
  optionalBasicLandEnters,
  optionalMill,
  otherLands,
  opponentsAtMost,
  opponentsSacrifice,
  opponentLostLifeThisTurn,
  playLandsFromGraveyard,
  pluginIdsFromEffects,
  ptEqualsLife,
  pump,
  pumpTargetX,
  pumpSelf,
  pumpAllCreaturesByX,
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
  revealUntilBasicLand,
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
  splitBasicLandSearch,
  spree,
  spreeMode,
  staticExtraLandPlays,
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
  targetOnResolveAt,
  uniqueLandNames,
  upkeep,
  bounceAttacking,
  chooseModes,
  chooseCreatureType,
  chooseVotesThisTurn,
  eachPlayerDiscard,
  eachPlayerDraw,
  eachPlayerLoseLife,
  eachPlayerSacrifice,
  exchangeControlUntilEot,
  exchangeLifeWithOpponent,
  fight,
  fightUpToOne,
  lacksControlledSubtype,
  addManaPerSwamp,
  manaFrom,
  addUntilCleanupRule,
  gainLifeTargetPower,
  gainLifeLostThisTurn,
  ifGiftNotPromised,
  preventCombatDamage,
  revealDrawLoseLife,
  untapTarget,
  yourUpkeep,
  yourUpkeepTarget,
  type CardEffect,
  type CardInstruction,
  payLifeX,
  setAllLifeToLowest,
  winGame,
  xMana,
  yourUpkeepIf,
  yourEndTargetingOpponent,
  cumulativeUpkeepOpponentLife,
  uncounterable,
  restrictedCreatureMana,
  phaseOutTarget,
  putSelfOntoBattlefield,
  createHeroWithLandCounters,
  searchTargetControllerForBasicLandType,
  removeTarget,
  combatDialogueUntilEot,
  copyTargetForEachOtherPlayer,
  councilVote,
  playerAuraDeal,
  targetingRequirement,
  loseHalfLifeRoundedUp,
  addManaAtNextMainFromTarget,
  gainLifeTargetToughness,
  tapOpponentsCreatures,
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
  sacrificeControlled,
  sagaChapters,
  tapAttached,
  destroyAllCreatures,
  bounceCreaturesExcept,
  addPlusCountersEqualToLands,
  discardCards,
  escape,
  hiddenPileNegotiation,
  replaceDrawByType,
} from './effects'

const astralDriftCycleBlink = blink({
  optional: true,
  when: 'nextEndStep',
  filter: { zone: 'battlefield', type: 'Creature' },
})

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

const fetchTypes = (prompt: string, subtypes: string[]): CardEffect =>
  searchAbility({
    prompt,
    match: hasSubtype(...subtypes),
    destination: 'battlefield',
    min: 1,
    max: 1,
  }, {
    tap: true,
    life: 1,
    sacrifice: 'self',
  })

const fetchHideout = (prompt: string, subtypes: string[]): CardEffect => ({
  op: 'search',
  via: 'enters',
  spec: {
    prompt,
    match: (object) => basicLand(object) && subtypes.some((subtype) =>
      object.subtypes.includes(subtype)),
    destination: 'battlefield',
    tapped: true,
    min: 0,
    max: 1,
    gainLife: 1,
  },
})

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

const lootAndTreasure = (id: string): CardEffect => activate({
  id,
  costs: { mana: '{2}', tap: true },
  do: [draw(1), discardCards(1), createTreasures(1, 'you')],
})

const signet = (id: string, mana: Partial<{ W: number; U: number; B: number; R: number; G: number }>): CardEffect =>
  activate({
    id,
    manaAbility: true,
    costs: { mana: '{1}', tap: true },
    do: [{ kind: 'addMana', mana }],
  })

const coffersMana = (id: string, cost: string, basic = false): CardEffect =>
  activate({
    id,
    manaAbility: true,
    costs: { mana: cost, tap: true },
    do: [addManaPerSwamp(basic)],
  })

const cycleFromHand = (id: string, mana = '{3}') => cycleHand(id, mana)

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

export const CARD_RULES: Record<string, CardEffect[]> = {
  Abundance: [replaceDrawByType()],
  'Hostile Negotiations': [onResolve(hiddenPileNegotiation(3, 3))],
  'Bala Ged Recovery // Bala Ged Sanctuary': [
    entersTapped(),
    targetOnResolve('bounce', { zone: 'graveyard' }),
  ],
  'Bridgeworks Battle // Tanglespan Bridgeworks': [tapUnlessPayLife(3)],
  'Broken Bond': [
    targetOnResolve(
      'destroy',
      { zone: 'battlefield', types: ['Artifact', 'Enchantment'] },
      putLandFromHand(),
    ),
  ],
  Burgeoning: [
    triggerOn('playLand', {
      if: { seat: 'opponent' },
      do: [putLandFromHand()],
    }),
  ],
  'Crop Rotation': [
    searchSpell({
      prompt: 'Search your library for a land card and put it onto the battlefield.',
      match: (object) => object.types.includes('Land'),
      destination: 'battlefield',
      min: 1,
      max: 1,
      sacrificeLands: 1,
    }),
  ],
  Exsanguinate: [xMana(), onResolve(drainOpponentsX())],
  'Debt to the Deathless': [xMana(), onResolve(drainOpponentsX(2))],
  'Drain Life': [
    xMana('black'),
    targetOnResolve(
      'select',
      { zone: 'battlefield', types: ['Creature', 'Planeswalker'], players: 'any' },
      dealDamageTargetX(),
    ),
  ],
  'Repay in Kind': [onResolve(setAllLifeToLowest())],
  Necrologia: [payLifeX({ timing: 'yourEndStep' }), onResolve(drawX())],
  'Test of Endurance': [
    yourUpkeepIf(controllerLife(50), winGame()),
  ],
  'Starfield of Nyx': [
    staticGrant('starfieldOfNyx'),
    yourUpkeepTarget(
      { zone: 'graveyard', type: 'Enchantment', controller: 'you' },
      [returnTargetFromGraveyard('battlefield', false, true)],
    ),
  ],
  'Mister Negative': [
    entersTargetingOpponent(exchangeLifeWithOpponent({ optional: true, drawLifeLost: true })),
  ],
  'Mirror Universe': [
    ability({
      id: 'mirrorUniverse.exchange',
      targets: 'opponent',
      if: { kind: 'controllerUpkeep' },
    }, { tap: true, sacrifice: 'self' }, exchangeLifeWithOpponent()),
  ],
  'Wall of Blood': [
    ability({ id: 'wallOfBlood.pump' }, { life: 1 }, pumpSelf(1, 1)),
  ],
  'Selenia, Dark Angel': [
    ability({ id: 'selenia.return' }, { life: 2 }, bounceSelf()),
  ],
  'Children of Korlis': [
    ability(
      { id: 'childrenOfKorlis.recover' },
      { sacrifice: 'self' },
      gainLifeLostThisTurn(),
    ),
  ],
  'Tainted Sigil': [
    ability(
      { id: 'taintedSigil.recover' },
      { tap: true, sacrifice: 'self' },
      gainLifeLostThisTurn('all'),
    ),
  ],
  'Blood Celebrant': [
    ability(
      { id: 'bloodCelebrant.mana', manaAbility: true },
      { mana: '{B}', life: 1 },
      { kind: 'addChosenColorMana' },
    ),
  ],
  'Fell the Profane // Fell Mire': [
    tapUnlessPayLife(3),
    targetOnResolve(
      'destroy',
      { zone: 'battlefield', types: ['Creature', 'Planeswalker'] },
    ),
  ],
  'Hagra Mauling // Hagra Broodpit': [
    entersTapped(),
    targetOnResolve('destroy', { zone: 'battlefield', type: 'Creature' }),
  ],
  'Hermit Druid': [
    activate({
      id: 'hermitDruid.reveal',
      costs: { mana: '{G}', tap: true },
      do: [revealUntilBasicLand()],
    }),
  ],
  'Hedron Crab': [landfallTargeting('player', millTarget(3))],
  'Cling to Dust': [
    escape('{3}{B}', 5),
    targetOnResolve(
      'exile',
      { zone: 'graveyard' },
      ifTargetTypes(['Creature'], [gainLife(3)], [draw(1)]),
    ),
  ],
  'Frantic Search': [onResolve(draw(2), discardCards(2))],
  'Planar Genesis': [onResolve(lookTopPutLand(4, { orHand: true }))],
  "Animist's Awakening": [xMana(), onResolve(revealTopLandsTapped())],
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
  Colossification: [
    targetOnResolve('select', { zone: 'battlefield', type: 'Creature' }),
    enters(tapAttached(), pumpAttached(20, 20)),
  ],
  'Retreat to Hagra': [landfall(chooseModes('one', [
    {
      id: 'pump',
      label: 'Target creature gets +1/+0 and gains deathtouch until end of turn.',
      do: [pump(1, 0), grantUntilEot('deathtouch')],
    },
    {
      id: 'drain',
      label: 'Each opponent loses 1 life and you gain 1 life.',
      do: [opponentsLoseLife(1), gainLife(1)],
    },
  ]))],
  'Singularity Rupture': [
    onResolve(destroyAllCreatures(), millHalfTargetPlayers()),
    targetOnResolve('select', { players: 'any' }),
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
        do: [grantUntilEot('fear')],
      },
    ),
  ],
  'Will of the Sultai': [modalCommanderChooseBoth(
    {
      id: 'lands',
      label: 'Target player mills three cards. Return all land cards from your graveyard tapped.',
      do: [selfMill(3), returnOwnedGraveyardLands()],
    },
    {
      id: 'pump',
      label: 'Put X +1/+1 counters on target creature, where X is the number of lands you control. It gains trample.',
      do: [addPlusCountersEqualToLands(), pumpTargetEqualToLands(true)],
    },
  )],
  'Summon: Leviathan': [sagaChapters(
    {
      numbers: [1],
      do: [bounceCreaturesExcept('Kraken', 'Leviathan', 'Merfolk', 'Octopus', 'Serpent')],
    },
    { numbers: [2, 3], do: [] },
  )],
  'Summon: Titan': [sagaChapters(
    { numbers: [1], do: [selfMill(5)] },
    { numbers: [2], do: [returnOwnedGraveyardLands()] },
    { numbers: [3], do: [pumpTargetEqualToLands(true)] },
  )],
  'Horizon of Progress': [
    activate({
      id: 'horizon.putLand',
      costs: { mana: '{3}', tap: true },
      do: [putLandFromHand(true)],
    }),
    activate({
      id: 'horizon.draw',
      costs: { mana: '{1}', tap: true, sacrifice: 'self' },
      do: [draw(1)],
    }),
  ],
  'Khalni Ambush // Khalni Territory': [
    entersTapped(),
    targetOnResolveAt(0, 'select', {
      zone: 'battlefield',
      type: 'Creature',
      controller: 'you',
    }),
    targetOnResolveAt(
      1,
      'select',
      { zone: 'battlefield', type: 'Creature', controller: 'opponent' },
      fight('two-targets'),
    ),
  ],
  'Malakir Rebirth // Malakir Mire': [entersTapped()],
  'Pitiless Carnage': [onResolve(sacrificePermanentsThenDraw())],
  'Portal to Phyrexia': [
    enters(opponentsSacrifice('Creature', 3)),
    upkeep(reanimateCreatureFromGraveyards('Phyrexian')),
  ],
  Reprocess: [
    onResolve(sacrificePermanentsThenDraw(['Artifact', 'Creature', 'Land'])),
  ],
  'Rain of Filth': [
    onResolve(addUntilCleanupRule('sacrificeLandMana')),
  ],
  'Revitalizing Repast // Old-Growth Grove': [
    entersTapped(),
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature' },
      addPlusCountersInstruction(1),
      grantUntilEot('indestructible'),
    ),
  ],
  'Sink into Stupor // Soporific Springs': [
    tapUnlessPayLife(3),
    targetOnResolve(
      'bounce',
      { zones: ['stack', 'battlefield'], nonland: true, controller: 'opponent' },
    ),
  ],
  'Toxic Deluge': [payLifeX(), onResolve(pumpAllCreaturesByX())],
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
  'Yavimaya, Cradle of Growth': [staticGrant('forestOverlay')],
  'Zanarkand, Ancient Metropolis // Lasting Fayth': [
    entersTapped(),
    alternateCast('adventure', 'Lasting Fayth — {4}{G}{G}', '{4}{G}{G}', {
      fromZone: 'hand',
      exileAfterUse: true,
    }),
    onResolveIfCastOption('adventure', createHeroWithLandCounters()),
  ],
  'Aetherize': [onResolve(bounceAttacking())],
  "An Offer You Can't Refuse": [
    targetOnResolve(
      'counter',
      { zone: 'stack', noncreature: true },
      createTreasures(2, 'targetController'),
    ),
  ],
  'Apex Altisaur': [enters(fightUpToOne())],
  'Beast Whisperer': [casts(draw(1), { creatureOnly: true })],
  'Botanical Sanctum': [entersTapped(otherLands({ min: 3 }))],
  'Bushwhack': [modalChooseOne(
    {
      id: 'land',
      label: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
      do: [searchLibrary({
        prompt: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
        match: basicLand,
        destination: 'hand',
        min: 1,
        max: 1,
        reveal: true,
      })],
    },
    {
      id: 'fight',
      label: 'Target creature you control fights target creature you don\'t control.',
      do: [fightOwnedVsOpponent()],
    },
  )],
  'Braids, Conjurer Adept': [upkeep(putFromHand('active', { types: ['Artifact', 'Creature', 'Land'] }))],
  'Castle Garenbrig': [entersTapped(lacksControlledSubtype('Forest'))],
  'Cavern of Souls': [
    enters(chooseCreatureType('setChosenType')),
    restrictedCreatureMana(),
  ],
  'Charcoal Diamond': [entersTapped()],
  "Commander's Sphere": [
    ability(
      { id: 'commandersSphere.draw' },
      { sacrifice: 'self' },
      draw(1),
    ),
  ],
  'Choked Estuary': [tapUnlessRevealSubtype('Island', 'Swamp')],
  'Círdan the Shipwright': [enters(secretCouncil()), attacks(secretCouncil())],
  'Concordant Crossroads': [staticGrant('sharedHaste'), handler('sharedHaste')],
  'Courser of Kruphix': [
    staticRevealLibraryTop(),
    staticPlayLandsFromLibraryTop(),
    handler('courserOfKruphix'),
    landfall(gainLife(1)),
  ],
  'Cultivate': [searchSpell(splitBasicLandSearch())],
  Cloudshift: [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', controller: 'you' },
      blink({ returnController: 'controller' }),
    ),
  ],
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
  'End-Raze Forerunners': [
    enters(
      pumpControlled(2, 2, { trample: true, other: true }),
      { kind: 'grantControlled', keywords: ['Vigilance', 'Trample'], other: true },
    ),
  ],
  'Eternal Witness': [targetOnResolve('bounce', { zone: 'graveyard' })],
  'Eureka': [onResolve(putFromHand('each', { repeat: true }))],
  'Farhaven Elf': [{
    op: 'search',
    via: 'enters',
    spec: optionalBasicLandEnters(),
  }],
  'Hinterland Harbor': [entersTapped(lacksControlledSubtype('Forest', 'Island'))],
  'Hypergenesis': [onResolve(putFromHand('each', {
    types: ['Artifact', 'Creature', 'Enchantment', 'Land'],
    repeat: true,
  }))],
  'Illusion of Choice': [onResolve(chooseVotesThisTurn(), draw(1))],
  "Kodama's Reach": [searchSpell(splitBasicLandSearch())],
  'Kogla, the Titan Ape': [enters(fightUpToOne())],
  'Overwhelming Stampede': [
    onResolve(pumpControlled(0, 0, { trample: true, powerFromGreatest: true })),
  ],
  'Pathbreaker Ibex': [
    attacks(pumpControlled(0, 0, { trample: true, powerFromGreatest: true })),
  ],
  'Reins of Power': [onResolve(exchangeControlUntilEot()), handler('reinsOfPower')],
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
  'Rejuvenating Springs': [entersTapped(opponentsAtMost(1))],
  'Reliquary Tower': [staticGrant('noMaxHand'), handler('noMaxHand')],
  'Sakura-Tribe Elder': [
    searchAbility({
      prompt: 'Search your library for a basic land card. It enters tapped.',
      match: basicLand,
      destination: 'battlefield',
      tapped: true,
      min: 1,
      max: 1,
    }, { sacrifice: 'self' }),
  ],
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
  'Show and Tell': [onResolve(putFromHand('each', {
    types: ['Artifact', 'Creature', 'Enchantment', 'Land'],
  }))],
  'Thorn Mammoth': [enters(fightUpToOne())],
  'Twincast': [
    targetOnResolve('copy', { zone: 'stack', types: ['Instant', 'Sorcery'] }),
  ],
  'Triangle of War': [
    activate({
      id: 'fight.triangle',
      costs: { mana: '{2}', sacrifice: 'self' },
      do: [fight('two-targets')],
    }),
  ],
  'Ulvenwald Tracker': [
    activate({
      id: 'fight.tracker',
      costs: { mana: '{1}{G}', tap: true },
      do: [fight('two-targets')],
    }),
  ],
  'Aftermath Analyst': [
    activate({
      id: 'graveyardLands.aftermath',
      costs: { mana: '{3}{G}', sacrifice: 'self' },
      do: [returnOwnedGraveyardLands()],
    }),
  ],
  'Astral Drift': [
    triggerOn('cycle', { do: [astralDriftCycleBlink] }),
    cycleHand('cycling.astralDrift', '{2}{W}'),
  ],
  'Aesi, Tyrant of Gyre Strait': [staticExtraLandPlays(1), landfall(draw(1))],
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
  'Buried Alive': [
    searchSpell({
      prompt: 'Search your library for up to three creature cards and put them into your graveyard.',
      match: (object) => object.types.includes('Creature'),
      destination: 'graveyard',
      min: 0,
      max: 3,
    }),
  ],
  'Blighted Woodland': [
    fetchBasic('Search your library for up to two basic land cards. They enter tapped.', {
      tapped: true,
      min: 0,
      max: 2,
      manaCost: '{3}{G}',
    }),
  ],
  'Brokers Hideout': [
    fetchHideout(
      'Search your library for a basic Forest, Plains, or Island card. It enters tapped.',
      ['Forest', 'Plains', 'Island'],
    ),
  ],
  'Dakmor Salvage': [dredge(2), entersTapped()],
  'Dimir Aqueduct': [entersTapped(), enters(bounceChosenLand())],
  'Drowned Catacomb': [entersTapped(lacksControlledSubtype('Island', 'Swamp'))],
  Deathsprout: [
    targetOnResolve('destroy', { zone: 'battlefield', type: 'Creature' }),
    searchSpell({
      prompt: 'Search your library for a basic land card. It enters tapped.',
      match: basicLand,
      destination: 'battlefield',
      tapped: true,
      min: 0,
      max: 1,
    }),
  ],
  Entomb: [
    searchSpell({
      prompt: 'Search your library for a card and put it into your graveyard.',
      match: () => true,
      destination: 'graveyard',
      min: 1,
      max: 1,
    }),
  ],
  'Evolving Wilds': [
    fetchBasic('Search your library for a basic land card. It enters tapped.', { tapped: true }),
  ],
  Explore: [onResolve(extraLandPlays(1), draw(1))],
  Farseek: [
    searchSpell({
      prompt: 'Search your library for a Plains, Island, Swamp, or Mountain card. It enters tapped.',
      match: hasSubtype('Plains', 'Island', 'Swamp', 'Mountain'),
      destination: 'battlefield',
      tapped: true,
      min: 1,
      max: 1,
    }),
  ],
  'Fabled Passage': [
    fetchBasic(
      'Search your library for a basic land card. It enters tapped, then untaps if you control four or more lands.',
      { tapped: true, untapWithFourLands: true },
    ),
  ],
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
  'Eclipsed Steppe': [entersTapped(controlledBasicLands({ max: 1 }))],
  'Glacial Fortress': [entersTapped(lacksControlledSubtype('Plains', 'Island'))],
  'Godless Shrine': [tapUnlessPayLife(2)],
  'Ghost Town': [
    activate({
      id: 'selfBounceLand.ghostTown',
      costs: {},
      if: { kind: 'notActivePlayer' },
      do: [bounceSelf()],
    }),
  ],
  'Golgari Rot Farm': [entersTapped(), enters(bounceChosenLand())],
  'Hall of Storm Giants': [
    entersTapped(otherLands({ min: 2 })),
    activate({
      id: 'hall.animate',
      costs: { mana: '{6}{U}' },
      if: graveyardCards(7),
      do: [animateUntilEot(7, 7)],
    }),
  ],
  'Hedge Maze': [entersTapped(), enters(surveil(1))],
  'Hallowed Fountain': [tapUnlessPayLife(2)],
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
      { id: 'endlessSands.return', sorcery: true },
      { mana: '{4}', tap: true, sacrifice: 'self' },
      returnLinkedExile(),
    ),
  ],
  'Everflowing Chalice': [
    multikicker('{2}'),
    enters(putChargeCountersFromTimesKicked()),
  ],
  'Geier Reach Sanitarium': [
    ability(
      { id: 'geierReach.tableLoot' },
      { mana: '{2}', tap: true },
      eachPlayerDraw(1),
      eachPlayerDiscard(1),
    ),
  ],
  'Gilded Lotus': [
    activate({
      id: 'gildedLotus.mana',
      manaAbility: true,
      costs: { tap: true },
      do: [
        { kind: 'addChosenColorMana' },
        { kind: 'addChosenColorMana' },
        { kind: 'addChosenColorMana' },
      ],
    }),
  ],
  'Hedron Archive': [
    ability(
      { id: 'hedronArchive.draw' },
      { mana: '{2}', tap: true, sacrifice: 'self' },
      draw(2),
    ),
  ],
  'High Market': [
    ability(
      { id: 'highMarket.gain' },
      { tap: true, sacrificeTarget: 'creature' },
      gainLife(1),
    ),
  ],
  'Homer, the Hermit': [handler('homer')],
  'Icetill Explorer': [
    staticExtraLandPlays(1),
    playLandsFromGraveyard(),
    landfall(selfMill(1)),
  ],
  'Joint Exploration': [onResolve(draw(1)), handler('jointExploration')],
  'Keep Safe': [
    targetOnResolve(
      'counter',
      { zone: 'stack', spellTargetsControlledPermanent: true },
      draw(1),
    ),
  ],
  'Lair of the Hydra': [
    entersTapped(otherLands({ min: 2 })),
    activate({
      id: 'lair.animate',
      costs: { mana: '{X}{G}', xMana: true },
      do: [animateUntilEot(0, 0, { fromX: true })],
    }),
  ],
  'Lightning Bolt': [onResolve(dealDamageToChosenTarget(3))],
  'Lotus Field': [entersTapped(), enters(sacrificeControlled(2, ['Land']))],
  Millikin: [
    activate({
      id: 'selfMill.millikin',
      manaAbility: true,
      costs: { tap: true, mill: 1 },
      do: [{ kind: 'addMana', mana: { C: 1 } }],
    }),
  ],
  'Misty Rainforest': [
    fetchTypes('Search your library for a Forest or Island card and put it onto the battlefield.', [
      'Forest',
      'Island',
    ]),
  ],
  'Mind Stone': [
    ability(
      { id: 'mindStone.draw' },
      { mana: '{1}', tap: true, sacrifice: 'self' },
      draw(1),
    ),
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
  'Mole Man, Moloid Master': [
    landfall(createTokenInstruction({
      name: 'Moloid',
      types: ['Creature'],
      subtypes: ['Minion'],
      power: 1,
      toughness: 1,
      oracleText: 'Whenever this token attacks, you may mill a card.',
    })),
  ],
  'Mossborn Hydra': [landfall(doublePlusCounters()), handler('mossborn-hydra')],
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
  'Mistvault Bridge': [entersTapped()],
  'Morphic Pool': [entersTapped(opponentsAtMost(1))],
  'Orzhov Basilica': [entersTapped(), enters(bounceChosenLand())],
  "Nature's Lore": [
    searchSpell({
      prompt: 'Search your library for a Forest card and put it onto the battlefield.',
      match: hasSubtype('Forest'),
      destination: 'battlefield',
      min: 1,
      max: 1,
    }),
  ],
  'Obscura Storefront': [
    fetchHideout(
      'Search your library for a basic Plains, Island, or Swamp card. It enters tapped.',
      ['Plains', 'Island', 'Swamp'],
    ),
  ],
  'Oboro, Palace in the Clouds': [
    activate({
      id: 'selfBounceLand.oboro',
      costs: { mana: '{1}' },
      do: [bounceSelf()],
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
  'Pit of Offerings': [entersTapped(), handler('pit-of-offerings')],
  'Polluted Delta': [
    fetchTypes('Search your library for an Island or Swamp card and put it onto the battlefield.', [
      'Island',
      'Swamp',
    ]),
  ],
  'Prismatic Vista': [
    fetchBasic('Search your library for a basic land card and put it onto the battlefield.', {
      life: 1,
    }),
  ],
  'Riveteers Overlook': [
    fetchHideout(
      'Search your library for a basic Swamp, Mountain, or Forest card. It enters tapped.',
      ['Swamp', 'Mountain', 'Forest'],
    ),
  ],
  'Sandstone Oracle': [entersTargetingOpponent(drawHandDifference())],
  'Scute Swarm': [
    landfall(branch(controlledLands({ min: 6 }), [copySelf()], [insect])),
  ],
  'Secluded Steppe': [
    entersTapped(),
    typecycleHand('cycling.secludedSteppe', '{W}', 'Plains'),
  ],
  'Shadowy Backstreet': [entersTapped(), enters(surveil(1))],
  'Simic Growth Chamber': [entersTapped(), enters(bounceChosenLand())],
  'Sky Diamond': [entersTapped()],
  "Sin, Spira's Punishment": [
    enters(specificSinSpiraPunishmentTriggeredAbility()),
    attacks(specificSinSpiraPunishmentTriggeredAbility()),
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
  'Subjugator Angel': [
    enters(tapAll({ zone: 'battlefield', type: 'Creature', controller: 'opponent' })),
  ],
  'Skull Prophet': [
    activate({
      id: 'selfMill.skullProphet',
      costs: { tap: true, mill: 2 },
      do: [],
    }),
  ],
  'Splendid Reclamation': [onResolve(returnOwnedGraveyardLands())],
  "Stitcher's Supplier": [enters(selfMill(3)), dies(selfMill(3))],
  'Summer Bloom': [onResolve(extraLandPlays(3))],
  'Terramorphic Expanse': [
    fetchBasic('Search your library for a basic land card. It enters tapped.', { tapped: true }),
  ],
  'Temple of the False God': [manaIf(controlledLands({ min: 5 }))],
  'Temple of Deceit': [entersTapped(), enters(scry(1))],
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
  'Thawing Glaciers': [
    entersTapped(),
    searchAbility({
      prompt: 'Search your library for a basic land card. It enters tapped.',
      match: basicLand,
      destination: 'battlefield',
      tapped: true,
      min: 1,
      max: 1,
    }, { tap: true, mana: '{1}' }),
  ],
  'Teferi, Who Slows the Sunset': [
    ability({
      id: 'teferi.plus-one',
      targets: 'teferiSunsetPlusOne',
    }, loyalty(1), teferiSunsetPlusOne()),
    ability({
      id: 'teferi.minus-two',
    }, loyalty(-2), lookTopChooseOne(3)),
    ability({
      id: 'teferi.minus-seven',
    }, loyalty(-7), teferiSunsetEmblem()),
    handler('teferiSunset'),
  ],
  "Thalia's Lancers": [
    enters(searchLibrary({
      prompt: 'Search your library for a legendary card, reveal it, put it into your hand, then shuffle.',
      match: (object) => object.supertypes.includes('Legendary'),
      destination: 'hand',
      min: 0,
      max: 1,
      reveal: true,
    })),
  ],
  'Three Visits': [
    searchSpell({
      prompt: 'Search your library for a Forest card and put it onto the battlefield.',
      match: hasSubtype('Forest'),
      destination: 'battlefield',
      min: 1,
      max: 1,
    }),
  ],
  'Undercity Sewers': [entersTapped(), enters(surveil(1))],
  'Underground Mortuary': [entersTapped(), enters(surveil(1))],
  'Sunken Hollow': [entersTapped(controlledBasicLands({ max: 1 }))],
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
  'Unmarked Grave': [
    searchSpell({
      prompt: 'Search your library for a nonlegendary card and put it into your graveyard.',
      match: (object) => !object.supertypes.includes('Legendary'),
      destination: 'graveyard',
      min: 1,
      max: 1,
    }),
  ],
  'Verdant Catacombs': [
    fetchTypes('Search your library for a Swamp or Forest card and put it onto the battlefield.', [
      'Swamp',
      'Forest',
    ]),
  ],
  Windfall: [onResolve(discardHandsThenDrawGreatest())],
  'Ancient Greenwarden': [playLandsFromGraveyard(), extraLandfall(1)],
  'Arcane Denial': [
    targetOnResolve('counter', { zone: 'stack' }, drawAtNextUpkeep(1), drawAtNextUpkeep(2, 'targetController', true)),
  ],
  'Awaken the Honored Dead': [
    enters(selfMill(3)),
  ],
  'Awaken the Woods': [onResolve(createXTokens({
    name: 'Forest Dryad',
    types: ['Land', 'Creature'],
    subtypes: ['Forest', 'Dryad'],
    power: 1,
    toughness: 1,
  }))],
  'Bala Ged Recovery': [
    targetOnResolve('bounce', { zone: 'graveyard' }),
  ],
  'Bala Ged Sanctuary': [entersTapped()],
  'Black Sun\'s Twilight': [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature' },
      pumpTargetX(-1),
      returnCreatureManaValueX(5, true),
    ),
  ],
  'Blossoming Tortoise': [
    enters(selfMill(3), returnChosenLandFromGraveyard()),
    attacks(selfMill(3), returnChosenLandFromGraveyard()),
  ],
  'Breeding Pool': [tapUnlessPayLife(2)],
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
      do: [draw(3)],
    }),
  ],
  'Crawling Sensation': [
    yourUpkeep(optionalMill(2)),
    landToGraveyardOnce(insect),
  ],
  'Dismember': [
    targetOnResolve('select', { zone: 'battlefield', type: 'Creature' }, pump(-5, -5)),
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
  'Dreamscape Artist': [
    searchAbility({
      prompt: 'Search your library for up to two basic land cards.',
      match: basicLand,
      destination: 'battlefield',
      min: 0,
      max: 2,
    }, { mana: '{2}{U}', tap: true, discard: 'any', sacrificeTarget: 'land' }),
  ],
  'Entish Restoration': [
    searchSpell({
      prompt: 'Search your library for basic land cards. They enter tapped.',
      match: basicLand,
      destination: 'battlefield',
      tapped: true,
      min: 0,
      max: 2,
      sacrificeLands: 1,
      empoweredMax: 3,
      empoweredIf: controlledCreaturePower(4),
    }),
  ],
  'Fact or Fiction': [onResolve(revealPick(5, { permanent: true }))],
  'Fell Mire': [entersTapped()],
  'Felidar Guardian': [
    enters(
      blink({
        optional: true,
        filter: {
          controller: 'you',
          other: true,
          permanent: true,
        },
        returnController: 'owner',
        prompt: 'You may exile another target permanent you control, then return it under its owner\'s control.',
      }),
    ),
  ],
  'Flicker of Fate': [
    targetOnResolve(
      'select',
      { zone: 'battlefield', types: ['Creature', 'Enchantment'] },
      blink({ returnController: 'owner' }),
    ),
  ],
  Flickerwisp: [
    entersTarget(
      { zone: 'battlefield', other: true },
      blink({ when: 'nextEndStep', returnController: 'owner' }),
    ),
  ],
  'Fell the Profane': [
    targetOnResolve(
      'destroy',
      { zone: 'battlefield', types: ['Creature', 'Planeswalker'] },
      loseLifeTargetController(2),
    ),
  ],
  'Firdoch Core': [
    allCreatureTypes(),
    activate({
      id: 'animate.firdochCore',
      costs: { mana: '{4}' },
      do: [animateUntilEot(4, 4)],
    }),
  ],
  "Fortune's Favor": [onResolve(revealPick(4))],
  'Growth Spiral': [onResolve(draw(1), putLandFromHand())],
  Harrow: [
    searchSpell({
      prompt: 'Search your library for up to two basic land cards.',
      match: basicLand,
      destination: 'battlefield',
      min: 0,
      max: 2,
      sacrificeLands: 1,
    }),
  ],
  'Hedge Shredder': [
    attacks(optionalMill(2)),
    landToGraveyard(putMilledLandTapped()),
    crew(1),
  ],
  "Irenicus's Vile Duplication": [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', controller: 'you' },
      copyTargetCreature({ notLegendary: true, flying: true }),
    ),
  ],
  'Join the Dead': [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature' },
      branch(graveyardPermanentCards(4), [pump(-10, -10)], [pump(-5, -5)]),
    ),
  ],
  'Kindred Dominance': [onResolve(chooseCreatureType('destroyOthers'))],
  'Life from the Loam': [
    dredge(3),
    onResolve(returnChosenLandFromGraveyard(false, { count: 3, min: 0, to: 'hand' })),
  ],
  'Lumra, Bellow of the Woods': [
    enters(selfMill(4), returnOwnedGraveyardLands()),
  ],
  'Malakir Mire': [entersTapped()],
  'Malakir Rebirth': [onResolve(grantUntilEot('indestructible'))],
  'Malevolent Rumble': [onResolve(revealPick(4, { permanent: true }), eldraziSpawn)],
  'Marina Vendrell': [
    enters(revealMatchingToHand(7, 'Enchantment')),
    activate({
      id: 'marina.lockOrUnlock',
      costs: { tap: true },
      targets: 'room',
      sorcery: true,
      do: [lockOrUnlockDoor()],
    }),
  ],
  'Masked Vandal': [allCreatureTypes()],
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
  'Nanogene Conversion': [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', controller: 'you' },
      copyAllCreaturesUntilEot(),
    ),
  ],
  'Overgrown Tomb': [tapUnlessPayLife(2)],
  'Pile On': [
    convoke(),
    targetOnResolve('destroy', { zone: 'battlefield', types: ['Creature', 'Planeswalker'] }, surveil(2)),
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
  'Raise the Palisade': [onResolve(chooseCreatureType('bounceOthers'))],
  'Reanimate': [
    targetOnResolve(
      'reanimate',
      { zone: 'graveyard', type: 'Creature' },
      loseLifeTargetManaValue(),
    ),
  ],
  'Ripples of Undeath': [enters(selfMill(3))],
  'Roaming Throne': [enters(chooseCreatureType('addToSource'))],
  'Sakashima of a Thousand Faces': [
    legendRuleOff(),
    enters(copyControlledCreature({ keepName: true })),
  ],
  'Sakura-Tribe Scout': [
    activate({
      id: 'putLand.sakura',
      costs: { tap: true },
      do: [putLandFromHand()],
    }),
  ],
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
  Six: [
    attacks(selfMill(3), revealPick(3, { type: 'Land' })),
    grantRetrace(),
  ],
  'Spark Double': [enters(copyControlledCreature({ notLegendary: true, plusCounters: 1 }))],
  'Springheart Nantuko': [
    bestow('{1}{G}', { power: 1, toughness: 1 }),
    landfall(attachedCopyOrToken('{1}{G}', insectToken)),
  ],
  'Stitch Together': [
    targetOnResolve(
      'select',
      { zone: 'graveyard', type: 'Creature' },
      branch(
        graveyardCards(7),
        [returnTargetFromGraveyard('battlefield')],
        [returnTargetFromGraveyard('hand')],
      ),
    ),
  ],
  "Liliana's Caress": [
    triggerOn('discard', {
      if: { seat: 'opponent' },
      do: [loseLife(2, 'triggeringPlayer')],
    }),
  ],
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
  'Sygg, River Cutthroat': [
    triggerOn('end', {
      if: opponentLostLifeThisTurn(3),
      do: [mayDraw(1)],
    }),
  ],
  "Tamiyo's Safekeeping": [
    targetOnResolve(
      'select',
      { zone: 'battlefield', controller: 'you' },
      grantUntilEot('hexproof', 'indestructible'),
      gainLife(2),
    ),
  ],
  'Tear Asunder': [
    kicker('{1}{B}'),
    targetOnResolveKicked(
      'exile',
      { zone: 'battlefield', types: ['Artifact', 'Enchantment'] },
      { zone: 'battlefield', nonland: true },
    ),
  ],
  'Trade Routes': [
    activate({
      id: 'tradeRoutes.bounce',
      costs: { mana: '{1}' },
      do: [bounceChosenLand()],
    }),
    activate({
      id: 'tradeRoutes.draw',
      costs: { mana: '{1}', discard: 'land' },
      do: [draw(1)],
    }),
  ],
  'Victimize': [
    targetOnResolve('reanimate', { zone: 'graveyard', type: 'Creature' }),
  ],
  'Virtue of Knowledge': [extraEnters(1), extraLandfall(1)],
  'Vantress Visions': [onResolve(copyTargetCreature())],
  'Walk-In Closet': [playLandsFromGraveyard()],
  "Thrór's Map": [
    {
      op: 'search',
      via: 'enters',
      spec: {
        prompt: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
        match: basicLand,
        destination: 'hand',
        min: 1,
        max: 1,
        reveal: true,
      },
    },
    ability(
      { id: 'throrsMap.loot' },
      { mana: '{2}', tap: true },
      draw(1),
      discardCards(1),
    ),
  ],
  "Urza's Cave": [
    searchAbility({
      prompt: 'Search your library for a land card, put it onto the battlefield tapped, then shuffle.',
      match: (object) => object.types.includes('Land'),
      destination: 'battlefield',
      tapped: true,
      min: 1,
      max: 1,
    }, { mana: '{3}', tap: true, sacrifice: 'self' }),
  ],
  'World Map': [
    searchAbility({
      prompt: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
      match: basicLand,
      destination: 'hand',
      min: 1,
      max: 1,
      reveal: true,
    }, { mana: '{1}', tap: true, sacrifice: 'self' }),
    searchAbility({
      prompt: 'Search your library for a land card, reveal it, put it into your hand, then shuffle.',
      match: (object) => object.types.includes('Land'),
      destination: 'hand',
      min: 1,
      max: 1,
      reveal: true,
    }, { mana: '{3}', tap: true, sacrifice: 'self' }),
  ],
  'Worn Powerstone': [entersTapped()],
  'Forgotten Cellar': [playLandsFromGraveyard()],
  'Wash Away': [
    cleave('{1}{U}{U}'),
    targetOnResolve('counter', {
      zone: 'stack',
      bracketed: { castFromNot: 'hand' },
    }),
  ],
  'Watery Grave': [tapUnlessPayLife(2)],
  'World Shaper': [
    attacks(optionalMill(3)),
    dies(returnOwnedGraveyardLands()),
  ],
  'Yarok, the Desecrated': [extraEnters(1), extraLandfall(1)],
  'Zimone and Dina': [
    activate({
      id: 'zimone.draw',
      costs: { tap: true, sacrificeTarget: 'creature', sacrificeOther: true },
      do: [draw(1), putLandFromHand(true)],
    }),
  ],
  'Incarnation Technique': [
    onResolve(selfMill(5), reanimateCreatureFromGraveyards()),
    handler('demonstrate'),
  ],
  'Yurlok of Scorch Thrash': [
    staticGrant('manaBurn'),
    activate({
      id: 'yurlok.mana-rain',
      manaAbility: true,
      costs: { tap: true, mana: '{1}' },
      do: [{ kind: 'addManaToEachPlayer', mana: { B: 1, R: 1, G: 1 } }],
    }),
  ],
  'Zagoth Triome': [
    entersTapped(),
    cycleFromHand('cycling.zagothTriome'),
  ],
  Absorb: [
    targetOnResolve('counter', { zone: 'stack' }, gainLife(3)),
  ],
  'Archangel of Tithes': [
    attackTax(1, { whileUntapped: true }),
    blockTax(1, { whileAttacking: true }),
  ],
  'Batwing Brume': [handler('combatPreventionCards')],
  'Anguished Unmaking': [
    targetOnResolve(
      'exile',
      { zone: 'battlefield', nonland: true },
      loseLife(3, 'controller'),
    ),
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
  'Beza, the Bounding Spring': [
    enters(
      branch(opponentHasMore('lands'), [createTreasures(1, 'you')]),
      branch(opponentHasMore('life'), [gainLife(4)]),
      branch(opponentHasMore('creatures'), [fish, fish]),
      branch(opponentHasMore('cardsInHand'), [draw(1)]),
    ),
  ],
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
  'Collector\'s Vault': [lootAndTreasure('collectorsVault.loot')],
  'Daily Bugle Newspaper': [lootAndTreasure('dailyBugle.loot')],
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
  'Bender\'s Waterskin': [staticGrant('extraUntap')],
  'Baird, Steward of Argive': [attackTax(1)],
  'Blanket of Night': [staticGrant('swampOverlay')],
  'Bubbling Muck': [onResolve(addUntilCleanupRule('extraSwampMana', { each: true }))],
  'Cabal Coffers': [coffersMana('coffers.cabal', '{2}')],
  'Cabal Stronghold': [coffersMana('coffers.stronghold', '{3}', true)],
  'Crypt Ghast': [staticGrant('extraSwampMana'), handler('extort')],
  Comeuppance: [handler('combatPreventionCards')],
  Darkness: [onResolve(preventCombatDamage())],
  'Dark Confidant': [yourUpkeep(revealDrawLoseLife())],
  'Dark Tutelage': [yourUpkeep(revealDrawLoseLife())],
  Ephemerate: [handler('blinkValue')],
  'Deserted Temple': [
    activate({
      id: 'desertedTemple.untap',
      costs: { mana: '{1}', tap: true },
      targets: 'land',
      do: [untapTarget()],
    }),
  ],
  'Dimir Signet': [signet('signet.dimir', { U: 1, B: 1 })],
  "Dovin's Veto": [
    uncounterable(),
    targetOnResolve('counter', { zone: 'stack', noncreature: true }),
  ],
  'Esper Panorama': [
    searchAbility({
      prompt: 'Search your library for a basic Plains, Island, or Swamp card. It enters tapped.',
      match: (object) =>
        basicLand(object) && hasSubtype('Plains', 'Island', 'Swamp')(object),
      destination: 'battlefield',
      tapped: true,
      min: 0,
      max: 1,
    }, { mana: '{1}', tap: true, sacrifice: 'self' }),
  ],
  'Exotic Orchard': [manaFrom('opponentsLands')],
  'Energy Arc': [handler('combatPreventionCards')],
  'Everybody Lives!': [handler('combatPreventionCards')],
  'Expedition Map': [
    searchAbility({
      prompt: 'Search your library for a land card, reveal it, put it into your hand, then shuffle.',
      match: (object) => object.types.includes('Land'),
      destination: 'hand',
      min: 1,
      max: 1,
      reveal: true,
    }, { mana: '{2}', tap: true, sacrifice: 'self' }),
  ],
  'Ghostly Flicker': [handler('blinkValue')],
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
  'Guardian of Ghirapur': [
    enters(
      blink({
        optional: true,
        filter: {
          controller: 'you',
          types: ['Creature', 'Artifact'],
          other: true,
        },
        when: 'nextEndStep',
        returnController: 'owner',
        prompt: 'You may exile another target creature or artifact you control, then return it at the next end step.',
      }),
    ),
  ],
  'Kami of False Hope': [
    activate({
      id: 'kami.fog',
      costs: { sacrifice: 'self' },
      do: [preventCombatDamage()],
    }),
  ],
  Inkshield: [handler('combatPreventionCards')],
  'Lady Evangela': [
    ability({
      id: 'ladyEvangela.fog',
      targets: 'creature',
    }, { mana: '{W}{B}', tap: true }, preventCombatDamage({ from: 'target' })),
  ],
  'Long Road Home': [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature' },
      blink({ when: 'nextEndStep', plusCounters: 1, returnController: 'owner' }),
    ),
  ],
  'Loran of the Third Path': [handler('blinkValue')],
  'Lotho, Corrupt Shirriff': [handler('blinkValue')],
  'Rings of Brighthearth': [handler('stackCopy')],
  "Council's Judgment": [
    councilVote(
      'Vote for a nonland permanent you do not control.',
      { zone: 'battlefield', nonland: true, controller: 'opponent' },
    ),
  ],
  'Fractured Identity': [
    targetOnResolve(
      'exile',
      { zone: 'battlefield', nonland: true },
      copyTargetForEachOtherPlayer(),
    ),
  ],
  Mirrorweave: [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', nonlegendary: true },
      copyAllCreaturesUntilEot(false),
    ),
  ],
  'Standard Bearer': [targetingRequirement('flagbearer')],
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
  'Tenuous Truce': [playerAuraDeal()],
  'Magus of the Coffers': [coffersMana('coffers.magus', '{2}')],
  'Marsh Flats': [
    fetchTypes('Search your library for a Plains or Swamp card and put it onto the battlefield.', [
      'Plains',
      'Swamp',
    ]),
  ],
  Mulldrifter: [
    alternateCast('evoke', 'Evoke {2}{U}', '{2}{U}'),
    entersIfCastOption('evoke', { kind: 'sacrificeSelf' }),
    enters(draw(2)),
  ],
  'Nirkana Revenant': [
    staticGrant('extraSwampMana'),
    activate({
      id: 'nirkanaRevenant.pump',
      costs: { mana: '{B}' },
      do: [pumpSelf(1, 1)],
    }),
  ],
  'Orzhov Signet': [signet('signet.orzhov', { W: 1, B: 1 })],
  'Queza, Augur of Agonies': [handler('blinkValue')],
  'Otherworldly Journey': [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature' },
      blink({ when: 'nextEndStep', plusCounters: 1, returnController: 'owner' }),
    ),
  ],
  'Reflecting Pool': [manaFrom('controlledLands')],
  'Restoration Angel': [
    enters(
      blink({
        optional: true,
        filter: {
          controller: 'you',
          type: 'Creature',
          excludeSubtypes: ['Angel'],
        },
        returnController: 'controller',
        prompt: 'You may exile target non-Angel creature you control, then return it under your control.',
      }),
    ),
  ],
  "Raffine's Tower": [entersTapped(), cycleFromHand('cycling.raffinesTower')],
  'Snuff Out': [
    alternateCast('pay-4-life', 'Pay 4 life', '', {
      life: 4,
      controlledSubtype: 'Swamp',
    }),
    targetOnResolve('destroy', { zone: 'battlefield', type: 'Creature', nonblack: true }),
  ],
  'Phial of Galadriel': [staticGrant('phialReplacement')],
  'Swan Song': [
    targetOnResolve(
      'counter',
      { zone: 'stack', types: ['Enchantment', 'Instant', 'Sorcery'] },
      bird,
    ),
  ],
  'Swords to Plowshares': [
    targetOnResolve(
      'exile',
      { zone: 'battlefield', type: 'Creature' },
      gainLifeTargetPower(),
    ),
  ],
  'Settle the Wreckage': [handler('combatPreventionCards')],
  'Urborg, Tomb of Yawgmoth': [staticGrant('swampOverlay')],
  'Wall of Shards': [yourUpkeep(cumulativeUpkeepOpponentLife())],
  'Vanish into Memory': [handler('blinkValue')],
  'Voyager Staff': [
    activate({
      id: 'voyagerStaff.blink',
      costs: { mana: '{2}', tap: true, sacrifice: 'self' },
      targets: {
        filter: {
          controller: 'you',
          types: ['Artifact', 'Creature', 'Land'],
          other: true,
        },
      },
      do: [blink({ when: 'nextEndStep', returnController: 'owner' })],
    }),
  ],
  'Angel of Sanctions': [
    handler('linkedExile'),
    linkedExileUntilLeaves(),
    embalm('{5}{W}', { colors: ['W'], extraSubtypes: ['Zombie'] }),
    enters(linkExile({ nonland: true, controller: 'opponent' }, { optional: true })),
  ],
  'Banisher Priest': [
    handler('linkedExile'),
    linkedExileUntilLeaves(),
    enters(linkExile({ type: 'Creature', controller: 'opponent' })),
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
  'Fiend Hunter': [
    handler('linkedExile'),
    linkedExileUntilLeaves(),
    enters(linkExile({ type: 'Creature', other: true }, { optional: true })),
  ],
  'Glorious Protector': [
    handler('linkedExile'),
    linkedExileUntilLeaves(),
    enters(linkExile(
      { type: 'Creature', other: true, excludeSubtypes: ['Angel'] },
      { controlled: true, optional: true },
    )),
  ],
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
  'Palace Jailer': [
    enters(
      becomeMonarch(),
      exileUntilOpponentBecomesMonarch({ type: 'Creature', controller: 'opponent' }),
    ),
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
  'Alabaster Host Intercessor': [
    linkedExileUntilLeaves(),
    enters(linkExile({ type: 'Creature', controller: 'opponent' })),
    typecycleHand('plainscycling.alabasterHostIntercessor', '{2}', 'Plains'),
  ],
  'Curious Colossus': [enters(loseAbilitiesBecome('Coward', 1, 1))],
  'Githzerai Monk': [
    enters(tapAll({ zone: 'battlefield', type: 'Creature', controller: 'notController' })),
  ],
  'Meteor Golem': [
    targetOnResolve('destroy', { zone: 'battlefield', nonland: true, controller: 'opponent' }),
  ],
  Counterspell: [targetOnResolve('counter', { zone: 'stack' })],
  'Arcanis the Omnipotent': [
    activate({
      id: 'arcanis.draw',
      costs: { tap: true },
      do: [draw(3)],
    }),
    activate({
      id: 'arcanis.bounce',
      costs: { mana: '{2}{U}{U}' },
      do: [bounceSelf()],
    }),
  ],
  "Minamo, School at Water's Edge": [
    activate({
      id: 'minamo.untap',
      costs: { mana: '{U}', tap: true },
      targets: 'legendary',
      do: [untapTarget()],
    }),
  ],
  Condemn: [
    targetOnResolve(
      'libraryBottom',
      { zone: 'battlefield', type: 'Creature', attacking: true },
      gainLifeTargetToughness(),
    ),
  ],
  Hatred: [
    payLifeX(),
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature' },
      pumpTargetX(1, 0),
    ),
  ],
  'Infernal Contract': [onResolve(draw(4), loseHalfLifeRoundedUp())],
  'Mana Drain': [
    targetOnResolve(
      'counter',
      { zone: 'stack' },
      addManaAtNextMainFromTarget(),
    ),
  ],
  Desertion: [
    targetOnResolve(
      'counter',
      { zone: 'stack', stealIfTypes: ['Artifact', 'Creature'] },
    ),
  ],
  'City of Brass': [
    triggerOn('tapped', { do: [{ kind: 'dealDamageToSelf', amount: 1 }] }),
  ],
  'Cryptic Command': [modalChooseTwo(
    {
      id: 'counter',
      label: 'Counter target spell',
      do: [counterTargetSpell()],
    },
    {
      id: 'bounce',
      label: "Return target permanent to its owner's hand",
      do: [bounceTargetPermanent()],
    },
    {
      id: 'tap',
      label: 'Tap all creatures your opponents control',
      do: [tapOpponentsCreatures()],
    },
    {
      id: 'draw',
      label: 'Draw a card',
      do: [draw(1)],
    },
  )],
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
  'Breena, the Demagogue': [
    triggerOn('playerAttacks', {
      do: [
        { kind: 'draw', count: 1, who: 'triggeringPlayer' },
        addPlusCountersToControlled(2),
      ],
    }),
  ],
  'Kuroki, Thief of Talents': [
    yourEndTargetingOpponent(opponentMayDrawThenStealCast(4)),
  ],
}

export const effectsFor = (name: string): CardEffect[] => CARD_RULES[name] ?? []

/** Every handler module a host has to load for this table's cards. */
export const allHandlerIds = () =>
  [...new Set(Object.values(CARD_RULES).flatMap(handlerIdsFromEffects))].sort()

/** Handlers required by the named cards, not the whole Oracle table. */
export const handlerIdsForNames = (names: string[]) =>
  [...new Set(names.flatMap((name) => handlerIdsFromEffects(effectsFor(name))))].sort()

export const effectsOf = (object: { name: string; effects?: CardEffect[] }) =>
  object.effects && object.effects.length > 0 ? object.effects : effectsFor(object.name)

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
