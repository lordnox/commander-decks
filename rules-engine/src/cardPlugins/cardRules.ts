import {
  activate,
  basicLand,
  bounceSelf,
  branch,
  controlledLands,
  copySelf,
  createTokenInstruction,
  dies,
  doublePlusCounters,
  draw,
  enters,
  entersTapped,
  extraLandPlays,
  handler,
  handlerIdsFromEffects,
  hasSubtype,
  landfall,
  onResolve,
  otherLands,
  pluginIdsFromEffects,
  returnOwnedGraveyardLands,
  searchAbility,
  searchSpell,
  selfMill,
  sharedBasicLandType,
  staticExtraLandPlays,
  staticGrant,
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
  'Dakmor Salvage': [entersTapped()],
  'Dimir Aqueduct': [entersTapped()],
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
  'Golgari Rot Farm': [entersTapped()],
  'Hall of Storm Giants': [entersTapped(otherLands({ min: 2 }))],
  'Hedge Maze': [entersTapped()],
  'Homer, the Hermit': [handler('homer')],
  'Icetill Explorer': [staticExtraLandPlays(1), landfall(selfMill(1))],
  'Joint Exploration': [onResolve(draw(1)), handler('jointExploration')],
  'Lair of the Hydra': [entersTapped(otherLands({ min: 2 }))],
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
  'Mossborn Hydra': [landfall(doublePlusCounters())],
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
  'Oboro, Palace in the Clouds': [
    activate({
      id: 'selfBounceLand.oboro',
      costs: { mana: '{1}' },
      do: [bounceSelf()],
    }),
  ],
  'Pit of Offerings': [entersTapped()],
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
  'Scute Swarm': [
    landfall(branch(controlledLands({ min: 6 }), [copySelf()], [insect])),
  ],
  'Simic Growth Chamber': [entersTapped()],
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
  'Thawing Glaciers': [entersTapped()],
  'Three Visits': [
    searchSpell({
      prompt: 'Search your library for a Forest card and put it onto the battlefield.',
      match: hasSubtype('Forest'),
      destination: 'battlefield',
      min: 1,
      max: 1,
    }),
  ],
  'Undercity Sewers': [entersTapped()],
  'Underground Mortuary': [entersTapped()],
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
  'Yurlok of Scorch Thrash': [
    staticGrant('manaBurn'),
    activate({
      id: 'yurlok.mana-rain',
      manaAbility: true,
      costs: { tap: true, mana: '{1}' },
      do: [{ kind: 'addManaToEachPlayer', mana: { B: 1, R: 1, G: 1 } }],
    }),
  ],
  'Zagoth Triome': [entersTapped()],
}

export const effectsFor = (name: string): CardEffect[] => CARD_RULES[name] ?? []

/** Every handler module a host has to load for this table's cards. */
export const allHandlerIds = () =>
  [...new Set(Object.values(CARD_RULES).flatMap(handlerIdsFromEffects))].sort()

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
