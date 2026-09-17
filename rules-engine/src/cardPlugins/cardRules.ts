import {
  ability,
  activate,
  allCreatureTypes,
  attacks,
  basicLand,
  bestow,
  bounceChosenLand,
  bounceSelf,
  branch,
  controlledCreaturePower,
  controlledLands,
  copyAllCreaturesUntilEot,
  copyControlledCreature,
  copySelf,
  copyTargetCreature,
  createTokenInstruction,
  createXTokens,
  dies,
  discardHandsThenDrawGreatest,
  doublePlusCounters,
  dealDamageToChosenTarget,
  draw,
  drawAtNextUpkeep,
  enters,
  entersTapped,
  extraEnters,
  extraLandfall,
  extraLandPlays,
  exileColoredPermanentsAtMostX,
  gainLife,
  grantUntilEot,
  graveyardCards,
  handler,
  handlerIdsFromEffects,
  hasSubtype,
  landToGraveyard,
  landfall,
  legendRuleOff,
  loseLifeTargetManaValue,
  loyalty,
  loyaltyX,
  lookTopChooseOne,
  manaIf,
  onResolve,
  optionalMill,
  otherLands,
  playLandsFromGraveyard,
  pluginIdsFromEffects,
  pump,
  putLandFromHand,
  putMilledLandTapped,
  putPermanentsFromHand,
  revealPick,
  returnChosenLandFromGraveyard,
  returnOwnedGraveyardLands,
  searchAbility,
  searchSpell,
  selfMill,
  sharedBasicLandType,
  staticExtraLandPlays,
  staticGrant,
  surveil,
  tapUnlessPayLife,
  teferiSunsetEmblem,
  teferiSunsetPlusOne,
  targetOnResolve,
  uniqueLandNames,
  type CardEffect,
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

const insect = createTokenInstruction({
  name: 'Insect',
  types: ['Creature'],
  subtypes: ['Insect'],
  power: 1,
  toughness: 1,
})

export const CARD_RULES: Record<string, CardEffect[]> = {
  'Aftermath Analyst': [
    activate({
      id: 'graveyardLands.aftermath',
      costs: { mana: '{3}{G}', sacrifice: 'self' },
      do: [returnOwnedGraveyardLands()],
    }),
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
  'Dakmor Salvage': [entersTapped()],
  'Dimir Aqueduct': [entersTapped(), enters(bounceChosenLand())],
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
  'Ghost Town': [
    activate({
      id: 'selfBounceLand.ghostTown',
      costs: {},
      if: { kind: 'notActivePlayer' },
      do: [bounceSelf()],
    }),
  ],
  'Golgari Rot Farm': [entersTapped(), enters(bounceChosenLand())],
  'Hall of Storm Giants': [entersTapped(otherLands({ min: 2 }))],
  'Hedge Maze': [entersTapped(), enters(surveil(1))],
  'Homer, the Hermit': [handler('homer')],
  'Icetill Explorer': [staticExtraLandPlays(1), landfall(selfMill(1))],
  'Joint Exploration': [onResolve(draw(1)), handler('jointExploration')],
  'Keep Safe': [
    targetOnResolve(
      'counter',
      { zone: 'stack', spellTargetsControlledPermanent: true },
      draw(1),
    ),
  ],
  'Lair of the Hydra': [entersTapped(otherLands({ min: 2 }))],
  'Lightning Bolt': [onResolve(dealDamageToChosenTarget(3))],
  'Lotus Field': [entersTapped()],
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
  'Mystic Sanctuary': [entersTapped(otherLands({ max: 2, subtype: 'Island' }))],
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
  'Scute Swarm': [
    landfall(branch(controlledLands({ min: 6 }), [copySelf()], [insect])),
  ],
  'Simic Growth Chamber': [entersTapped(), enters(bounceChosenLand())],
  "Sin, Spira's Punishment": [handler('sin')],
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
  'Black Sun\'s Twilight': [onResolve(pump(-1, -1))],
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
    landToGraveyard(insect),
  ],
  'Dismember': [
    targetOnResolve('select', { zone: 'battlefield', type: 'Creature' }, pump(-5, -5)),
  ],
  'Drag to the Roots': [targetOnResolve('destroy', { zone: 'battlefield', nonland: true })],
  'Dread Return': [
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
  'Fell the Profane': [
    targetOnResolve('destroy', { zone: 'battlefield', types: ['Creature', 'Planeswalker'] }),
  ],
  'Firdoch Core': [
    allCreatureTypes(),
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
  ],
  "Irenicus's Vile Duplication": [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', controller: 'you' },
      copyTargetCreature({ notLegendary: true, flying: true }),
    ),
  ],
  'Join the Dead': [
    targetOnResolve('select', { zone: 'battlefield', type: 'Creature' }, pump(-5, -5)),
  ],
  'Kindred Dominance': [onResolve(pump(0, 0))],
  'Life from the Loam': [
    onResolve(returnChosenLandFromGraveyard(false)),
  ],
  'Lumra, Bellow of the Woods': [
    enters(selfMill(4), returnOwnedGraveyardLands()),
  ],
  'Malakir Mire': [entersTapped()],
  'Malakir Rebirth': [onResolve(grantUntilEot('indestructible'))],
  'Malevolent Rumble': [onResolve(revealPick(4, { permanent: true }), insect)],
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
    targetOnResolve('destroy', { zone: 'battlefield', types: ['Creature', 'Planeswalker'] }, surveil(2)),
  ],
  'Price of Fame': [
    targetOnResolve('destroy', { zone: 'battlefield', type: 'Creature' }, surveil(2)),
  ],
  'Quantum Misalignment': [
    targetOnResolve(
      'select',
      { zone: 'battlefield', type: 'Creature', controller: 'you' },
      copyTargetCreature({ notLegendary: true }),
    ),
  ],
  'Raise the Palisade': [onResolve(pump(0, 0))],
  'Reanimate': [
    targetOnResolve(
      'reanimate',
      { zone: 'graveyard', type: 'Creature' },
      loseLifeTargetManaValue(),
    ),
  ],
  'Ripples of Undeath': [enters(selfMill(3))],
  'Roaming Throne': [enters(copyControlledCreature())],
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
  Six: [attacks(selfMill(3), revealPick(3, { type: 'Land' }))],
  'Spark Double': [enters(copyControlledCreature({ notLegendary: true, plusCounters: 1 }))],
  'Springheart Nantuko': [
    bestow('{1}{G}'),
    landfall(branch(controlledLands({ min: 0 }), [insect])),
  ],
  'Stitch Together': [
    targetOnResolve('bounce', { zone: 'graveyard', type: 'Creature' }),
  ],
  "Liliana's Caress": [staticGrant('lilianasCaress'), handler('lilianasCaress')],
  'Rankle, Master of Pranks': [staticGrant('rankle'), handler('rankle')],
  'Sygg, River Cutthroat': [staticGrant('sygg'), handler('sygg')],
  "Tamiyo's Safekeeping": [
    targetOnResolve(
      'select',
      { zone: 'battlefield', controller: 'you' },
      grantUntilEot('hexproof', 'indestructible'),
      gainLife(2),
    ),
  ],
  'Tear Asunder': [targetOnResolve('exile', { zone: 'battlefield', types: ['Artifact', 'Enchantment'] })],
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
  'Forgotten Cellar': [playLandsFromGraveyard()],
  'Wash Away': [targetOnResolve('counter', { zone: 'stack' })],
  'Watery Grave': [tapUnlessPayLife(2)],
  'World Shaper': [
    attacks(optionalMill(3)),
    dies(returnOwnedGraveyardLands()),
  ],
  'Yarok, the Desecrated': [extraEnters(1), extraLandfall(1)],
  'Zimone and Dina': [
    activate({
      id: 'zimone.draw',
      costs: { tap: true, sacrificeTarget: 'creature' },
      do: [draw(1), putLandFromHand(true)],
    }),
  ],
  'Incarnation Technique': [onResolve(selfMill(5), returnChosenLandFromGraveyard())],
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
    activate({
      id: 'cycling.zagothTriome',
      zone: 'hand',
      costs: { mana: '{3}', discard: 'self' },
      do: [draw(1)],
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
