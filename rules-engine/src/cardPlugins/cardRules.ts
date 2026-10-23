import type { GameObject } from '../types'
import {
  ability,
  alternateCast,
  activate,
  becomeCopyOfTarget,
  allCreatureTypes,
  animateUntilEot,
  attachedCopyOrToken,
  attacks,
  basicLand,
  embalm,
  bestow,
  blink,
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
  dealDamageToChosenTarget,
  draw,
  drawGreatestPower,
  encore,
  enters,
  entersIfCastOption,
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
  landToGraveyardOnce,
  landfall,
  linkExile,
  linkedExileUntilLeaves,
  legendRuleOff,
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
  revealPick,
  reanimateCreatureFromGraveyards,
  returnOwnedGraveyardLands,
  searchSpell,
  sacrificePermanentsThenDraw,
  secretCouncil,
  selfMill,
  spree,
  spreeMode,
  staticGrant,
  scry,
  surveil,
  triggerOn,
  targetOnResolve,
  upkeep,
  chooseModes,
  chooseCreatureType,
  chooseVotesThisTurn,
  eachPlayerDiscard,
  eachPlayerDraw,
  eachPlayerLoseLife,
  eachPlayerSacrifice,
  exchangeControlUntilEot,
  ifGiftNotPromised,
  ward,
  yourUpkeep,
  type CardEffect,
  type CardInstruction,
  playExiledWithLife,
  yourEndTargetingOpponent,
  createHeroWithLandCounters,
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
  opponentsLoseLife,
  pumpTargetEqualToLands,
  addPlusCountersEqualToLands,
  escape,
  hiddenPileNegotiation,
  opponentPiles,
  repeatIf,
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
  'Crawling Sensation': [
    yourUpkeep(optionalMill(2)),
    landToGraveyardOnce(insect),
  ],
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
  'It That Betrays': [
    annihilator(2),
    permanentSacrificed(
      { controller: 'opponent', nontoken: true },
      putTriggeringCardOntoBattlefield(),
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
  'Lotho, Corrupt Shirriff': [handler('blinkValue')],
  Mirrorweave: [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', nonlegendary: true },
      copyAllCreaturesUntilEot(false),
    ),
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
  'Quantum Misalignment': [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', controller: 'you' },
      copyTargetCreature({ notLegendary: true }),
    ),
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
  'Springheart Nantuko': [
    bestow('{1}{G}', { power: 1, toughness: 1 }),
    landfall(attachedCopyOrToken('{1}{G}', insectToken)),
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
