import { expect, test } from 'bun:test'
import { CARD_COLORS, CHOICE_RELATIONS, KEYWORDS, REVEAL_UNTIL_REST, ROUNDING_MODES } from './v1'
import { effectsFor } from '../cardRules'
import { cardRuleDefinitionSnapshotFor, cardTemplateDefaultsFor } from './cardRuleCatalog'

// Card configuration has structural coverage; instruction suites own execution.
test.each([
  ['Long Road Home', ['sequence']],
  ['Otherworldly Journey', ['sequence']],
  ['Infernal Contract', ['draw', 'loseLife']],
  ['Explore', ['grantLandPlays', 'draw']],
  ['Summer Bloom', ['grantLandPlays']],
  ['Ghostly Flicker', ['blink']],
  ['Cloudshift', ['blink']],
  ['Flicker of Fate', ['blink']],
  ['Counterspell', ['counter']],
  ['Absorb', ['counter', 'gainLife']],
  ['Anguished Unmaking', ['move', 'loseLife']],
  ['Aetherize', ['move']],
  ['Dismember', ['createEffect']],
  ['Harrow', ['sequence']],
  ['Cultivate', ['sequence']],
  ["Kodama's Reach", ['sequence']],
  ['Growth Spiral', ['draw', 'sequence']],
  ['Three Visits', ['sequence']],
  ["Nature's Lore", ['sequence']],
  ['Entomb', ['sequence']],
  ['Buried Alive', ['sequence']],
  ['Flame Rift', ['damage']],
  ["Night's Whisper", ['draw', 'loseLife']],
  ['Reverberate', ['copySpell']],
  ['Twincast', ['copySpell']],
  ['Splendid Reclamation', ['move']],
  ['Unmarked Grave', ['sequence']],
  ['Diabolic Tutor', ['sequence']],
  ['Foil', ['counter']],
  ["Dovin's Veto", ['counter']],
  ['Desertion', ['counter']],
  ['Murder', ['destroy']],
  ['Sign in Blood', ['draw', 'loseLife']],
  ['Darkness', ['createEffect']],
  ['Batwing Brume', ['if', 'if']],
  ['Comeuppance', ['createEffect', 'createEffect']],
  ['Energy Arc', ['untap', 'createEffect', 'createEffect']],
  ['Inkshield', ['createEffect']],
  ['Sea Gate Restoration', ['draw', 'grantNoMaximumHandSize']],
  ['Sink into Stupor', ['move']],
  ['Windfall', ['forEachPlayer', 'draw']],
] as const)('catalog %s composes canonical instructions without legacy effects', (name, kinds) => {
  const definition = cardRuleDefinitionSnapshotFor(name)!
  expect(effectsFor(name)).toEqual([])
  expect(definition.definition.abilities).toHaveLength(1)
  const ability = definition.definition.abilities[0]!
  expect(ability.kind).toBe('spell')
  if (ability.kind !== 'spell') throw new Error('expected spell configuration')
  expect(ability.instructions!.map(instruction => instruction.kind)).toEqual([...kinds])
})

test.each([
  ['Counterspell', 'stackItems', { kind: 'spell' }],
  ['Absorb', 'stackItems', { kind: 'spell' }],
  ['Desertion', 'stackItems', { kind: 'spell' }],
  ["Dovin's Veto", 'stackItems', { kind: 'spell', not: { type: 'Creature' } }],
  ['Dismember', 'objects', { zone: 'battlefield', type: 'Creature' }],
  ['Anguished Unmaking', 'objects', { zone: 'battlefield', not: { type: 'Land' } }],
  ['Sink into Stupor', 'objects', {
    controller: 'opponent',
    any: [{ zone: 'stack' }, { zone: 'battlefield', not: { type: 'Land' } }],
  }],
] as const)('catalog %s declares its target selector', (name, kind, filter) => {
  const ability = cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]!
  expect(ability).toMatchObject({ decisions: { targets: [{
    filter: { kind, filter }, min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 },
  }] } })
})

test('catalog Aetherize returns all attacking permanents to hand', () => {
  expect(cardTemplateDefaultsFor('Aetherize')).toMatchObject({
    types: ['Instant'], colors: ['U'], manaCost: '{3}{U}', manaValue: 4,
  })
  expect(cardRuleDefinitionSnapshotFor('Aetherize')!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    instructions: [{
      kind: 'move',
      targets: { kind: 'objects', filter: { zone: 'battlefield', attacking: true } },
      to: 'hand',
    }],
  })
})

test('catalog Dismember preserves its Phyrexian mana costs and temporary reduction', () => {
  expect(cardTemplateDefaultsFor('Dismember')).toMatchObject({
    types: ['Instant'], colors: ['B'], manaCost: '{1}{B/P}{B/P}', manaValue: 3,
  })
  expect(cardRuleDefinitionSnapshotFor('Dismember')!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    costs: [{ kind: 'mana', amount: '{1}{B/P}{B/P}' }],
    instructions: [{
      kind: 'createEffect',
      effect: { kind: 'pump', power: { kind: 'constant', value: -5 }, toughness: { kind: 'constant', value: -5 } },
      duration: { kind: 'untilCleanup' },
    }],
  })
})

test.each(['Cultivate', "Kodama's Reach"] as const)('catalog %s splits two basics between battlefield and hand', name => {
  expect(cardTemplateDefaultsFor(name)).toMatchObject({
    types: ['Sorcery'], colors: ['G'], manaCost: '{2}{G}', manaValue: 3,
  })
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    instructions: [{ kind: 'sequence', instructions: [
      { kind: 'chooseCards', bindChoice: 'found', chooser: { kind: 'contextRef', name: 'controller' },
        filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] } },
        min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 2 }, viewLibrary: true },
      { kind: 'reveal', targets: { kind: 'choiceRef', binding: 'found' } },
      { kind: 'chooseCards', bindChoice: 'battlefieldLand', chooser: { kind: 'contextRef', name: 'controller' },
        filter: { kind: 'objects', filter: { among: { kind: 'choiceRef', binding: 'found' } } },
        min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 } },
      { kind: 'move', targets: { kind: 'choiceRef', binding: 'battlefieldLand' }, to: 'battlefield', tapped: true },
      { kind: 'move', targets: { kind: 'objects', filter: {
        among: { kind: 'choiceRef', binding: 'found' },
        not: { among: { kind: 'choiceRef', binding: 'battlefieldLand' } },
      } }, to: 'hand' },
      { kind: 'shuffle', targets: { kind: 'contextRef', name: 'controller' } },
    ] }],
  })
})

test('catalog Harrow sacrifices a controlled land and finds up to two basic lands', () => {
  expect(cardTemplateDefaultsFor('Harrow')).toMatchObject({
    types: ['Instant'], colors: ['G'], manaCost: '{2}{G}', manaValue: 3,
  })
  expect(cardRuleDefinitionSnapshotFor('Harrow')!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    costs: [{ kind: 'sacrifice', filter: { kind: 'objects', filter: {
      zone: 'battlefield', controller: 'you', type: 'Land',
    } }, count: { kind: 'constant', value: 1 } }],
    instructions: [{ kind: 'sequence', instructions: [
      { kind: 'chooseCards', bindChoice: 'found', chooser: { kind: 'contextRef', name: 'controller' },
        filter: { kind: 'objects', filter: {
          zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'],
        } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 2 }, viewLibrary: true },
      { kind: 'move', targets: { kind: 'choiceRef', binding: 'found' }, to: 'battlefield' },
      { kind: 'shuffle', targets: { kind: 'contextRef', name: 'controller' } },
    ] }],
  })
})

test('catalog Eternal Witness targets a card its controller owns in a graveyard and may return it', () => {
  expect(effectsFor('Eternal Witness')).toEqual([])
  const ability = cardRuleDefinitionSnapshotFor('Eternal Witness')!.definition.abilities[0]!
  expect(ability).toMatchObject({
    kind: 'triggered',
    on: { kind: 'enters' },
    decisions: { targets: [{
      filter: { kind: 'objects', filter: { zone: 'graveyard', owner: 'you', token: false } },
      min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 },
    }] },
    instructions: [{ kind: 'chooseInstructions', chooser: { kind: 'contextRef', name: 'controller' }, prompt: 'Return the target card?', options: [
      { label: 'Return it to your hand', instructions: [{ kind: 'move', targets: { kind: 'targetRef', clauseIndex: 0 }, to: 'hand' }] },
      { label: 'Decline', instructions: [] },
    ] }],
  })
})

test.each([
  ['Entomb', undefined, 1, 1],
  ['Buried Alive', 'Creature', 0, 3],
] as const)('catalog %s configures a controller-library search', (name, type, min, max) => {
  const ability = cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]!
  expect(ability).toMatchObject({ instructions: [{ kind: 'sequence', instructions: [
    { kind: 'chooseCards', bindChoice: 'found', chooser: { kind: 'contextRef', name: 'controller' },
      filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', ...(type ? { type } : {}) } },
      min: { kind: 'constant', value: min }, max: { kind: 'constant', value: max } },
    { kind: 'move', targets: { kind: 'choiceRef', binding: 'found' }, to: 'graveyard' },
    { kind: 'shuffle', targets: { kind: 'contextRef', name: 'controller' } },
  ] }] })
})

test('catalog Dovin’s Veto is an uncounterable noncreature counter', () => {
  expect(cardRuleDefinitionSnapshotFor("Dovin's Veto")!.definition.abilities[0]).toMatchObject({
    kind: 'spell', uncounterable: true,
    instructions: [{ kind: 'counter', targets: { kind: 'targetRef', clauseIndex: 0 } }],
  })
})

test('catalog Desertion redirects artifact and creature spells to the battlefield', () => {
  expect(cardRuleDefinitionSnapshotFor('Desertion')!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    instructions: [{
      kind: 'counter',
      destination: { to: 'battlefield', controller: { kind: 'contextRef', name: 'controller' }, types: ['Artifact', 'Creature'] },
    }],
  })
})

test('catalog instruction parameters preserve controller life changes and exile destination', () => {
  expect(cardRuleDefinitionSnapshotFor('Absorb')!.definition.abilities[0]).toMatchObject({ instructions: [
    { kind: 'counter', targets: { kind: 'targetRef', clauseIndex: 0 } },
    { kind: 'gainLife', amount: { kind: 'constant', value: 3 }, targets: { kind: 'contextRef', name: 'controller' } },
  ] })
  expect(cardRuleDefinitionSnapshotFor('Anguished Unmaking')!.definition.abilities[0]).toMatchObject({ instructions: [
    { kind: 'move', targets: { kind: 'targetRef', clauseIndex: 0 }, to: 'exile' },
    { kind: 'loseLife', amount: { kind: 'constant', value: 3 }, targets: { kind: 'contextRef', name: 'controller' } },
  ] })
})

test('catalog Growth Spiral draws before offering one optional land from hand', () => {
  const definition = cardRuleDefinitionSnapshotFor('Growth Spiral')!.definition
  expect(effectsFor('Growth Spiral')).toEqual([])
  expect(cardTemplateDefaultsFor('Growth Spiral')).toMatchObject({
    types: ['Instant'], colors: ['G', 'U'], manaCost: '{G}{U}', manaValue: 2,
  })
  expect(definition.abilities[0]).toMatchObject({
    kind: 'spell',
    costs: [],
    instructions: [
      { kind: 'draw', count: { kind: 'constant', value: 1 }, targets: { kind: 'contextRef', name: 'controller' } },
      { kind: 'sequence', instructions: [
        {
          kind: 'chooseCards',
          chooser: { kind: 'contextRef', name: 'controller' },
          filter: { kind: 'objects', filter: { zone: 'hand', owner: 'you', type: 'Land' } },
          min: { kind: 'constant', value: 0 },
          max: { kind: 'constant', value: 1 },
        },
        { kind: 'move', targets: { kind: 'choiceRef', binding: 'land' }, to: 'battlefield' },
      ] },
    ],
  })
})

test('catalog Three Visits allows fail-to-find and puts a Forest onto the battlefield', () => {
  expect(effectsFor('Three Visits')).toEqual([])
  expect(cardTemplateDefaultsFor('Three Visits')).toMatchObject({
    types: ['Sorcery'], colors: ['G'], manaCost: '{1}{G}', manaValue: 2,
  })
  expect(cardRuleDefinitionSnapshotFor('Three Visits')!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    instructions: [{ kind: 'sequence', instructions: [
      {
        kind: 'chooseCards',
        chooser: { kind: 'contextRef', name: 'controller' },
        filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', subtypes: ['Forest'] } },
        min: { kind: 'constant', value: 0 },
        max: { kind: 'constant', value: 1 },
      },
      { kind: 'move', targets: { kind: 'choiceRef', binding: 'forest' }, to: 'battlefield' },
      { kind: 'shuffle', targets: { kind: 'contextRef', name: 'controller' } },
    ] }],
  })
})

test("catalog Nature's Lore allows fail-to-find and puts a Forest onto the battlefield", () => {
  expect(effectsFor("Nature's Lore")).toEqual([])
  expect(cardTemplateDefaultsFor("Nature's Lore")).toMatchObject({
    types: ['Sorcery'], colors: ['G'], manaCost: '{1}{G}', manaValue: 2,
  })
  expect(cardRuleDefinitionSnapshotFor("Nature's Lore")!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    instructions: [{ kind: 'sequence', instructions: [
      {
        kind: 'chooseCards',
        chooser: { kind: 'contextRef', name: 'controller' },
        filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', subtypes: ['Forest'] } },
        min: { kind: 'constant', value: 0 },
        max: { kind: 'constant', value: 1 },
      },
      { kind: 'move', targets: { kind: 'choiceRef', binding: 'forest' }, to: 'battlefield' },
      { kind: 'shuffle', targets: { kind: 'contextRef', name: 'controller' } },
    ] }],
  })
})

test('catalog Aftermath Analyst mills on enter and reclaims graveyard lands tapped', () => {
  expect(effectsFor('Aftermath Analyst')).toEqual([])
  expect(cardTemplateDefaultsFor('Aftermath Analyst')).toMatchObject({
    types: ['Creature'], colors: ['G'], manaCost: '{1}{G}', manaValue: 2,
  })
  const abilities = cardRuleDefinitionSnapshotFor('Aftermath Analyst')!.definition.abilities
  expect(abilities).toHaveLength(2)
  expect(abilities[0]).toMatchObject({
    kind: 'triggered',
    on: { kind: 'enters' },
    instructions: [{ kind: 'mill', count: { kind: 'constant', value: 3 } }],
  })
  expect(abilities[1]).toMatchObject({
    kind: 'activated',
    costs: [
      { kind: 'mana', amount: '{3}{G}' },
      { kind: 'sacrifice', filter: { kind: 'contextRef', name: 'source' }, count: { kind: 'constant', value: 1 } },
    ],
    instructions: [{
      kind: 'move',
      targets: { kind: 'objects', filter: { zone: 'graveyard', owner: 'you', type: 'Land' } },
      to: 'battlefield',
      tapped: true,
    }],
  })
})

test('catalog Aesi composes extra land plays and a land-enter draw without legacy effects', () => {
  expect(effectsFor('Aesi, Tyrant of Gyre Strait')).toEqual([])
  const definition = cardRuleDefinitionSnapshotFor('Aesi, Tyrant of Gyre Strait')!
  expect(definition.definition.abilities).toHaveLength(2)
  expect(definition.definition.abilities[0]).toMatchObject({
    kind: 'static',
    effects: [{ kind: 'extraLandPlays', count: 1 }],
  })
  expect(definition.definition.abilities[1]).toMatchObject({
    kind: 'triggered',
    on: { kind: 'enters', filter: { type: 'Land', controller: 'you' } },
    instructions: [{ kind: 'chooseInstructions', optional: true, options: [
      { instructions: [{ kind: 'draw', count: { kind: 'constant', value: 1 } }] },
      { instructions: [] },
    ] }],
  })
  expect(cardTemplateDefaultsFor('Aesi, Tyrant of Gyre Strait')).toMatchObject({
    types: ['Creature'],
    colors: ['G', 'U'],
    manaCost: '{4}{G}{U}',
    manaValue: 6,
  })
})

test.each(['Counterspell', 'Absorb'])('catalog %s binds counter to its announced target', name => {
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]).toMatchObject({
    instructions: [{ kind: 'counter', targets: { kind: 'targetRef', clauseIndex: 0 } },
      ...(name === 'Absorb' ? [expect.anything()] : [])],
  })
})

test('catalog Fate Unraveler composes an opponent-draw trigger without legacy effects', () => {
  const definition = cardRuleDefinitionSnapshotFor('Fate Unraveler')!
  expect(effectsFor('Fate Unraveler')).toEqual([])
  const ability = definition.definition.abilities[0]!
  expect(ability.kind).toBe('triggered')
  if (ability.kind !== 'triggered') throw new Error('expected triggered configuration')
  expect(ability.instructions!.map(instruction => instruction.kind)).toEqual(['damage'])
})

test('catalog Esper Charm composes modal destroy, draw, or discard without legacy effects', () => {
  const ability = cardRuleDefinitionSnapshotFor('Esper Charm')!.definition.abilities[0]!
  expect(effectsFor('Esper Charm')).toEqual([])
  expect(ability.kind).toBe('spell')
  if (ability.kind !== 'spell') throw new Error('expected spell configuration')
  expect(ability.modes!.map(mode => mode.instructions!.map(instruction => instruction.kind))).toEqual([
    ['destroy'],
    ['draw'],
    ['discard'],
  ])
})

test('catalog Vampire Hounds composes a discard-cost pump without legacy effects', () => {
  const definition = cardRuleDefinitionSnapshotFor('Vampire Hounds')!
  expect(effectsFor('Vampire Hounds')).toEqual([])
  const ability = definition.definition.abilities[0]!
  expect(ability.kind).toBe('activated')
  if (ability.kind !== 'activated') throw new Error('expected activated configuration')
  expect(ability.instructions!.map(instruction => instruction.kind)).toEqual(['createEffect'])
})

test('Diabolic Tutor supplies printed characteristics beside its canonical rules', () => {
  expect(cardTemplateDefaultsFor('Diabolic Tutor')).toEqual({
    types: ['Sorcery'],
    colors: ['B'],
    manaCost: '{2}{B}{B}',
    manaValue: 4,
    ruleDefinition: cardRuleDefinitionSnapshotFor('Diabolic Tutor')!,
  })
})


test('catalog Twincast retains spell-copy targeting and retargeting', () => {
  expect(cardRuleDefinitionSnapshotFor('Twincast')!.definition)
    .toEqual(cardRuleDefinitionSnapshotFor('Reverberate')!.definition)
})

test('catalog Splendid Reclamation moves only owned graveyard lands tapped', () => {
  expect(cardRuleDefinitionSnapshotFor('Splendid Reclamation')!.definition.abilities[0]).toMatchObject({
    instructions: [{ kind: 'move', targets: { kind: 'objects', filter: { zone: 'graveyard', owner: 'you', type: 'Land' } }, to: 'battlefield', tapped: true }],
  })
})

test('catalog Unmarked Grave filters legendary cards before moving and shuffling', () => {
  expect(cardRuleDefinitionSnapshotFor('Unmarked Grave')!.definition.abilities[0]).toMatchObject({
    instructions: [{ kind: 'sequence', instructions: [
      { kind: 'chooseCards', filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', not: { supertypes: ['Legendary'] } } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 } },
      { kind: 'move', targets: { kind: 'choiceRef', binding: 'found' }, to: 'graveyard' },
      { kind: 'shuffle', targets: { kind: 'contextRef', name: 'controller' } },
    ] }],
  })
})


test.each(['Charcoal Diamond', 'Sky Diamond', 'Worn Powerstone', 'Mistvault Bridge', 'Bala Ged Sanctuary', 'Malakir Mire'])('catalog %s replaces its own entry with tapped entry', name => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities.slice(0, 1)).toMatchObject([{
    kind: 'static', effects: [{ kind: 'replacement', event: { kind: 'enterBattlefield', filter: { object: { kind: 'contextRef', name: 'source' } } }, transform: { kind: 'modifyEvent', changes: { tapped: true } } }],
  }])
})

test("catalog Stitcher's Supplier mills its controller on entry and death", () => {
  expect(effectsFor("Stitcher's Supplier")).toEqual([])
  expect(cardRuleDefinitionSnapshotFor("Stitcher's Supplier")!.definition.abilities).toMatchObject([
    { kind: 'triggered', on: { kind: 'enters' }, instructions: [{ kind: 'mill', count: { kind: 'constant', value: 3 }, targets: { kind: 'contextRef', name: 'controller' } }] },
    { kind: 'triggered', on: { kind: 'dies' }, instructions: [{ kind: 'mill', count: { kind: 'constant', value: 3 }, targets: { kind: 'contextRef', name: 'controller' } }] },
  ])
})


test.each([
  ['Botanical Sanctum', 'objects', 'gte', 3],
  ['Concealed Courtyard', 'objects', 'gte', 3],
  ['Eclipsed Steppe', 'objects', 'lte', 1],
  ['Sunken Hollow', 'objects', 'lte', 1],
  ['Castle Garenbrig', 'objects', 'eq', 0],
  ['Drowned Catacomb', 'objects', 'eq', 0],
  ['Glacial Fortress', 'objects', 'eq', 0],
  ['Hinterland Harbor', 'objects', 'eq', 0],
  ['Morphic Pool', 'players', 'lte', 1],
  ['Rejuvenating Springs', 'players', 'lte', 1],
  ['Vault of Champions', 'players', 'lte', 1],
] as const)('catalog %s retains its conditional tapped entry', (name, selectorKind, operator, threshold) => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities.slice(0, 1)).toMatchObject([{
    kind: 'static', effects: [{ kind: 'replacement', when: { kind: 'compareAmount', left: { kind: 'count', of: { kind: selectorKind } }, operator, right: { kind: 'constant', value: threshold } }, transform: { kind: 'modifyEvent', changes: { tapped: true } } }],
  }])
})


test.each(['Crop Rotation', 'Farseek'])('catalog %s searches its controller library without legacy effects', name => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]).toMatchObject({
    kind: 'spell', instructions: [{ kind: 'sequence', instructions: [
      { kind: 'chooseCards', filter: { kind: 'objects', filter: { zone: 'library', owner: 'you' } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 } },
      { kind: 'move', to: 'battlefield' },
      { kind: 'shuffle' },
    ] }],
  })
})

test('catalog Farseek restricts searches to its four named land types and enters tapped', () => {
  expect(cardRuleDefinitionSnapshotFor('Farseek')!.definition.abilities[0]).toMatchObject({ instructions: [{ kind: 'sequence', instructions: [
    { kind: 'chooseCards', filter: { kind: 'objects', filter: { any: [{ subtypes: ['Plains'] }, { subtypes: ['Island'] }, { subtypes: ['Swamp'] }, { subtypes: ['Mountain'] }] } } },
    { kind: 'move', to: 'battlefield', tapped: true }, { kind: 'shuffle' },
  ] }] })
})

test('catalog Crop Rotation sacrifices a controlled land as an additional cost', () => {
  expect(cardRuleDefinitionSnapshotFor('Crop Rotation')!.definition.abilities[0]).toMatchObject({
    costs: [{ kind: 'sacrifice', filter: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you', type: 'Land' } }, count: { kind: 'constant', value: 1 } }],
  })
})

test('catalog Farhaven Elf offers its basic-land search on entry', () => {
  expect(effectsFor('Farhaven Elf')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Farhaven Elf')!.definition.abilities[0]).toMatchObject({ kind: 'triggered', on: { kind: 'enters' }, instructions: [{ kind: 'chooseInstructions', optional: true }] })
})

test('catalog Sakura-Tribe Elder sacrifices itself to search for a basic land tapped', () => {
  expect(effectsFor('Sakura-Tribe Elder')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Sakura-Tribe Elder')!.definition.abilities[0]).toMatchObject({ kind: 'activated', costs: [{ kind: 'sacrifice', filter: { kind: 'contextRef', name: 'source' } }], instructions: [{ kind: 'sequence', instructions: [
    { kind: 'chooseCards', filter: { kind: 'objects', filter: { type: 'Land', supertypes: ['Basic'] } } }, { kind: 'move', to: 'battlefield', tapped: true }, { kind: 'shuffle' },
  ] }] })
})

test('catalog Bala Ged Recovery targets an owned graveyard card', () => {
  expect(effectsFor('Bala Ged Recovery')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Bala Ged Recovery')!.definition.abilities[0]).toMatchObject({ kind: 'spell', decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'graveyard', owner: 'you' } } }] }, instructions: [{ kind: 'move', to: 'hand' }] })
})

test('catalog Selenia pays two life to return its source to hand', () => {
  expect(effectsFor('Selenia, Dark Angel')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Selenia, Dark Angel')!.definition.abilities[0]).toMatchObject({ kind: 'activated', costs: [{ kind: 'life', amount: { kind: 'constant', value: 2 } }], instructions: [{ kind: 'move', targets: { kind: 'contextRef', name: 'source' }, to: 'hand' }] })
})


test('catalog Darkness prevents all combat damage this turn', () => {
  expect(effectsFor('Darkness')).toEqual([])
  expect(cardTemplateDefaultsFor('Darkness')).toMatchObject({
    types: ['Instant'], colors: ['B'], manaCost: '{B}', manaValue: 1,
  })
  expect(cardRuleDefinitionSnapshotFor('Darkness')!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    instructions: [{
      kind: 'createEffect',
      targets: { kind: 'contextRef', name: 'source' },
      duration: { kind: 'untilCleanup' },
      effect: { kind: 'prevention', capacity: { kind: 'unlimited' }, filter: { combat: true } },
    }],
  })
})

test('catalog Kami of False Hope sacrifices itself to prevent all combat damage this turn', () => {
  expect(effectsFor('Kami of False Hope')).toEqual([])
  expect(cardTemplateDefaultsFor('Kami of False Hope')).toMatchObject({
    types: ['Creature'], subtypes: ['Spirit'], colors: ['W'], manaCost: '{W}', manaValue: 1,
  })
  expect(cardRuleDefinitionSnapshotFor('Kami of False Hope')!.definition.abilities[0]).toMatchObject({
    kind: 'activated',
    costs: [{ kind: 'sacrifice', filter: { kind: 'contextRef', name: 'source' } }],
    instructions: [{
      kind: 'createEffect',
      targets: { kind: 'contextRef', name: 'source' },
      duration: { kind: 'untilCleanup' },
      effect: { kind: 'prevention', capacity: { kind: 'unlimited' }, filter: { combat: true } },
    }],
  })
})

test('catalog Sokrates grants defender, conditional hexproof, and a combat-dialogue prevention', () => {
  expect(effectsFor('Sokrates, Athenian Teacher')).toEqual([])
  expect(cardTemplateDefaultsFor('Sokrates, Athenian Teacher')).toMatchObject({
    types: ['Creature'], subtypes: ['Human', 'Advisor'], colors: ['W', 'U'], manaCost: '{1}{W}{U}', manaValue: 3,
  })
  expect(cardRuleDefinitionSnapshotFor('Sokrates, Athenian Teacher')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: KEYWORDS.defender },
    { kind: 'keyword', keyword: KEYWORDS.hexproof, when: { kind: 'compareAmount' } },
    {
      kind: 'activated',
      costs: [{ kind: 'tapSource' }],
      decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature' } } }] },
      instructions: [{
        kind: 'createEffect',
        targets: { kind: 'targetRef', clauseIndex: 0 },
        duration: { kind: 'untilCleanup' },
        effect: { kind: 'prevention', capacity: { kind: 'unlimited' }, filter: { combat: true } },
      }],
    },
  ])
})

test('catalog Lady Evangela fogs combat damage from a targeted creature', () => {
  expect(effectsFor('Lady Evangela')).toEqual([])
  expect(cardTemplateDefaultsFor('Lady Evangela')).toMatchObject({
    types: ['Creature'], subtypes: ['Human', 'Cleric'], colors: ['W', 'U', 'B'], manaCost: '{W}{U}{B}', manaValue: 3,
  })
  expect(cardRuleDefinitionSnapshotFor('Lady Evangela')!.definition.abilities[0]).toMatchObject({
    kind: 'activated',
    costs: [{ kind: 'mana', amount: '{W}{B}' }, { kind: 'tapSource' }],
    decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature' } } }] },
    instructions: [{
      kind: 'createEffect',
      targets: { kind: 'contextRef', name: 'source' },
      duration: { kind: 'untilCleanup' },
      effect: {
        kind: 'prevention',
        capacity: { kind: 'unlimited' },
        filter: { combat: true, source: { kind: 'targetRef', clauseIndex: 0 } },
      },
    }],
  })
})

test.each([
  ['Arcanis the Omnipotent', [['draw'], ['move']]],
  ['Mind Stone', [['draw']]],
  ['Waterlogged Grove', [['draw']]],
  ["Commander's Sphere", [['draw']]],
  ['Expedition Map', [['sequence']]],
  ['Geier Reach Sanitarium', [['draw', 'discard']]],
  ['Oboro, Palace in the Clouds', [['move']]],
  ['Wall of Blood', [['createEffect']]],
] as const)('catalog %s owns its activated programs without legacy registrations', (name, instructionKinds) => {
  expect(effectsFor(name)).toEqual([])
  const abilities = cardRuleDefinitionSnapshotFor(name)!.definition.abilities
  expect(abilities).toHaveLength(instructionKinds.length)
  abilities.forEach((ability, index) => {
    expect(ability.kind).toBe('activated')
    if (ability.kind !== 'activated') throw new Error('expected activated configuration')
    expect(ability.instructions!.map(instruction => instruction.kind)).toEqual([...instructionKinds[index]!])
  })
})

test.each(['Mind Stone', 'Waterlogged Grove', 'Expedition Map'])('catalog %s pays mana and taps before sacrificing itself', name => {
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]).toMatchObject({ costs: [
    { kind: 'mana' }, { kind: 'tapSource' }, { kind: 'sacrifice', filter: { kind: 'contextRef', name: 'source' }, count: { kind: 'constant', value: 1 } },
  ] })
})

test('catalog Arcanis separates tap-to-draw from its mana-paid return', () => {
  expect(cardRuleDefinitionSnapshotFor('Arcanis the Omnipotent')!.definition.abilities).toMatchObject([
    { costs: [{ kind: 'tapSource' }], instructions: [{ kind: 'draw', count: { kind: 'constant', value: 3 } }] },
    { costs: [{ kind: 'mana', amount: '{2}{U}{U}' }], instructions: [{ kind: 'move', targets: { kind: 'contextRef', name: 'source' }, to: 'hand' }] },
  ])
})

test('catalog Geier Reach Sanitarium draws for everyone before each player discards', () => {
  expect(cardRuleDefinitionSnapshotFor('Geier Reach Sanitarium')!.definition.abilities[0]).toMatchObject({ costs: [{ kind: 'mana', amount: '{2}' }, { kind: 'tapSource' }], instructions: [
    { kind: 'draw', count: { kind: 'constant', value: 1 }, targets: { kind: 'players', filter: {} } },
    { kind: 'discard', count: { kind: 'constant', value: 1 }, targets: { kind: 'players', filter: {} } },
  ] })
})

test('catalog Wall of Blood pays one life for a temporary source pump', () => {
  expect(cardRuleDefinitionSnapshotFor('Wall of Blood')!.definition.abilities[0]).toMatchObject({ costs: [{ kind: 'life', amount: { kind: 'constant', value: 1 } }], instructions: [{ kind: 'createEffect', targets: { kind: 'contextRef', name: 'source' }, duration: { kind: 'untilCleanup' }, effect: { kind: 'pump', power: { kind: 'constant', value: 1 }, toughness: { kind: 'constant', value: 1 } } }] })
})


test.each(['Arbor Elf', 'Deserted Temple', "Minamo, School at Water's Edge"])('catalog %s composes a targeted untap with its tap-symbol cost', name => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]).toMatchObject({ kind: 'activated', costs: expect.arrayContaining([{ kind: 'tapSource' }]), instructions: [{ kind: 'untap', targets: { kind: 'targetRef', clauseIndex: 0 } }] })
})

test.each(['Subjugator Angel', 'Githzerai Monk'])('catalog %s taps only other controllers creatures on entry', name => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]).toMatchObject({ kind: 'triggered', on: { kind: 'enters' }, instructions: [{ kind: 'tap', targets: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', not: { controller: 'you' } } } }] })
})

test('catalog Frantic Search draws and discards before a bounded untap choice', () => {
  expect(effectsFor('Frantic Search')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Frantic Search')!.definition.abilities[0]).toMatchObject({ instructions: [
    { kind: 'draw', count: { kind: 'constant', value: 2 } },
    { kind: 'discard', count: { kind: 'constant', value: 2 } },
    { kind: 'chooseCards', filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Land' } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 3 } },
    { kind: 'untap', targets: { kind: 'choiceRef', binding: 'lands' } },
  ] })
})

test('catalog Cryptic Command chooses two modes with separate counter and permanent targets', () => {
  expect(effectsFor('Cryptic Command')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Cryptic Command')!.definition.abilities[0]).toMatchObject({ decisions: { modes: { count: { kind: 'constant', value: 2 }, repeatable: false } }, modes: [
    { decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'spell' } } }] }, instructions: [{ kind: 'counter' }] },
    { decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield' } } }] }, instructions: [{ kind: 'move', to: 'hand' }] },
    { instructions: [{ kind: 'tap' }] },
    { instructions: [{ kind: 'draw', count: { kind: 'constant', value: 1 } }] },
  ] })
})


test.each([
  ['Dimir Signet', ['U', 'B']],
  ['Orzhov Signet', ['W', 'B']],
  ['Simic Signet', ['G', 'U']],
] as const)('catalog %s pays one mana and taps for its exact color pair', (name, colors) => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]).toMatchObject({ kind: 'activated', costs: [{ kind: 'mana', amount: '{1}' }, { kind: 'tapSource' }], instructions: [
    { kind: 'addMana', targets: { kind: 'contextRef', name: 'controller' }, amount: Object.fromEntries(colors.map(color => [color, { kind: 'constant', value: 1 }])) },
  ] })
})


test.each([
  ['Cabal Coffers', '{2}', false],
  ['Cabal Stronghold', '{3}', true],
  ['Magus of the Coffers', '{2}', false],
] as const)('catalog %s counts the required controlled Swamps for its mana', (name, mana, basic) => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]).toMatchObject({ kind: 'activated', costs: [{ kind: 'mana', amount: mana }, { kind: 'tapSource' }], instructions: [{ kind: 'addMana', targets: { kind: 'contextRef', name: 'controller' }, amount: {
    B: { kind: 'count', of: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you', type: 'Land', subtypes: ['Swamp'], ...(basic ? { supertypes: ['Basic'] } : {}) } } },
  } }] })
})


test.each([
  ['Evolving Wilds', true, true, 1, undefined, false],
  ['Terramorphic Expanse', true, true, 1, undefined, false],
  ['Prismatic Vista', true, false, 1, undefined, true],
  ['Esper Panorama', true, true, 1, '{1}', false],
  ['Blighted Woodland', true, true, 2, '{3}{G}', false],
  ['Marsh Flats', false, false, 1, undefined, true],
  ['Misty Rainforest', false, false, 1, undefined, true],
  ['Polluted Delta', false, false, 1, undefined, true],
  ['Verdant Catacombs', false, false, 1, undefined, true],
] as const)('catalog %s composes its fetch costs with a bounded land search', (name, basic, tapped, max, mana, life) => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]).toMatchObject({
    kind: 'activated',
    costs: [
      ...(mana ? [{ kind: 'mana', amount: mana }] : []),
      ...(life ? [{ kind: 'life', amount: { kind: 'constant', value: 1 } }] : []),
      { kind: 'tapSource' },
      { kind: 'sacrifice', filter: { kind: 'contextRef', name: 'source' }, count: { kind: 'constant', value: 1 } },
    ],
    instructions: [{ kind: 'sequence', instructions: [
      { kind: 'chooseCards', filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', type: 'Land', ...(basic ? { supertypes: ['Basic'] } : {}) } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: max } },
      { kind: 'move', to: 'battlefield', ...(tapped ? { tapped: true } : {}) },
      { kind: 'shuffle' },
    ] }],
  })
})


test.each(['Dimir Aqueduct', 'Golgari Rot Farm', 'Orzhov Basilica', 'Simic Growth Chamber'])('catalog %s enters tapped then chooses one controlled land to return', name => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities).toMatchObject([
    { kind: 'static' },
    { kind: 'triggered', on: { kind: 'enters' }, instructions: [
      { kind: 'chooseCards', bindChoice: 'land', chooser: { kind: 'contextRef', name: 'controller' }, filter: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you', type: 'Land' } }, min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 } },
      { kind: 'move', targets: { kind: 'choiceRef', binding: 'land' }, to: 'hand' },
    ] },
  ])
})


test.each([
  ['Brokers Hideout', ['Forest', 'Plains', 'Island']],
  ['Obscura Storefront', ['Plains', 'Island', 'Swamp']],
  ['Riveteers Overlook', ['Swamp', 'Mountain', 'Forest']],
] as const)('catalog %s conditions its basic search and life gain on sacrificing itself', (name, subtypes) => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]).toMatchObject({
    kind: 'triggered', on: { kind: 'enters' }, instructions: [
      { kind: 'sacrifice', targets: { kind: 'contextRef', name: 'source' }, bindResult: 'sacrificed' },
      { kind: 'if', condition: { kind: 'resultIsTrue', value: { kind: 'resultRef', binding: 'sacrificed', field: 'sacrificed' } }, then: [
        { kind: 'sequence', instructions: [
          { kind: 'chooseCards', filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'], any: subtypes.map(subtype => ({ subtypes: [subtype] })) } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 } },
          { kind: 'move', to: 'battlefield', tapped: true },
          { kind: 'shuffle' },
        ] },
        { kind: 'gainLife', amount: { kind: 'constant', value: 1 } },
      ] },
    ],
  })
})


test('catalog Stitch Together returns an owned creature according to its graveyard threshold', () => {
  expect(effectsFor('Stitch Together')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Stitch Together')!.definition.abilities[0]).toMatchObject({ kind: 'spell', decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'graveyard', owner: 'you', type: 'Creature' } } }] }, instructions: [
    { kind: 'if', condition: { kind: 'compareAmount', left: { kind: 'count', of: { kind: 'objects', filter: { zone: 'graveyard', owner: 'you' } } }, operator: 'gte', right: { kind: 'constant', value: 7 } }, then: [{ kind: 'move', to: 'battlefield' }], otherwise: [{ kind: 'move', to: 'hand' }] },
  ] })
})


test('catalog Hedron Archive pays two mana and taps and sacrifices itself for two cards', () => {
  expect(effectsFor('Hedron Archive')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Hedron Archive')!.definition.abilities[0]).toMatchObject({ kind: 'activated', costs: [
    { kind: 'mana', amount: '{2}' }, { kind: 'tapSource' }, { kind: 'sacrifice', filter: { kind: 'contextRef', name: 'source' }, count: { kind: 'constant', value: 1 } },
  ], instructions: [{ kind: 'draw', count: { kind: 'constant', value: 2 }, targets: { kind: 'contextRef', name: 'controller' } }] })
})


test('catalog Thalias Lancers reveals its legendary search result before moving it to hand', () => {
  expect(effectsFor("Thalia's Lancers")).toEqual([])
  expect(cardRuleDefinitionSnapshotFor("Thalia's Lancers")!.definition.abilities[0]).toMatchObject({ kind: 'triggered', on: { kind: 'enters' }, instructions: [
    { kind: 'sequence', instructions: [
      { kind: 'chooseCards', filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', supertypes: ['Legendary'] } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 } },
      { kind: 'reveal', targets: { kind: 'choiceRef', binding: 'found' } },
      { kind: 'move', to: 'hand' }, { kind: 'shuffle' },
    ] },
  ] })
})

test('catalog World Map offers distinct basic and unrestricted land searches at their printed costs', () => {
  expect(effectsFor('World Map')).toEqual([])
  const abilities = cardRuleDefinitionSnapshotFor('World Map')!.definition.abilities
  expect(abilities).toHaveLength(2)
  for (const [index, mana] of ['{1}', '{3}'].entries()) {
    expect(abilities[index]).toMatchObject({ kind: 'activated', costs: [
      { kind: 'mana', amount: mana }, { kind: 'tapSource' }, { kind: 'sacrifice', filter: { kind: 'contextRef', name: 'source' } },
    ], instructions: [{ kind: 'sequence', instructions: [
      { kind: 'chooseCards', filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', type: 'Land', ...(index === 0 ? { supertypes: ['Basic'] } : {}) } } },
      { kind: 'reveal' }, { kind: 'move', to: 'hand' }, { kind: 'shuffle' },
    ] }] })
  }
})


test.each([
  ['Hedge Maze', 'surveil'],
  ['Shadowy Backstreet', 'surveil'],
  ['Undercity Sewers', 'surveil'],
  ['Underground Mortuary', 'surveil'],
  ['Temple of Deceit', 'scry'],
] as const)('catalog %s enters tapped and composes a controller-only %s instruction', (name, kind) => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'replacement', event: { kind: 'enterBattlefield', filter: { object: { kind: 'contextRef', name: 'source' } } }, transform: { kind: 'modifyEvent', changes: { tapped: true } } }] },
    { kind: 'triggered', on: { kind: 'enters', filter: { kind: 'contextRef', name: 'source' } }, instructions: [{ kind, targets: { kind: 'contextRef', name: 'controller' }, count: { kind: 'constant', value: 1 } }] },
  ])
})

test('catalog Triangle of War sacrifices itself for a fight between controlled and opposing creatures', () => {
  expect(effectsFor('Triangle of War')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Triangle of War')!.definition.abilities[0]).toMatchObject({
    kind: 'activated', costs: [{ kind: 'mana', amount: '{2}' }, { kind: 'sacrifice', filter: { kind: 'contextRef', name: 'source' } }],
    decisions: { targets: [
      { filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', controller: 'you' } } },
      { filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', controller: 'opponent' } } },
    ] },
    instructions: [{ kind: 'fight', left: { kind: 'targetRef', clauseIndex: 0 }, right: { kind: 'targetRef', clauseIndex: 1 } }],
  })
})

test('catalog Ulvenwald Tracker taps to fight a controlled creature with a different creature', () => {
  expect(effectsFor('Ulvenwald Tracker')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Ulvenwald Tracker')!.definition.abilities[0]).toMatchObject({
    kind: 'activated', costs: [{ kind: 'mana', amount: '{1}{G}' }, { kind: 'tapSource' }],
    decisions: { targets: [
      { filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', controller: 'you' } } },
      { filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature' } } },
    ], constraints: [{ kind: 'different', clauseIndices: [0, 1] }] },
    instructions: [{ kind: 'fight', left: { kind: 'targetRef', clauseIndex: 0 }, right: { kind: 'targetRef', clauseIndex: 1 } }],
  })
})

test('immediate blink catalog entries preserve targeting and return-controller differences', () => {
  expect(cardTemplateDefaultsFor('Cloudshift')).toMatchObject({ types: ['Instant'], colors: ['W'], manaCost: '{W}', manaValue: 1 })
  expect(cardRuleDefinitionSnapshotFor('Cloudshift')!.definition.abilities).toMatchObject([{
    kind: 'spell', decisions: { targets: [{ min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 }, filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', controller: 'you' } } }] },
    instructions: [{ kind: 'blink', targets: { kind: 'targetRef', clauseIndex: 0 }, returnController: { kind: 'contextRef', name: 'controller' } }],
  }])
  expect(cardTemplateDefaultsFor('Flicker of Fate')).toMatchObject({ types: ['Instant'], colors: ['W'], manaCost: '{1}{W}', manaValue: 2 })
  expect(cardRuleDefinitionSnapshotFor('Flicker of Fate')!.definition.abilities).toMatchObject([{
    kind: 'spell', decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', any: [{ type: 'Creature' }, { type: 'Enchantment' }] } } }] },
    instructions: [{ kind: 'blink', targets: { kind: 'targetRef', clauseIndex: 0 } }],
  }])
})

test('catalog Ghostly Flicker declares exactly two distinct controlled artifact, creature or land targets', () => {
  expect(cardTemplateDefaultsFor('Ghostly Flicker')).toMatchObject({ types: ['Instant'], colors: ['U'], manaCost: '{2}{U}', manaValue: 3 })
  expect(cardRuleDefinitionSnapshotFor('Ghostly Flicker')!.definition.abilities).toMatchObject([{
    kind: 'spell', decisions: { targets: [{ min: { kind: 'constant', value: 2 }, max: { kind: 'constant', value: 2 }, distinct: true,
      filter: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you', any: [{ type: 'Artifact' }, { type: 'Creature' }, { type: 'Land' }] } } }] },
    instructions: [{ kind: 'blink', targets: { kind: 'targetRef', clauseIndex: 0 }, returnController: { kind: 'contextRef', name: 'controller' } }],
  }])
})

test('catalog Felidar Guardian targets another controlled permanent before offering its optional blink', () => {
  expect(effectsFor('Felidar Guardian')).toEqual([])
  expect(cardTemplateDefaultsFor('Felidar Guardian')).toMatchObject({ types: ['Creature'], colors: ['W'], manaCost: '{3}{W}', manaValue: 4 })
  expect(cardRuleDefinitionSnapshotFor('Felidar Guardian')!.definition.abilities).toMatchObject([{
    kind: 'triggered', on: { kind: 'enters', filter: { kind: 'contextRef', name: 'source' } },
    decisions: { targets: [{ min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 }, filter: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you', other: true } } }] },
    instructions: [{ kind: 'chooseInstructions', optional: true, options: [
      { instructions: [{ kind: 'blink', targets: { kind: 'targetRef', clauseIndex: 0 } }] },
      { instructions: [] },
    ] }],
  }])
})

test('catalog Restoration Angel composes flash, flying and optional controlled non-Angel blink', () => {
  expect(effectsFor('Restoration Angel')).toEqual([])
  expect(cardTemplateDefaultsFor('Restoration Angel')).toMatchObject({ types: ['Creature'], subtypes: ['Angel'], colors: ['W'], manaCost: '{3}{W}', manaValue: 4 })
  expect(cardRuleDefinitionSnapshotFor('Restoration Angel')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: 'flash' },
    { kind: 'keyword', keyword: 'flying' },
    { kind: 'triggered', on: { kind: 'enters', filter: { kind: 'contextRef', name: 'source' } }, decisions: { targets: [{
      min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 },
      filter: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you', type: 'Creature', not: { subtypes: ['Angel'] } } },
    }] }, instructions: [{ kind: 'chooseInstructions', optional: true, options: [
      { instructions: [{ kind: 'blink', targets: { kind: 'targetRef', clauseIndex: 0 }, returnController: { kind: 'contextRef', name: 'controller' } }] },
      { instructions: [] },
    ] }] },
  ])
})

test('catalog Banisher Priest exiles an opponent creature until it leaves', () => {
  expect(effectsFor('Banisher Priest')).toEqual([])
  expect(cardTemplateDefaultsFor('Banisher Priest')).toMatchObject({
    types: ['Creature'],
    subtypes: ['Human', 'Cleric'],
    colors: ['W'],
    manaCost: '{1}{W}{W}',
    manaValue: 3,
  })
  expect(cardRuleDefinitionSnapshotFor('Banisher Priest')!.definition.abilities).toMatchObject([{
    kind: 'triggered',
    on: { kind: 'enters' },
    decisions: { targets: [{
      min: { kind: 'constant', value: 1 },
      max: { kind: 'constant', value: 1 },
      filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', controller: 'opponent' } },
    }] },
    instructions: [{ kind: 'linkExile', targets: { kind: 'targetRef', clauseIndex: 0 }, untilSourceLeaves: true }],
  }])
})

test('catalog Werefox Bodyguard optionally cages a non-Fox and may sacrifice for life', () => {
  expect(effectsFor('Werefox Bodyguard')).toEqual([])
  expect(cardTemplateDefaultsFor('Werefox Bodyguard')).toMatchObject({
    types: ['Creature'],
    subtypes: ['Elf', 'Fox', 'Knight'],
    colors: ['W'],
    manaCost: '{1}{W}{W}',
    manaValue: 3,
  })
  expect(cardRuleDefinitionSnapshotFor('Werefox Bodyguard')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: 'flash' },
    {
      kind: 'triggered',
      on: { kind: 'enters' },
      decisions: { targets: [{
        min: { kind: 'constant', value: 0 },
        max: { kind: 'constant', value: 1 },
        filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', other: true, not: { subtypes: ['Fox'] } } },
      }] },
      instructions: [{ kind: 'linkExile', targets: { kind: 'targetRef', clauseIndex: 0 }, untilSourceLeaves: true }],
    },
    {
      kind: 'activated',
      costs: [
        { kind: 'mana', amount: '{1}{W}' },
        { kind: 'sacrifice', filter: { kind: 'contextRef', name: 'source' } },
      ],
      instructions: [{ kind: 'gainLife', amount: { kind: 'constant', value: 2 } }],
    },
  ])
})

test('catalog Fiend Hunter links a separate leave trigger rather than until-leaves', () => {
  expect(effectsFor('Fiend Hunter')).toEqual([])
  expect(cardTemplateDefaultsFor('Fiend Hunter')).toMatchObject({
    types: ['Creature'],
    subtypes: ['Human', 'Cleric'],
    colors: ['W'],
    manaCost: '{1}{W}{W}',
    manaValue: 3,
  })
  expect(cardRuleDefinitionSnapshotFor('Fiend Hunter')!.definition.abilities).toMatchObject([
    {
      kind: 'triggered',
      on: { kind: 'enters' },
      decisions: { targets: [{
        min: { kind: 'constant', value: 0 },
        max: { kind: 'constant', value: 1 },
        filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', other: true } },
      }] },
      instructions: [{ kind: 'linkExile', targets: { kind: 'targetRef', clauseIndex: 0 } }],
    },
    {
      kind: 'triggered',
      on: { kind: 'leaves' },
      instructions: [{ kind: 'returnLinkedExile' }],
    },
  ])
})

test('catalog Githzerai Monk declares flash and flying alongside its entry instruction', () => {
  expect(cardTemplateDefaultsFor('Githzerai Monk')).toMatchObject({ subtypes: ['Gith', 'Monk'] })
  expect(cardRuleDefinitionSnapshotFor('Githzerai Monk')!.definition.abilities).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'keyword', keyword: 'flash' }),
    expect.objectContaining({ kind: 'keyword', keyword: 'flying' }),
  ]))
})

test.each([
  ['Flickerwisp', 'triggered', { zone: 'battlefield', other: true }, 1],
  ['Guardian of Ghirapur', 'triggered', { zone: 'battlefield', controller: 'you', other: true, any: [{ type: 'Creature' }, { type: 'Artifact' }] }, 0],
  ['Voyager Staff', 'activated', { zone: 'battlefield', type: 'Creature' }, 1],
] as const)('catalog %s composes a bounded target with a non-targeting delayed owner return', (name, kind, filter, min) => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities).toEqual(expect.arrayContaining([expect.objectContaining({
    kind,
    decisions: expect.objectContaining({ targets: [expect.objectContaining({ filter: { kind: 'objects', filter }, min: { kind: 'constant', value: min }, max: { kind: 'constant', value: 1 } })] }),
    instructions: [{ kind: 'sequence', instructions: [
      { kind: 'move', targets: { kind: 'targetRef', clauseIndex: 0 }, to: 'exile', bindChoice: 'exiled' },
      { kind: 'createDelayed', inheritTargets: false, condition: { kind: 'step', step: 'end' }, instructions: [{ kind: 'move', targets: { kind: 'choiceRef', binding: 'exiled' }, to: 'battlefield' }] },
    ] }],
  })]))
  if (kind === 'activated') expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]).toMatchObject({ costs: [{ kind: 'mana', amount: '{2}' }, { kind: 'sacrifice', filter: { kind: 'contextRef', name: 'source' } }] })
  else expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'keyword', keyword: 'flying' })]))
})


test.each([['Explore', 1], ['Summer Bloom', 3]] as const)('%s grants its printed additional land plays', (name, count) => {
  const ability = cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]!
  expect(ability.kind).toBe('spell')
  if (ability.kind !== 'spell') throw new Error('expected spell')
  expect(ability.instructions?.[0]).toEqual({ kind: 'grantLandPlays', count: { kind: 'constant', value: count }, targets: { kind: 'contextRef', name: 'controller' } })
  expect(cardTemplateDefaultsFor(name)).toMatchObject({ types: ['Sorcery'], colors: ['G'], manaCost: '{1}{G}', manaValue: 2 })
})


test.each(['Long Road Home', 'Otherworldly Journey'])('%s returns the exiled creature with an entry counter', name => {
  expect(cardTemplateDefaultsFor(name)).toMatchObject({ types: ['Instant'], colors: ['W'], manaCost: '{1}{W}', manaValue: 2 })
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature' } }, min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 } }] },
    instructions: [{ kind: 'sequence', instructions: [
      { kind: 'move', targets: { kind: 'targetRef', clauseIndex: 0 }, to: 'exile', bindChoice: 'exiled' },
      { kind: 'createDelayed', inheritTargets: false, condition: { kind: 'step', step: 'end' }, instructions: [
        { kind: 'move', targets: { kind: 'choiceRef', binding: 'exiled' }, to: 'battlefield', enterCounters: { '+1/+1': { kind: 'constant', value: 1 } } },
      ] },
    ] }],
  })
})


test('Infernal Contract composes four draws with rounded-up half-life loss', () => {
  expect(cardTemplateDefaultsFor('Infernal Contract')).toMatchObject({ types: ['Sorcery'], colors: ['B'], manaCost: '{B}{B}{B}', manaValue: 3 })
  expect(cardRuleDefinitionSnapshotFor('Infernal Contract')!.definition.abilities[0]).toMatchObject({
    kind: 'spell', instructions: [
      { kind: 'draw', count: { kind: 'constant', value: 4 } },
      { kind: 'loseLife', targets: { kind: 'contextRef', name: 'controller' }, amount: {
        kind: 'divide', value: { kind: 'characteristic', of: { kind: 'contextRef', name: 'controller' }, characteristic: 'life', information: 'current' }, by: 2, rounding: ROUNDING_MODES.up,
      } },
    ],
  })
})


test.each([
  ['High Market', [['tapSource'], ['tapSource', 'sacrifice']], [['addMana'], ['gainLife']]],
  ['Trade Routes', [['mana'], ['mana', 'discard']], [['move'], ['draw']]],
  ['Sakura-Tribe Scout', [['tapSource']], [['chooseCards', 'move']]],
] as const)('%s composes canonical utility activations', (name, costs, programs) => {
  expect(effectsFor(name)).toEqual([])
  const abilities = cardRuleDefinitionSnapshotFor(name)!.definition.abilities
  expect(abilities.map(ability => ability.kind)).toEqual(costs.map(() => 'activated'))
  expect(abilities.map(ability => ability.kind === 'activated' ? ability.costs.map(cost => cost.kind) : [])).toEqual(costs.map(group => [...group]))
  expect(abilities.map(ability => ability.kind === 'activated' ? ability.instructions?.map(instruction => instruction.kind) : [])).toEqual(programs.map(group => [...group]))
})


test.each([
  ['Meteor Golem', ['triggered']], ['Bojuka Bog', ['static', 'triggered', 'activated']],
  ['Hedron Crab', ['triggered']], ['Thorn Mammoth', ['keyword', 'triggered']],
  ['Join the Dead', ['spell']], ['Deathsprout', ['spell']],
] as const)('%s declares canonical targeted programs', (name, kinds) => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities.map(ability => ability.kind)).toEqual([...kinds])
})

test('graveyard-exile and landfall catalog entries bind their chosen player', () => {
  expect(cardRuleDefinitionSnapshotFor('Bojuka Bog')!.definition.abilities[1]).toMatchObject({
    kind: 'triggered', instructions: [{ kind: 'move', to: 'exile', targets: { kind: 'objects', filter: { zone: 'graveyard', owner: { kind: 'targetRef', clauseIndex: 0 } } } }],
  })
  expect(cardRuleDefinitionSnapshotFor('Hedron Crab')!.definition.abilities[0]).toMatchObject({
    kind: 'triggered', on: { kind: 'enters', filter: { type: 'Land', controller: 'you' } }, instructions: [{ kind: 'mill', count: { kind: 'constant', value: 3 }, targets: { kind: 'targetRef', clauseIndex: 0 } }],
  })
})

test('Thorn Mammoth fights up to one uncontrolled creature for every controlled creature entry', () => {
  expect(cardRuleDefinitionSnapshotFor('Thorn Mammoth')!.definition.abilities[1]).toMatchObject({
    kind: 'triggered', on: { kind: 'enters', filter: { type: 'Creature', controller: 'you' } },
    decisions: { targets: [{ min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 }, filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', not: { controller: 'you' } } } }] },
    instructions: [{ kind: 'fight', left: { kind: 'contextRef', name: 'source' }, right: { kind: 'targetRef', clauseIndex: 0 } }],
  })
})

test.each([
  'Apex Altisaur',
  'Blitzball',
  'Breena, the Demagogue',
  'Grothama, All-Devouring',
  'Kogla, the Titan Ape',
  'Souls of the Faultless',
] as const)('catalog %s composes canonical combat-damage programs without legacy effects', name => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)).toBeDefined()
})

test('Apex Altisaur fights on entry and whenever it is dealt damage', () => {
  const abilities = cardRuleDefinitionSnapshotFor('Apex Altisaur')!.definition.abilities
  expect(abilities.map(ability => ability.kind)).toEqual(['triggered', 'triggered'])
  expect(abilities[0]).toMatchObject({ on: { kind: 'enters' }, instructions: [{ kind: 'fight' }] })
  expect(abilities[1]).toMatchObject({ on: { kind: 'dealtDamage' }, instructions: [{ kind: 'fight' }] })
})

test('Souls of the Faultless converts combat damage into life swing against the attacker', () => {
  const abilities = cardRuleDefinitionSnapshotFor('Souls of the Faultless')!.definition.abilities
  expect(abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'defender' })
  expect(abilities[1]).toMatchObject({
    kind: 'triggered',
    on: { kind: 'dealtDamage', filter: { combat: true } },
    instructions: [{ kind: 'gainLife' }, { kind: 'loseLife' }],
  })
})

test('Blitzball taps for any color and sacrifices after legendary combat damage', () => {
  const abilities = cardRuleDefinitionSnapshotFor('Blitzball')!.definition.abilities
  expect(abilities[0]).toMatchObject({ kind: 'activated', costs: [{ kind: 'tapSource' }] })
  expect(abilities[1]).toMatchObject({
    kind: 'activated',
    when: { kind: 'combatDamageThisTurn', legendary: true },
    instructions: [{ kind: 'draw', count: { kind: 'constant', value: 2 } }],
  })
})

test('Breena rewards attacks on a richer opponent', () => {
  const abilities = cardRuleDefinitionSnapshotFor('Breena, the Demagogue')!.definition.abilities
  expect(abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'flying' })
  expect(abilities[1]).toMatchObject({
    kind: 'triggered',
    on: { kind: 'playerAttacks' },
    interveningIf: { kind: 'somePlayerHasLess', metric: 'life' },
    instructions: [{ kind: 'draw' }, { kind: 'chooseCards' }, { kind: 'putCounters' }],
  })
})

test('Kogla fights on entry, destroys a defending-player permanent, and bounces a Human', () => {
  const abilities = cardRuleDefinitionSnapshotFor('Kogla, the Titan Ape')!.definition.abilities
  expect(abilities.map(ability => ability.kind)).toEqual(['triggered', 'triggered', 'activated'])
  expect(abilities[0]).toMatchObject({ on: { kind: 'enters' }, instructions: [{ kind: 'fight' }] })
  expect(abilities[1]).toMatchObject({ on: { kind: 'attacks' }, instructions: [{ kind: 'destroy' }] })
  expect(abilities[2]).toMatchObject({ kind: 'activated', instructions: [{ kind: 'move' }, { kind: 'createEffect' }] })
})

test('Grothama grants an optional fight and pays out source-attributed damage', () => {
  const abilities = cardRuleDefinitionSnapshotFor('Grothama, All-Devouring')!.definition.abilities
  expect(abilities[0]).toMatchObject({
    kind: 'static',
    effects: [{ kind: 'grantAbility', ability: { on: { kind: 'attacks' } } }],
  })
  expect(abilities[1]).toMatchObject({
    kind: 'triggered',
    on: { kind: 'leaves' },
    instructions: [{ kind: 'forEachPlayer' }],
  })
})


test.each([
  ['Awaken the Woods', ['createToken']], ['Hatred', ['createEffect']], ['Toxic Deluge', ['createEffect']],
  ["Black Sun's Twilight", ['createEffect', 'if']],
] as const)('%s declares canonical X programs', (name, kinds) => {
  expect(effectsFor(name)).toEqual([])
  const ability = cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]!
  if (ability.kind !== 'spell') throw new Error('expected spell')
  expect(ability.decisions.variables?.map(variable => variable.name)).toEqual(['X'])
  expect(ability.instructions?.map(instruction => instruction.kind)).toEqual([...kinds])
})

test('X catalog cards preserve their life costs, signed deltas and land-creature token characteristics', () => {
  for (const name of ['Hatred', 'Toxic Deluge']) expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities[0]).toMatchObject({ costs: [{ kind: 'life', amount: { kind: 'variable', name: 'X' } }] })
  expect(cardRuleDefinitionSnapshotFor('Toxic Deluge')!.definition.abilities[0]).toMatchObject({ instructions: [{ kind: 'createEffect', targets: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature' } }, effect: { kind: 'pump', power: { kind: 'negate', value: { kind: 'variable', name: 'X' } }, toughness: { kind: 'negate', value: { kind: 'variable', name: 'X' } } } }] })
  expect(cardTemplateDefaultsFor("Black Sun's Twilight")).toMatchObject({ types: ['Instant'], manaCost: '{X}{B}', manaValue: 1 })
  expect(cardRuleDefinitionSnapshotFor("Black Sun's Twilight")!.definition.abilities[0]).toMatchObject({
    decisions: { targets: [{ min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 } }] },
    instructions: [
      { kind: 'createEffect', effect: { kind: 'pump' } },
      { kind: 'if', condition: { kind: 'compareAmount', operator: 'gte' }, then: [{ kind: 'chooseCards' }, { kind: 'move', to: 'battlefield', tapped: true }] },
    ],
  })
  expect(cardRuleDefinitionSnapshotFor('Awaken the Woods')!.definition.abilities[0]).toMatchObject({ instructions: [{ kind: 'createToken', count: { kind: 'variable', name: 'X' }, token: { name: 'Forest Dryad', types: ['Land', 'Creature'], subtypes: ['Forest', 'Dryad'], colors: ['G'], power: 1, toughness: 1 } }] })
})

test('Gilded Lotus offers exactly five single-color three-mana programs', () => {
  const ability = cardRuleDefinitionSnapshotFor('Gilded Lotus')!.definition.abilities[0]
  expect(ability).toMatchObject({ kind: 'activated', costs: [{ kind: 'tapSource' }] })
  if (ability.kind !== 'activated') throw new Error('Expected activated ability')
  expect(ability.instructions).toEqual([expect.objectContaining({
    kind: 'chooseInstructions',
    options: ['W', 'U', 'B', 'R', 'G'].map((color) => ({
      label: color,
      instructions: [{ kind: 'addMana', targets: { kind: 'contextRef', name: 'controller' }, amount: { [color]: { kind: 'constant', value: 3 } } }],
    })),
  })])
})

test("Urza's Cave composes its mana ability and sacrificed tapped land search", () => {
  expect(cardRuleDefinitionSnapshotFor("Urza's Cave")!.definition.abilities).toMatchObject([
    { kind: 'activated', costs: [{ kind: 'tapSource' }], instructions: [{ kind: 'addMana', amount: { C: { kind: 'constant', value: 1 } } }] },
    { kind: 'activated', costs: [{ kind: 'mana' }, { kind: 'tapSource' }, { kind: 'sacrifice' }], instructions: [{ kind: 'sequence', instructions: [
      { kind: 'chooseCards', filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', type: 'Land' } } },
      { kind: 'move', to: 'battlefield', tapped: true }, { kind: 'shuffle' },
    ] }] },
  ])
})

test("Thrór's Map composes a revealed basic search and draw-before-discard activation", () => {
  expect(cardRuleDefinitionSnapshotFor("Thrór's Map")!.definition.abilities).toMatchObject([
    { kind: 'triggered', instructions: [{ kind: 'sequence', instructions: [
      { kind: 'chooseCards', filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] } } },
      { kind: 'reveal' }, { kind: 'move', to: 'hand' }, { kind: 'shuffle' },
    ] }] },
    { kind: 'activated', costs: [{ kind: 'mana' }, { kind: 'tapSource' }], instructions: [
      { kind: 'draw', count: { kind: 'constant', value: 1 } },
      { kind: 'discard', count: { kind: 'constant', value: 1 } },
    ] },
  ])
})

test('Thawing Glaciers enters tapped and schedules its return after the basic land search', () => {
  expect(cardRuleDefinitionSnapshotFor('Thawing Glaciers')!.definition.abilities).toMatchObject([
    { kind: 'static' },
    { kind: 'activated', costs: [{ kind: 'mana' }, { kind: 'tapSource' }], instructions: [
      { kind: 'sequence', instructions: [
        { kind: 'chooseCards', min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 }, filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] } } },
        { kind: 'move', to: 'battlefield', tapped: true }, { kind: 'shuffle' },
      ] },
      { kind: 'createDelayed', condition: { kind: 'step', step: 'cleanup' }, instructions: [{ kind: 'move', targets: { kind: 'contextRef', name: 'source' }, to: 'hand' }] },
    ] },
  ])
})

test.each(["Collector's Vault", 'Daily Bugle Newspaper'])('%s draws, discards, then creates an artifact mana token', name => {
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities).toMatchObject([
    { kind: 'activated', costs: [{ kind: 'mana', amount: '{2}' }, { kind: 'tapSource' }], instructions: [
      { kind: 'draw', count: { kind: 'constant', value: 1 } },
      { kind: 'discard', count: { kind: 'constant', value: 1 } },
      { kind: 'createToken', count: { kind: 'constant', value: 1 }, token: { name: 'Treasure', types: ['Artifact'], subtypes: ['Treasure'], colors: [] } },
    ] },
  ])
})

test('Dreamscape Artist pays discard before land sacrifice and searches for up to two untapped basics', () => {
  expect(cardRuleDefinitionSnapshotFor('Dreamscape Artist')!.definition.abilities).toMatchObject([
    { kind: 'activated', costs: [
      { kind: 'mana', amount: '{2}{U}' }, { kind: 'tapSource' },
      { kind: 'discard', filter: { kind: 'objects', filter: { zone: 'hand', owner: 'you' } } },
      { kind: 'sacrifice', filter: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you', type: 'Land' } } },
    ], instructions: [{ kind: 'sequence', instructions: [
      { kind: 'chooseCards', min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 2 }, filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] } } },
      { kind: 'move', to: 'battlefield' }, { kind: 'shuffle' },
    ] }] },
  ])
})

test('Hermit Druid reveals through a basic land, putting the rest into the graveyard', () => {
  expect(cardRuleDefinitionSnapshotFor('Hermit Druid')!.definition.abilities).toMatchObject([
    { kind: 'activated', costs: [{ kind: 'mana', amount: '{G}' }, { kind: 'tapSource' }], instructions: [
      { kind: 'revealUntil', match: { kind: 'objects', filter: { zone: 'library', type: 'Land', supertypes: ['Basic'] } }, foundTo: 'hand', rest: REVEAL_UNTIL_REST.graveyard },
    ] },
  ])
})

test('End-Raze Forerunners has native combat keywords and grants only other controlled creatures temporary bonuses', () => {
  const abilities = cardRuleDefinitionSnapshotFor('End-Raze Forerunners')!.definition.abilities
  expect(abilities.slice(0, 3)).toEqual([KEYWORDS.vigilance, KEYWORDS.trample, KEYWORDS.haste].map(keyword => ({ kind: 'keyword', keyword })))
  const trigger = abilities[3]
  expect(trigger).toMatchObject({ kind: 'triggered', on: { kind: 'enters' } })
  if (trigger.kind !== 'triggered') throw new Error('Expected entry trigger')
  expect(trigger.instructions).toEqual([
    { kind: 'pump', power: { kind: 'constant', value: 2 }, toughness: { kind: 'constant', value: 2 } },
    { kind: 'grantKeyword', keyword: KEYWORDS.vigilance },
    { kind: 'grantKeyword', keyword: KEYWORDS.trample },
  ].map(effect => expect.objectContaining({
    kind: 'createEffect', targets: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you', type: 'Creature', other: true } }, effect, duration: { kind: 'untilCleanup' },
  })))
})

test('Blood Celebrant pays black mana and life before choosing one of five colors', () => {
  expect(cardRuleDefinitionSnapshotFor('Blood Celebrant')!.definition.abilities).toMatchObject([
    { kind: 'activated', costs: [{ kind: 'mana', amount: '{B}' }, { kind: 'life', amount: { kind: 'constant', value: 1 } }], instructions: [{
      kind: 'chooseInstructions',
      options: CARD_COLORS.map(color => ({ label: color, instructions: [{ kind: 'addMana', amount: { [color]: { kind: 'constant', value: 1 } }, targets: { kind: 'contextRef', name: 'controller' } }] })),
    }] },
  ])
})

test('Skull Prophet offers two canonical mana modes and mills as an instruction rather than a cost', () => {
  expect(cardRuleDefinitionSnapshotFor('Skull Prophet')!.definition.abilities).toMatchObject([
    { kind: 'activated', costs: [{ kind: 'tapSource' }], decisions: { modes: { count: { kind: 'constant', value: 1 } } }, modes: ['B', 'G'].map(color => ({
      instructions: [{ kind: 'addMana', targets: { kind: 'contextRef', name: 'controller' }, amount: { [color]: { kind: 'constant', value: 1 } } }],
    })) },
    { kind: 'activated', costs: [{ kind: 'tapSource' }], instructions: [{ kind: 'mill', targets: { kind: 'contextRef', name: 'controller' }, count: { kind: 'constant', value: 2 } }] },
  ])
})

test('Beast Whisperer draws for its controller casting a creature spell', () => {
  expect(cardRuleDefinitionSnapshotFor('Beast Whisperer')!.definition.abilities).toMatchObject([
    { kind: 'triggered', activeIn: ['battlefield'], on: { kind: 'cast', filter: { type: 'Creature', controller: 'you' } }, instructions: [{ kind: 'draw', count: { kind: 'constant', value: 1 } }] },
  ])
})

test('World Shaper optionally mills on its own attack and returns only owned graveyard lands tapped on death', () => {
  expect(cardRuleDefinitionSnapshotFor('World Shaper')!.definition.abilities).toMatchObject([
    { kind: 'triggered', on: { kind: 'attacks', filter: { kind: 'contextRef', name: 'source' } }, instructions: [{ kind: 'chooseInstructions', optional: true, options: [{ instructions: [{ kind: 'mill', count: { kind: 'constant', value: 3 }, targets: { kind: 'contextRef', name: 'controller' } }] }, { instructions: [] }] }] },
    { kind: 'triggered', on: { kind: 'dies' }, instructions: [{ kind: 'move', targets: { kind: 'objects', filter: { zone: 'graveyard', owner: 'you', type: 'Land' } }, to: 'battlefield', tapped: true }] },
  ])
})


test('protection cards compose canonical keywords, target restrictions, and temporary grants', () => {
  expect(cardRuleDefinitionSnapshotFor('Spearbreaker Behemoth')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: KEYWORDS.indestructible },
    { kind: 'activated', costs: [{ kind: 'mana', amount: '{1}' }], decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', powerAtLeast: 5 } } }] }, instructions: [{ kind: 'createEffect', effect: { kind: 'grantKeyword', keyword: KEYWORDS.indestructible }, duration: { kind: 'untilCleanup' } }] },
  ])
  expect(cardRuleDefinitionSnapshotFor("Tamiyo's Safekeeping")!.definition.abilities).toMatchObject([
    { kind: 'spell', decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you' } } }] }, instructions: [
      ...[KEYWORDS.hexproof, KEYWORDS.indestructible].map(keyword => ({ kind: 'createEffect', targets: { kind: 'targetRef', clauseIndex: 0 }, effect: { kind: 'grantKeyword', keyword }, duration: { kind: 'untilCleanup' } })),
      { kind: 'gainLife', amount: { kind: 'constant', value: 2 }, targets: { kind: 'contextRef', name: 'controller' } },
    ] },
  ])
})

test('catalog Nezahal composes uncounterable, hand size, a cast trigger, and a discard blink', () => {
  expect(effectsFor('Nezahal, Primal Tide')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Nezahal, Primal Tide')!.definition.abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'cannotBeCountered' }, { kind: 'noMaximumHandSize' }] },
    { kind: 'triggered', on: { kind: 'cast', filter: { controller: 'opponent', not: { type: 'Creature' } } }, instructions: [{ kind: 'draw' }] },
    { kind: 'activated', costs: [{ kind: 'discard', count: { kind: 'constant', value: 3 } }], instructions: [
      { kind: 'move', to: 'exile' },
      { kind: 'createDelayed', condition: { kind: 'step', step: 'end' } },
    ] },
  ])
})

test('green utility spells use scoped modal targets and ordered land choices', () => {
  expect(cardRuleDefinitionSnapshotFor('Bushwhack')!.definition.abilities).toMatchObject([
    { kind: 'spell', decisions: { modes: { count: { kind: 'constant', value: 1 }, repeatable: false } }, modes: [
      { instructions: [{ kind: 'sequence', instructions: [
        { kind: 'chooseCards', filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 } },
        { kind: 'reveal', targets: { kind: 'choiceRef', binding: 'land' } }, { kind: 'move', to: 'hand' }, { kind: 'shuffle' },
      ] }] },
      { decisions: { targets: [
        { filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', controller: 'you' } } },
        { filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', not: { controller: 'you' } } } },
      ] }, instructions: [{ kind: 'fight', left: { kind: 'targetRef', clauseIndex: 0 }, right: { kind: 'targetRef', clauseIndex: 1 } }] },
    ] },
  ])
  expect(cardRuleDefinitionSnapshotFor('Broken Bond')!.definition.abilities).toMatchObject([
    { kind: 'spell', decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', any: [{ type: 'Artifact' }, { type: 'Enchantment' }] } } }] }, instructions: [
      { kind: 'destroy', targets: { kind: 'targetRef', clauseIndex: 0 } },
      { kind: 'chooseCards', bindChoice: 'land', chooser: { kind: 'contextRef', name: 'controller' }, filter: { kind: 'objects', filter: { zone: 'hand', owner: 'you', type: 'Land' } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 } },
      { kind: 'move', targets: { kind: 'choiceRef', binding: 'land' }, to: 'battlefield' },
    ] },
  ])
})


test('Reanimate captures graveyard mana value before returning a creature under its caster’s control', () => {
  expect(cardRuleDefinitionSnapshotFor('Reanimate')!.definition.abilities).toMatchObject([
    { kind: 'spell', decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'graveyard', type: 'Creature' } } }] }, instructions: [
      { kind: 'captureAmount', bindResult: 'manaValue', amount: { kind: 'characteristic', of: { kind: 'targetRef', clauseIndex: 0 }, characteristic: 'manaValue', information: 'current' } },
      { kind: 'move', targets: { kind: 'targetRef', clauseIndex: 0 }, to: 'battlefield', controller: { kind: 'contextRef', name: 'controller' } },
      { kind: 'loseLife', targets: { kind: 'contextRef', name: 'controller' }, amount: { kind: 'resultRef', binding: 'manaValue', field: 'amount' } },
    ] },
  ])
})


test.each([
  ['Khalni Ambush // Khalni Territory', 'Khalni Ambush', 'Khalni Territory'],
  ['Revitalizing Repast // Old-Growth Grove', 'Revitalizing Repast', 'Old-Growth Grove'],
  ['Waterlogged Teachings // Inundated Archive', 'Waterlogged Teachings', 'Inundated Archive'],
])('modal catalog %s pins independent front and land programs', (combined, front, back) => {
  expect(effectsFor(combined)).toEqual([])
  const entry = cardTemplateDefaultsFor(combined)!
  expect(entry).toEqual(cardTemplateDefaultsFor(front)!)
  expect(entry.frontFace!.ruleDefinition).toEqual(entry.ruleDefinition)
  expect(entry.backFace!.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor(back)!)
  expect(entry.ruleDefinition.definition.abilities[0].kind).toBe('spell')
  expect(entry.backFace!.ruleDefinition!.definition.abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'replacement', event: { kind: 'enterBattlefield' }, transform: { kind: 'modifyEvent', changes: { tapped: true } } }] },
    { kind: 'activated', costs: [{ kind: 'tapSource' }] },
  ])
})

test('green modal spell fronts compose their fight and protection instructions', () => {
  expect(cardRuleDefinitionSnapshotFor('Khalni Ambush')!.definition.abilities).toMatchObject([
    { kind: 'spell', decisions: { targets: [
      { filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', controller: 'you' } } },
      { filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', not: { controller: 'you' } } } },
    ] }, instructions: [{ kind: 'fight', left: { kind: 'targetRef', clauseIndex: 0 }, right: { kind: 'targetRef', clauseIndex: 1 } }] },
  ])
  expect(cardRuleDefinitionSnapshotFor('Revitalizing Repast')!.definition.abilities).toMatchObject([
    { kind: 'spell', decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature' } } }] }, instructions: [
      { kind: 'putCounters', targets: { kind: 'targetRef', clauseIndex: 0 }, counter: '+1/+1', count: { kind: 'constant', value: 1 } },
      { kind: 'createEffect', targets: { kind: 'targetRef', clauseIndex: 0 }, effect: { kind: 'grantKeyword', keyword: KEYWORDS.indestructible }, duration: { kind: 'untilCleanup' } },
    ] },
  ])
  expect(cardRuleDefinitionSnapshotFor('Old-Growth Grove')!.definition.abilities[1]).toMatchObject({ kind: 'activated', decisions: { modes: { count: { kind: 'constant', value: 1 }, repeatable: false } }, modes: ['B', 'G'].map(color => ({ instructions: [{ kind: 'addMana', amount: { [color]: { kind: 'constant', value: 1 } } }] })) })
  expect(cardRuleDefinitionSnapshotFor('Khalni Territory')!.definition.abilities[1]).toMatchObject({ kind: 'activated', instructions: [{ kind: 'addMana', amount: { G: { kind: 'constant', value: 1 } } }] })
  expect(cardRuleDefinitionSnapshotFor('Inundated Archive')!.definition.abilities[1]).toMatchObject({ kind: 'activated', decisions: { modes: { count: { kind: 'constant', value: 1 }, repeatable: false } }, modes: ['U', 'B'].map(color => ({ instructions: [{ kind: 'addMana', amount: { [color]: { kind: 'constant', value: 1 } } }] })) })
})


test('Lotus Field uses native hexproof, tapped entry, a resolution sacrifice, and one-color mana', () => {
  expect(cardRuleDefinitionSnapshotFor('Lotus Field')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: KEYWORDS.hexproof },
    { kind: 'static', effects: [{ kind: 'replacement', event: { kind: 'enterBattlefield' }, transform: { kind: 'modifyEvent', changes: { tapped: true } } }] },
    { kind: 'triggered', on: { kind: 'enters' }, instructions: [
      { kind: 'chooseCards', bindChoice: 'lands', filter: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you', type: 'Land' } }, min: { kind: 'constant', value: 2 }, max: { kind: 'constant', value: 2 } },
      { kind: 'sacrifice', targets: { kind: 'choiceRef', binding: 'lands' } },
    ] },
    { kind: 'activated', costs: [{ kind: 'tapSource' }], instructions: [{ kind: 'chooseInstructions', options: CARD_COLORS.map(color => ({ label: color, instructions: [{ kind: 'addMana', targets: { kind: 'contextRef', name: 'controller' }, amount: { [color]: { kind: 'constant', value: 3 } } }] })) }] },
  ])
})

test('Entish Restoration sacrifices on resolution before checking power for its basic-land search', () => {
  const ability = cardRuleDefinitionSnapshotFor('Entish Restoration')!.definition.abilities[0]
  expect(ability).toMatchObject({ kind: 'spell', costs: [], instructions: [
    { kind: 'chooseCards', bindChoice: 'sacrificedLand', filter: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you', type: 'Land' } }, min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 } },
    { kind: 'sacrifice', targets: { kind: 'choiceRef', binding: 'sacrificedLand' } },
    { kind: 'if', condition: { kind: 'compareAmount', left: { kind: 'count', of: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you', type: 'Creature', powerAtLeast: 4 } } }, operator: 'gte', right: { kind: 'constant', value: 1 } } },
  ] })
  if (ability.kind !== 'spell' || !ability.instructions || ability.instructions[2].kind !== 'if') throw new Error('Expected conditional search')
  const instruction = ability.instructions[2]
  for (const [branch, maximum] of [[instruction.then, 3], [instruction.otherwise, 2]] as const) expect(branch).toMatchObject([
    { kind: 'sequence', instructions: [
      { kind: 'chooseCards', filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: maximum } },
      { kind: 'move', to: 'battlefield', tapped: true },
      { kind: 'shuffle' },
    ] },
  ])
})

test('Liliana’s Caress uses the discarded-card occurrence and the discarding opponent', () => {
  expect(cardRuleDefinitionSnapshotFor("Liliana's Caress")!.definition.abilities).toMatchObject([
    { kind: 'triggered', on: { kind: 'discard', filter: { player: { kind: 'players', filter: { relation: 'opponent' } } } }, instructions: [{ kind: 'loseLife', targets: { kind: 'contextRef', name: 'triggering.player' }, amount: { kind: 'constant', value: 2 } }] },
  ])
})


test('Amulet of Vigor filters tapped controlled entries and untaps the captured entrant without targeting', () => {
  expect(cardRuleDefinitionSnapshotFor('Amulet of Vigor')!.definition.abilities).toMatchObject([
    { kind: 'triggered', on: { kind: 'enters', filter: { zone: 'battlefield', controller: 'you', tapped: true } }, decisions: { targets: [] }, instructions: [{ kind: 'untap', targets: { kind: 'contextRef', name: 'triggering.object.after' } }] },
  ])
})

test('Stifle targets only stack abilities', () => {
  expect(cardRuleDefinitionSnapshotFor('Stifle')!.definition.abilities).toMatchObject([
    { kind: 'spell', decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'ability' } } }] }, instructions: [{ kind: 'counter', targets: { kind: 'targetRef', clauseIndex: 0 } }] },
  ])
})

test('Retreat to Hagra declares targeted deathtouch or untargeted opponent drain at landfall', () => {
  expect(cardRuleDefinitionSnapshotFor('Retreat to Hagra')!.definition.abilities).toMatchObject([
    { kind: 'triggered', on: { kind: 'enters', filter: { type: 'Land', controller: 'you' } }, decisions: { modes: { count: { kind: 'constant', value: 1 } } }, modes: [
      { decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature' } } }] }, instructions: [
        { kind: 'createEffect', effect: { kind: 'pump' } },
        { kind: 'createEffect', effect: { kind: 'grantKeyword', keyword: KEYWORDS.deathtouch } },
      ] },
      { instructions: [{ kind: 'loseLife', targets: { kind: 'players', filter: { relation: 'opponent' } } }, { kind: 'gainLife', targets: { kind: 'contextRef', name: 'controller' } }] },
    ] },
  ])
})

test('Reliquary Tower declares unlimited hand size and colorless tap mana', () => {
  expect(cardRuleDefinitionSnapshotFor('Reliquary Tower')!.definition.abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'noMaximumHandSize' }] },
    { kind: 'activated', costs: [{ kind: 'tapSource' }], instructions: [{ kind: 'addMana', targets: { kind: 'contextRef', name: 'controller' }, amount: { C: { kind: 'constant', value: 1 } } }] },
  ])
})

test('Burgeoning responds to opponent land plays with an optional hand-land move', () => {
  expect(cardRuleDefinitionSnapshotFor('Burgeoning')!.definition.abilities).toMatchObject([
    { kind: 'triggered', on: { kind: 'playLand', filter: { player: { kind: 'players', filter: { relation: 'opponent' } } } }, instructions: [
      { kind: 'chooseCards', bindChoice: 'land', filter: { kind: 'objects', filter: { zone: 'hand', owner: 'you', type: 'Land' } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 } },
      { kind: 'move', targets: { kind: 'choiceRef', binding: 'land' }, to: 'battlefield' },
    ] },
  ])
})

test.each([
  ['Breeding Pool', ['Forest', 'Island']],
  ['Godless Shrine', ['Plains', 'Swamp']],
  ['Hallowed Fountain', ['Plains', 'Island']],
  ['Overgrown Tomb', ['Swamp', 'Forest']],
  ['Watery Grave', ['Island', 'Swamp']],
] as const)('catalog %s pays two life or enters tapped', (name, subtypes) => {
  expect(effectsFor(name)).toEqual([])
  expect(cardTemplateDefaultsFor(name)).toMatchObject({ types: ['Land'], subtypes })
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities).toMatchObject([{
    kind: 'static',
    effects: [{
      kind: 'replacement',
      event: { kind: 'enterBattlefield', filter: { object: { kind: 'contextRef', name: 'source' } } },
      transform: { kind: 'modifyEvent', changes: {} },
      program: [
        { kind: 'choose', bindChoice: 'entryPayment' },
        { kind: 'branch', condition: { kind: 'all' } },
      ],
    }],
  }])
})

test.each(["Raffine's Tower", 'Zagoth Triome'] as const)('catalog %s enters tapped and cycles from hand for {3}', name => {
  expect(effectsFor(name)).toEqual([])
  expect(cardTemplateDefaultsFor(name)).toMatchObject({
    types: ['Land'],
    subtypes: name === 'Zagoth Triome' ? ['Swamp', 'Forest', 'Island'] : ['Plains', 'Island', 'Swamp'],
  })
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'replacement', transform: { kind: 'modifyEvent', changes: { tapped: true } } }] },
    { kind: 'activated', cycling: true, availableFrom: ['hand'], costs: [
      { kind: 'mana', amount: '{3}' },
      { kind: 'discard', filter: { kind: 'contextRef', name: 'source' }, count: { kind: 'constant', value: 1 } },
    ], instructions: [{ kind: 'draw', count: { kind: 'constant', value: 1 } }] },
  ])
})

test('catalog Secluded Steppe enters tapped, makes white, and cycles for {W}', () => {
  expect(effectsFor('Secluded Steppe')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Secluded Steppe')!.definition.abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'replacement', transform: { kind: 'modifyEvent', changes: { tapped: true } } }] },
    { kind: 'activated', costs: [{ kind: 'tapSource' }], instructions: [{ kind: 'addMana', amount: { W: { kind: 'constant', value: 1 } } }] },
    { kind: 'activated', cycling: true, availableFrom: ['hand'], costs: [
      { kind: 'mana', amount: '{W}' },
      { kind: 'discard', filter: { kind: 'contextRef', name: 'source' } },
    ], instructions: [{ kind: 'draw' }] },
  ])
})

test('catalog Astral Drift cycles itself and blinks a creature after you cycle a card', () => {
  expect(effectsFor('Astral Drift')).toEqual([])
  expect(cardTemplateDefaultsFor('Astral Drift')).toMatchObject({ types: ['Enchantment'], colors: ['W'], manaCost: '{2}{W}', manaValue: 3 })
  const exileUntilEnd = {
    decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature' } } }] },
    instructions: [{ kind: 'chooseInstructions', optional: true, options: [
      { instructions: [{ kind: 'sequence', instructions: [
        { kind: 'move', targets: { kind: 'targetRef', clauseIndex: 0 }, to: 'exile', bindChoice: 'exiled' },
        { kind: 'createDelayed', inheritTargets: false, condition: { kind: 'step', step: 'end' }, instructions: [
          { kind: 'move', targets: { kind: 'choiceRef', binding: 'exiled' }, to: 'battlefield' },
        ] },
      ] }] },
      { instructions: [] },
    ] }],
  }
  expect(cardRuleDefinitionSnapshotFor('Astral Drift')!.definition.abilities).toMatchObject([
    { kind: 'triggered', on: { kind: 'cycle', filter: { player: { kind: 'players', filter: { relation: 'you' } } } }, activeIn: ['battlefield'], ...exileUntilEnd },
    { kind: 'triggered', on: { kind: 'cycle', filter: { object: { kind: 'contextRef', name: 'source' } } }, activeIn: ['battlefield', 'stack', 'hand', 'library', 'graveyard', 'exile', 'command'], ...exileUntilEnd },
    { kind: 'activated', cycling: true, availableFrom: ['hand'], costs: [
      { kind: 'mana', amount: '{2}{W}' },
      { kind: 'discard', filter: { kind: 'contextRef', name: 'source' } },
    ], instructions: [{ kind: 'draw' }] },
  ])
})

test('Fabled Passage searches a basic land before conditionally untapping its new identity', () => {
  expect(cardRuleDefinitionSnapshotFor('Fabled Passage')!.definition.abilities).toMatchObject([
    { kind: 'activated', costs: [{ kind: 'tapSource' }, { kind: 'sacrifice', filter: { kind: 'contextRef', name: 'source' } }], instructions: [
      { kind: 'chooseCards', bindChoice: 'land', filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 } },
      { kind: 'move', targets: { kind: 'choiceRef', binding: 'land' }, to: 'battlefield', tapped: true, bindChoice: 'arrivedLand' },
      { kind: 'shuffle' },
      { kind: 'if', condition: { kind: 'compareAmount', left: { kind: 'count', of: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you', type: 'Land' } } }, operator: 'gte', right: { kind: 'constant', value: 4 } }, then: [{ kind: 'untap', targets: { kind: 'choiceRef', binding: 'arrivedLand' } }] },
    ] },
  ])
})

test('Rest in Peace combines an entry trigger with a static replacement', () => {
  expect(cardRuleDefinitionSnapshotFor('Rest in Peace')!.definition.abilities).toMatchObject([
    { kind: 'triggered', on: { kind: 'enters' } },
    { kind: 'static', effects: [{ kind: 'replacement' }] },
  ])
})

test('Wall of Omens declares defender beside its entry draw', () => {
  expect(cardRuleDefinitionSnapshotFor('Wall of Omens')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: KEYWORDS.defender },
    { kind: 'triggered', on: { kind: 'enters' }, instructions: [{ kind: 'draw', count: { kind: 'constant', value: 1 } }] },
  ])
})

test('sacrifice catalog programs bind actual counts or success before their follow-up', () => {
  for (const name of ['Reprocess', 'Scapeshift', 'Victimize']) expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Reprocess')!.definition.abilities[0]).toMatchObject({ instructions: [
    { kind: 'chooseCards', min: { kind: 'constant', value: 0 }, filter: { filter: { controller: 'you', any: [{ type: 'Artifact' }, { type: 'Creature' }, { type: 'Land' }] } } },
    { kind: 'sacrifice', bindCount: 'sacrificed' },
    { kind: 'draw', count: { kind: 'resultRef', binding: 'sacrificed', field: 'amount' } },
  ] })
  expect(cardRuleDefinitionSnapshotFor('Scapeshift')!.definition.abilities[0]).toMatchObject({ instructions: [
    { kind: 'chooseCards', filter: { filter: { type: 'Land', controller: 'you' } } },
    { kind: 'sacrifice', bindCount: 'sacrificed' },
    { kind: 'sequence', instructions: [
      { kind: 'chooseCards', max: { kind: 'resultRef', binding: 'sacrificed', field: 'amount' } },
      { kind: 'move', to: 'battlefield', tapped: true },
      { kind: 'shuffle' },
    ] },
  ] })
  expect(cardRuleDefinitionSnapshotFor('Victimize')!.definition.abilities[0]).toMatchObject({
    decisions: { targets: [{ min: { kind: 'constant', value: 2 }, max: { kind: 'constant', value: 2 }, filter: { filter: { zone: 'graveyard', type: 'Creature', owner: 'you' } } }] },
    instructions: [
      { kind: 'chooseCards', min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 } },
      { kind: 'sacrifice', bindResult: 'sacrificed' },
      { kind: 'if', condition: { kind: 'resultIsTrue', value: { binding: 'sacrificed', field: 'sacrificed' } }, then: [{ kind: 'move', to: 'battlefield', tapped: true }] },
    ],
  })
})

test.each([
  ["Archaeomancer's Map", ['triggered', 'triggered']],
  ['Dig Through Time', ['spell']],
  ["Archdruid's Charm", ['spell']],
  ['Boggart Trawler', ['triggered']],
  ['Bridgeworks Battle', ['spell']],
  ['Fell the Profane', ['spell']],
  ['Sea Gate Restoration', ['spell']],
  ['Sink into Stupor', ['spell']],
  ['Homer, the Hermit', ['triggered']],
  ['Queza, Augur of Agonies', ['triggered']],
  ['Scute Swarm', ['triggered']],
  ['Talon Gates of Madara', ['triggered', 'activated', 'activated', 'activated']],
  ['Waterlogged Teachings', ['spell']],
  ['Blanket of Night', ['static']],
  ['Urborg, Tomb of Yawgmoth', ['static']],
  ['Yavimaya, Cradle of Growth', ['static']],
  ['Dakmor Salvage', ['dredge', 'static', 'activated']],
  ['Life from the Loam', ['dredge', 'spell']],
  ['Myriad Landscape', ['static', 'activated', 'activated']],
  ['Finale of Devastation', ['spell']],
] as const)('catalog %s declares its canonical abilities', (name, kinds) => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities.map(ability => ability.kind)).toEqual([...kinds])
})

test.each([
  ['Boggart Trawler // Boggart Bog', 'Boggart Trawler', 'Boggart Bog'],
  ['Bridgeworks Battle // Tanglespan Bridgeworks', 'Bridgeworks Battle', 'Tanglespan Bridgeworks'],
  ['Fell the Profane // Fell Mire', 'Fell the Profane', 'Fell Mire'],
  ['Sea Gate Restoration // Sea Gate, Reborn', 'Sea Gate Restoration', 'Sea Gate, Reborn'],
  ['Sink into Stupor // Soporific Springs', 'Sink into Stupor', 'Soporific Springs'],
])('pay-life modal catalog %s pins independent front and land programs', (combined, front, back) => {
  expect(effectsFor(combined)).toEqual([])
  const entry = cardTemplateDefaultsFor(combined)!
  expect(entry.frontFace!.ruleDefinition).toEqual(entry.ruleDefinition)
  expect(entry.backFace!.ruleDefinition!.definition.abilities.map(ability => ability.kind)).toEqual(['static', 'activated'])
  expect(cardRuleDefinitionSnapshotFor(back)!.definition.abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'replacement', program: [
      { kind: 'choose', bindChoice: 'entryPayment' },
      { kind: 'branch', condition: { kind: 'all' } },
    ] }] },
    { kind: 'activated', costs: [{ kind: 'tapSource' }] },
  ])
})

test('Sea Gate Restoration draws hand size plus one then grants unlimited hand size', () => {
  expect(cardRuleDefinitionSnapshotFor('Sea Gate Restoration')!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    instructions: [
      { kind: 'draw', count: { kind: 'add', left: { kind: 'count', of: { kind: 'objects', filter: { zone: 'hand', controller: 'you' } } }, right: { kind: 'constant', value: 1 } } },
      { kind: 'grantNoMaximumHandSize', targets: { kind: 'contextRef', name: 'controller' } },
    ],
  })
})

test('Dig Through Time delves then inspects seven for two', () => {
  expect(cardRuleDefinitionSnapshotFor('Dig Through Time')!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    costs: [{ kind: 'delve' }],
    instructions: [
      { kind: 'inspectTop', count: { kind: 'constant', value: 7 } },
      { kind: 'chooseCards', min: { kind: 'constant', value: 2 }, max: { kind: 'constant', value: 2 } },
      { kind: 'move', to: 'hand' },
      { kind: 'move', to: 'library', position: 'bottom' },
    ],
  })
})

test("Archdruid's Charm searches by type, then damages from the pumped creature, then exiles", () => {
  const ability = cardRuleDefinitionSnapshotFor("Archdruid's Charm")!.definition.abilities[0]
  if (ability.kind !== 'spell') throw new Error('expected spell')
  expect(ability.modes).toMatchObject([
    { instructions: [
      { kind: 'chooseCards', filter: { kind: 'objects', filter: { any: [{ type: 'Creature' }, { type: 'Land' }] } } },
      { kind: 'reveal' },
      { kind: 'if', condition: { kind: 'compareAmount' } },
      { kind: 'shuffle' },
    ] },
    { instructions: [
      { kind: 'putCounters', counter: '+1/+1' },
      { kind: 'damage', source: { kind: 'targetRef', clauseIndex: 0 } },
    ] },
    { instructions: [{ kind: 'move', to: 'exile' }] },
  ])
})

test("Archaeomancer's Map searches Plains then offers a land drop when an opponent is ahead", () => {
  expect(cardRuleDefinitionSnapshotFor("Archaeomancer's Map")!.definition.abilities).toMatchObject([
    { kind: 'triggered', instructions: [{ kind: 'sequence', instructions: [
      { kind: 'chooseCards', filter: { kind: 'objects', filter: { subtypes: ['Plains'], supertypes: ['Basic'] } } },
      { kind: 'reveal' },
      { kind: 'move', to: 'hand' },
      { kind: 'shuffle' },
    ] }] },
    { kind: 'triggered', on: { kind: 'enters', filter: { type: 'Land', not: { controller: 'you' } } } },
  ])
})

test('Homer mills twice the union of sea-creature subtypes to any number of players', () => {
  expect(cardRuleDefinitionSnapshotFor('Homer, the Hermit')!.definition.abilities[0]).toMatchObject({
    kind: 'triggered',
    on: { kind: 'enters', filter: { type: 'Land', controller: 'you' } },
    instructions: [{ kind: 'mill', count: { kind: 'multiply', left: { kind: 'constant', value: 2 } } }],
  })
})

test('Scute Swarm copies itself at six lands and otherwise makes an Insect', () => {
  expect(cardRuleDefinitionSnapshotFor('Scute Swarm')!.definition.abilities[0]).toMatchObject({
    kind: 'triggered',
    instructions: [{ kind: 'if', then: [{ kind: 'copy' }], otherwise: [{ kind: 'createToken', token: { name: 'Insect' } }] }],
  })
})

test('Talon Gates phases out up to one creature, makes mana, and can enter from hand', () => {
  expect(cardRuleDefinitionSnapshotFor('Talon Gates of Madara')!.definition.abilities).toMatchObject([
    { kind: 'triggered', instructions: [{ kind: 'phase', out: true }] },
    { kind: 'activated', costs: [{ kind: 'tapSource' }], instructions: [{ kind: 'addMana', amount: { C: { kind: 'constant', value: 1 } } }] },
    { kind: 'activated', costs: [{ kind: 'mana', amount: '{1}' }, { kind: 'tapSource' }] },
    { kind: 'activated', availableFrom: ['hand'], costs: [{ kind: 'mana', amount: '{4}' }], instructions: [{ kind: 'move', to: 'battlefield' }] },
  ])
})

test('the two upkeep reveal cards share a public reveal, captured mana value, hand move, and life loss', () => {
  const confidant = cardRuleDefinitionSnapshotFor('Dark Confidant')!
  expect(cardRuleDefinitionSnapshotFor('Dark Tutelage')!.definition.abilities).toEqual(confidant.definition.abilities)
  expect(confidant.definition.abilities).toMatchObject([{
    kind: 'triggered', on: { kind: 'stepBegins', step: 'upkeep', player: { kind: 'contextRef', name: 'controller' } },
    instructions: [
      { kind: 'inspectTop', count: { kind: 'constant', value: 1 }, visibility: 'public' },
      { kind: 'if', then: [
        { kind: 'captureAmount', amount: { kind: 'characteristic', characteristic: 'manaValue' } },
        { kind: 'move', to: 'hand' },
        { kind: 'loseLife', amount: { kind: 'resultRef', binding: 'manaValue' } },
      ] },
    ],
  }])
})

test('catalog timing and activation-cost cards compose canonical when, flash, and reductions', () => {
  expect(effectsFor("Alchemist's Refuge")).toEqual([])
  expect(effectsFor('Blossoming Tortoise')).toEqual([])
  expect(effectsFor('Boseiju, Who Endures')).toEqual([])
  expect(effectsFor('Cephalid Coliseum')).toEqual([])
  expect(effectsFor('Ghost Town')).toEqual([])
  expect(effectsFor('Mirror Universe')).toEqual([])
  expect(effectsFor('Necrologia')).toEqual([])
  expect(effectsFor('Otawara, Soaring City')).toEqual([])
  expect(effectsFor('Temple of the False God')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Ghost Town')!.definition.abilities[1]).toMatchObject({
    kind: 'activated',
    when: { kind: 'not', condition: { kind: 'activePlayer' } },
    instructions: [{ kind: 'move', to: 'hand' }],
  })
  expect(cardRuleDefinitionSnapshotFor('Temple of the False God')!.definition.abilities[0]).toMatchObject({
    kind: 'activated',
    when: { kind: 'compareAmount', operator: 'gte' },
    instructions: [{ kind: 'addMana' }],
  })
  expect(cardRuleDefinitionSnapshotFor('Mirror Universe')!.definition.abilities[0]).toMatchObject({
    kind: 'activated',
    when: { kind: 'all' },
    instructions: [{ kind: 'exchangeLife' }],
  })
  expect(cardRuleDefinitionSnapshotFor('Necrologia')!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    when: { kind: 'all' },
    instructions: [{ kind: 'draw' }],
  })
  expect(cardRuleDefinitionSnapshotFor("Alchemist's Refuge")!.definition.abilities[1]).toMatchObject({
    kind: 'activated',
    instructions: [{ kind: 'grantFlash' }],
  })
  expect(cardRuleDefinitionSnapshotFor('Otawara, Soaring City')!.definition.abilities[1]).toMatchObject({
    kind: 'activated',
    availableFrom: ['hand'],
    costReductions: [{ generic: { kind: 'count' } }],
    instructions: [{ kind: 'move', to: 'hand' }],
  })
  expect(cardRuleDefinitionSnapshotFor('Boseiju, Who Endures')!.definition.abilities[1]).toMatchObject({
    kind: 'activated',
    availableFrom: ['hand'],
    costReductions: [{ generic: { kind: 'count' } }],
  })
  expect(cardRuleDefinitionSnapshotFor('Blossoming Tortoise')!.definition.abilities).toMatchObject([
    { kind: 'triggered', on: { kind: 'enters' } },
    { kind: 'triggered', on: { kind: 'attacks' } },
    { kind: 'static', effects: [{ kind: 'reduceActivationCost' }, { kind: 'modifyStats' }] },
  ])
})

test('catalog life-history and win cards compose canonical instructions', () => {
  expect(effectsFor('Children of Korlis')).toEqual([])
  expect(effectsFor('Tainted Sigil')).toEqual([])
  expect(effectsFor('Sygg, River Cutthroat')).toEqual([])
  expect(effectsFor('Test of Endurance')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Children of Korlis')!.definition.abilities).toMatchObject([{
    kind: 'activated',
    costs: [{ kind: 'sacrifice' }],
    instructions: [{ kind: 'gainLife', amount: { kind: 'lifeLostThisTurn', of: { kind: 'contextRef', name: 'controller' } } }],
  }])
  expect(cardRuleDefinitionSnapshotFor('Tainted Sigil')!.definition.abilities).toMatchObject([{
    kind: 'activated',
    costs: [{ kind: 'tapSource' }, { kind: 'sacrifice' }],
    instructions: [{
      kind: 'gainLife',
      amount: { kind: 'lifeLostThisTurn', of: { kind: 'players', filter: { relation: 'any' } }, combine: 'sum' },
    }],
  }])
  expect(cardRuleDefinitionSnapshotFor('Sygg, River Cutthroat')!.definition.abilities).toMatchObject([{
    kind: 'triggered',
    on: { kind: 'stepBegins', step: 'end' },
    interveningIf: { kind: 'compareAmount', operator: 'gte', left: { kind: 'lifeLostThisTurn', combine: 'greatest' } },
    instructions: [{ kind: 'chooseInstructions', optional: true }],
  }])
  expect(cardRuleDefinitionSnapshotFor('Test of Endurance')!.definition.abilities).toMatchObject([{
    kind: 'triggered',
    on: { kind: 'stepBegins', step: 'upkeep', player: { kind: 'contextRef', name: 'controller' } },
    interveningIf: { kind: 'compareAmount', operator: 'gte', left: { kind: 'characteristic', characteristic: 'life' } },
    instructions: [{ kind: 'winGame', targets: { kind: 'contextRef', name: 'controller' } }],
  }])
})

test('Braids offers an eligible hand permanent to the active upkeep player', () => {
  expect(cardRuleDefinitionSnapshotFor('Braids, Conjurer Adept')!.definition.abilities).toMatchObject([{
    kind: 'triggered', on: { kind: 'stepBegins', step: 'upkeep' },
    instructions: [
      { kind: 'chooseCards', chooser: { kind: 'contextRef', name: 'triggering.player' }, filter: { filter: { zone: 'hand', any: [{ type: 'Artifact' }, { type: 'Creature' }, { type: 'Land' }] } }, min: { value: 0 }, max: { value: 1 } },
      { kind: 'move', to: 'battlefield', controller: { kind: 'contextRef', name: 'triggering.player' } },
    ],
  }])
})

test('Overwhelming Stampede and Pathbreaker Ibex share a greatest-power trample pump', () => {
  const stampede = cardRuleDefinitionSnapshotFor('Overwhelming Stampede')!.definition.abilities[0]!
  expect(effectsFor('Overwhelming Stampede')).toEqual([])
  expect(effectsFor('Pathbreaker Ibex')).toEqual([])
  expect(stampede.kind).toBe('spell')
  if (stampede.kind !== 'spell') throw new Error('expected spell')
  expect(stampede.instructions).toMatchObject([
    { kind: 'createEffect', effect: { kind: 'pump', power: { kind: 'greatest', characteristic: 'power' }, toughness: { kind: 'greatest', characteristic: 'power' } } },
    { kind: 'createEffect', effect: { kind: 'grantKeyword', keyword: KEYWORDS.trample } },
  ])
  expect(cardRuleDefinitionSnapshotFor('Pathbreaker Ibex')!.definition.abilities).toMatchObject([{
    kind: 'triggered', on: { kind: 'attacks' },
    instructions: stampede.instructions,
  }])
})

test('Return of the Wildspeaker chooses one draw from greatest non-Human power or a non-Human pump', () => {
  expect(effectsFor('Return of the Wildspeaker')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Return of the Wildspeaker')!.definition.abilities).toMatchObject([{
    kind: 'spell', decisions: { modes: { count: { kind: 'constant', value: 1 } } },
    modes: [
      { instructions: [{ kind: 'draw', count: { kind: 'greatest', characteristic: 'power' } }] },
      { instructions: [{ kind: 'createEffect', effect: { kind: 'pump', power: { kind: 'constant', value: 3 }, toughness: { kind: 'constant', value: 3 } } }] },
    ],
  }])
})

test('Mana Drain captures the spell mana value then pays colorless at the next main', () => {
  expect(effectsFor('Mana Drain')).toEqual([])
  expect(cardRuleDefinitionSnapshotFor('Mana Drain')!.definition.abilities).toMatchObject([{
    kind: 'spell', decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'spell' } } }] },
    instructions: [
      { kind: 'captureAmount', bindResult: 'manaValue' },
      { kind: 'counter' },
      { kind: 'createDelayed', inheritTargets: false, condition: { kind: 'step', step: ['precombatMain', 'postcombatMain'] }, instructions: [
        { kind: 'addMana', targets: { kind: 'contextRef', name: 'controller' } },
      ] },
    ],
  }])
})

test('Arcane Denial captures the spell controller and creates two non-targeting next-turn upkeep abilities', () => {
  expect(cardRuleDefinitionSnapshotFor('Arcane Denial')!.definition.abilities).toMatchObject([{
    kind: 'spell', decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'spell' } } }] },
    instructions: [
      { kind: 'capturePlayer', bindResult: 'spellController' },
      { kind: 'counter' },
      { kind: 'createDelayed', condition: { kind: 'step', step: 'upkeep' }, notThisTurn: true, inheritTargets: false, instructions: [
        { kind: 'chooseInstructions', chooser: { kind: 'resultRef', binding: 'spellController', field: 'player' }, options: [
          { instructions: [] },
          { instructions: [{ kind: 'draw', count: { value: 1 } }] },
          { instructions: [{ kind: 'draw', count: { value: 2 } }] },
        ] },
      ] },
      { kind: 'createDelayed', condition: { kind: 'step', step: 'upkeep' }, notThisTurn: true, inheritTargets: false, instructions: [
        { kind: 'draw', targets: { kind: 'contextRef', name: 'controller' }, count: { value: 1 } },
      ] },
    ],
  }])
})

test('group 15 consumers compose name, comparison, and mana-ability queries', () => {
  expect(cardRuleDefinitionSnapshotFor('Beza, the Bounding Spring')!.definition.abilities).toMatchObject([{
    kind: 'triggered', instructions: [
      { kind: 'if', condition: { kind: 'somePlayerHasMore', metric: 'lands' }, then: [{ kind: 'createToken', token: { name: 'Treasure' } }] },
      { kind: 'if', condition: { metric: 'life' }, then: [{ kind: 'gainLife', amount: { value: 4 } }] },
      { kind: 'if', condition: { metric: 'creatures' }, then: [{ kind: 'createToken', count: { value: 2 }, token: { name: 'Fish', colors: ['U'] } }] },
      { kind: 'if', condition: { metric: 'hand' }, then: [{ kind: 'draw' }] },
    ],
  }])
  expect(cardRuleDefinitionSnapshotFor('Guardian Project')!.definition.abilities).toMatchObject([{
    kind: 'triggered', on: { filter: { token: false, controller: 'you', type: 'Creature' } },
    interveningIf: { kind: 'all', conditions: [
      { left: { of: { filter: { zone: 'battlefield', sameNameAs: { name: 'triggering.object.after' } } } } },
      { left: { of: { filter: { zone: 'graveyard', sameNameAs: { name: 'triggering.object.after' } } } } },
    ] }, instructions: [{ kind: 'draw' }],
  }])
  expect(cardRuleDefinitionSnapshotFor('Field of the Dead')!.definition.abilities).toMatchObject([
    { kind: 'static' }, { kind: 'activated', instructions: [{ kind: 'addMana', amount: { C: { value: 1 } } }] },
    { kind: 'triggered', interveningIf: { left: { kind: 'countDistinctNames' }, right: { value: 7 } }, instructions: [{ kind: 'createToken', token: { colors: ['B'], power: 2, toughness: 2 } }] },
  ])
  expect(cardRuleDefinitionSnapshotFor('Moonsilver Key')!.definition.abilities).toMatchObject([{
    kind: 'activated', costs: [{ kind: 'mana', amount: '{1}' }, { kind: 'tapSource' }, { kind: 'sacrifice' }],
    instructions: [{ kind: 'sequence', instructions: [
      { kind: 'chooseCards', filter: { filter: { any: [{ type: 'Artifact', manaAbility: true }, { type: 'Land', supertypes: ['Basic'] }] } } },
      { kind: 'reveal' }, { kind: 'move', to: 'hand' }, { kind: 'shuffle' },
    ] }],
  }])
})

test('Singularity Rupture wipes creatures before computing each selected player’s own half library', () => {
  expect(cardRuleDefinitionSnapshotFor('Singularity Rupture')!.definition.abilities).toMatchObject([{
    kind: 'spell', decisions: { targets: [{ filter: { kind: 'players' }, min: { value: 0 } }] },
    instructions: [{ kind: 'destroy' }, { kind: 'forEachPlayer', of: { kind: 'targetRef', clauseIndex: 0 }, instructions: [
      { kind: 'mill', targets: { name: 'event.player' }, count: { kind: 'divide', by: 2, rounding: 'down', value: { kind: 'count', of: { filter: { zone: 'library', owner: { name: 'event.player' } } } } } },
    ] }],
  }])
})

test('available-mana lands and artifacts use canonical production queries with their complete costs', () => {
  for (const [name, relation, colorsOnly] of [
    ['Exotic Orchard', 'opponent', true], ['Fellwar Stone', 'opponent', true], ['Reflecting Pool', 'you', false], ['Horizon of Progress', 'you', false],
  ] as const) {
    const abilities = cardRuleDefinitionSnapshotFor(name)!.definition.abilities
    expect(abilities[0]).toMatchObject({ kind: 'activated', costs: name === 'Horizon of Progress' ? [{ kind: 'tapSource' }, { kind: 'life', amount: { kind: 'constant', value: 1 } }] : [{ kind: 'tapSource' }], instructions: [{ kind: 'addManaFrom', of: { kind: 'objects', filter: { zone: 'battlefield', type: 'Land', controller: relation } }, colorsOnly, amount: { kind: 'constant', value: 1 } }] })
    if (name === 'Horizon of Progress') expect(abilities.slice(1)).toMatchObject([
      { kind: 'activated', costs: [{ kind: 'mana', amount: '{3}' }, { kind: 'tapSource' }], instructions: [{ kind: 'chooseCards', min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 }, filter: { filter: { zone: 'hand', owner: 'you', type: 'Land' } } }, { kind: 'move', to: 'battlefield', tapped: true }] },
      { kind: 'activated', costs: [{ kind: 'mana', amount: '{1}' }, { kind: 'tapSource' }, { kind: 'sacrifice' }], instructions: [{ kind: 'draw', count: { kind: 'constant', value: 1 } }] },
    ])
  }
})

test('remaining mana-production cards retain costs, timing, triggers, Aura restrictions, and source-independent callbacks', () => {
  for (const name of ['Flooded Grove', 'Millikin', 'City of Brass', 'Bubbling Muck', 'Crypt Ghast', 'Nirkana Revenant', 'Wild Growth', 'Utopia Sprawl', 'Yurlok of Scorch Thrash']) {
    const abilities = cardRuleDefinitionSnapshotFor(name)!.definition.abilities
    switch (name) {
      case 'Flooded Grove':
        expect(abilities).toMatchObject([{ kind: 'activated' }, { kind: 'activated', costs: [{ kind: 'mana', amount: '{G/U}' }, { kind: 'tapSource' }], instructions: [{ kind: 'chooseInstructions', options: [{ label: 'GG' }, { label: 'UG' }, { label: 'UU' }] }] }])
        break
      case 'Millikin':
        expect(abilities).toMatchObject([{ kind: 'activated', timing: 'instant', costs: [{ kind: 'tapSource' }, { kind: 'mill', count: { kind: 'constant', value: 1 } }] }])
        break
      case 'City of Brass':
        expect(abilities).toMatchObject([{ kind: 'triggered', on: { kind: 'becomesTapped' }, instructions: [{ kind: 'damage', amount: { kind: 'constant', value: 1 } }] }, { kind: 'activated' }])
        break
      case 'Bubbling Muck':
        expect(abilities).toMatchObject([{ kind: 'spell', instructions: [{ kind: 'createDelayed', repeatUntilCleanup: true, condition: { kind: 'tappedForMana', filter: { subtypes: ['Swamp'] } } }] }])
        break
      case 'Crypt Ghast':
        expect(abilities).toMatchObject([{ kind: 'triggered', on: { kind: 'tappedForMana', filter: { controller: 'you' } } }, { kind: 'triggered', on: { kind: 'cast', filter: { controller: 'you' } }, instructions: [{ kind: 'payOptional', cost: { kind: 'mana', amount: '{W/B}' }, ifPaid: [{ kind: 'loseLife', bindResult: 'drained' }, { kind: 'gainLife', amount: { kind: 'resultRef', binding: 'drained' } }] }] }])
        break
      case 'Nirkana Revenant':
        expect(abilities).toMatchObject([{ kind: 'triggered', on: { kind: 'tappedForMana' } }, { kind: 'activated', costs: [{ kind: 'mana', amount: '{B}' }], instructions: [{ kind: 'createEffect', duration: { kind: 'untilCleanup' } }] }])
        break
      case 'Wild Growth':
      case 'Utopia Sprawl':
        expect(abilities[0]).toMatchObject({ kind: 'static', effects: [{ kind: 'enchant', filter: { filter: { zone: 'battlefield', type: 'Land', ...(name === 'Utopia Sprawl' ? { subtypes: ['Forest'] } : {}) } } }] })
        expect(abilities.at(-1)).toMatchObject({ kind: 'triggered', manaAbility: true, on: { kind: 'tappedForMana', filter: { enchantedBy: { kind: 'contextRef', name: 'source' } } } })
        break
      case 'Yurlok of Scorch Thrash':
        expect(abilities).toMatchObject([{ kind: 'keyword', keyword: 'vigilance' }, { kind: 'static', effects: [{ kind: 'loseLifeOnManaLoss' }] }, { kind: 'activated', costs: [{ kind: 'mana', amount: '{1}' }, { kind: 'tapSource' }], instructions: [{ kind: 'addMana', targets: { kind: 'players', filter: { relation: 'any' } } }] }])
        break
    }
  }
})


test('Profane Command composes exactly two X modes with targeted return, shrink, and fear', () => {
  const template = cardTemplateDefaultsFor('Profane Command')!
  expect(template).toMatchObject({ types: ['Sorcery'], colors: ['B'], manaCost: '{X}{B}{B}', manaValue: 2 })
  const ability = cardRuleDefinitionSnapshotFor('Profane Command')!.definition.abilities[0]!
  expect(ability).toMatchObject({
    kind: 'spell',
    costs: [{ kind: 'mana', amount: '{X}{B}{B}' }],
    decisions: { variables: [{ name: 'X' }], modes: { count: { kind: 'constant', value: 2 }, repeatable: false } },
    modes: [
      { decisions: { targets: [{ filter: { kind: 'players' } }] }, instructions: [{ kind: 'loseLife', targets: { kind: 'targetRef', clauseIndex: 0 }, amount: { kind: 'variable', name: 'X' } }] },
      { decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'graveyard', owner: 'you', type: 'Creature', compareCharacteristic: { characteristic: 'manaValue', operator: 'lte', than: { kind: 'variable', name: 'X' } } } } }] }, instructions: [{ kind: 'move', to: 'battlefield' }] },
      { instructions: [{ kind: 'createEffect', effect: { kind: 'pump', power: { kind: 'negate', value: { kind: 'variable', name: 'X' } }, toughness: { kind: 'negate', value: { kind: 'variable', name: 'X' } } }, duration: { kind: 'untilCleanup' } }] },
      { decisions: { targets: [{ min: { kind: 'constant', value: 0 }, max: { kind: 'variable', name: 'X' } }] }, instructions: [{ kind: 'createEffect', effect: { kind: 'grantKeyword', keyword: KEYWORDS.fear }, duration: { kind: 'untilCleanup' } }] },
    ],
  })
})


test('Thunderfoot Baloth keeps printed trample and commander-conditioned team grants', () => {
  const abilities = cardRuleDefinitionSnapshotFor('Thunderfoot Baloth')!.definition.abilities
  expect(abilities).toMatchObject([
    { kind: 'keyword', keyword: KEYWORDS.trample },
    { kind: 'static', effects: [
      { kind: 'modifyStats', targets: { filter: { controller: 'you', type: 'Creature' } }, power: { kind: 'constant', value: 2 }, toughness: { kind: 'constant', value: 2 }, when: { kind: 'compareAmount', left: { kind: 'count', of: { filter: { controller: 'you', commander: true } } }, operator: 'gte', right: { kind: 'constant', value: 1 } } },
      { kind: 'grantKeyword', targets: { filter: { controller: 'you', other: true } }, keyword: KEYWORDS.trample },
    ] },
  ])
  if (abilities[1].kind !== 'static') throw new Error('expected static ability')
  expect(abilities[1].effects[1]).toMatchObject({ when: abilities[1].effects[0].kind === 'modifyStats' ? abilities[1].effects[0].when : undefined })
})


test('Archetype of Endurance grants controlled creatures hexproof and prohibits it on opponents creatures', () => {
  expect(cardTemplateDefaultsFor('Archetype of Endurance')).toMatchObject({ types: ['Enchantment', 'Creature'], subtypes: ['Boar'], manaCost: '{6}{G}{G}', manaValue: 8 })
  expect(cardRuleDefinitionSnapshotFor('Archetype of Endurance')!.definition.abilities).toMatchObject([
    { kind: 'static', effects: [
      { kind: 'grantKeyword', keyword: KEYWORDS.hexproof, targets: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you', type: 'Creature' } } },
      { kind: 'suppressKeyword', keyword: KEYWORDS.hexproof, targets: { kind: 'objects', filter: { zone: 'battlefield', controller: 'opponent', type: 'Creature' } } },
    ] },
  ])
})


test('Sandstone Oracle chooses rather than targets an opponent and draws the nonnegative hand difference', () => {
  expect(cardTemplateDefaultsFor('Sandstone Oracle')).toMatchObject({ types: ['Artifact', 'Creature'], subtypes: ['Sphinx'], manaCost: '{7}' })
  expect(cardRuleDefinitionSnapshotFor('Sandstone Oracle')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: KEYWORDS.flying },
    { kind: 'triggered', decisions: { targets: [] }, instructions: [
      { kind: 'choosePlayer', filter: { kind: 'players', filter: { relation: 'opponent' } }, bindChoice: 'opponent' },
      { kind: 'draw', count: { kind: 'difference', left: { kind: 'count', of: { filter: { zone: 'hand', owner: { kind: 'choiceRef', binding: 'opponent' } } } }, right: { kind: 'count', of: { filter: { zone: 'hand', owner: { kind: 'contextRef', name: 'controller' } } } } } },
    ] },
  ])
})


test('Mossborn Hydra composes trample, entry counters, and resolution-time landfall doubling', () => {
  expect(cardTemplateDefaultsFor('Mossborn Hydra')).toMatchObject({ types: ['Creature'], subtypes: ['Elemental', 'Hydra'], manaCost: '{2}{G}' })
  expect(cardRuleDefinitionSnapshotFor('Mossborn Hydra')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: KEYWORDS.trample },
    { kind: 'static', effects: [{ kind: 'replacement', transform: { kind: 'modifyEvent', changes: { enterCounters: { '+1/+1': { kind: 'constant', value: 1 } } } } }] },
    { kind: 'triggered', on: { kind: 'enters', filter: { type: 'Land', controller: 'you' } }, instructions: [{ kind: 'putCounters', targets: { kind: 'contextRef', name: 'source' }, counter: '+1/+1', count: { kind: 'counterCount', of: { kind: 'contextRef', name: 'source' }, counter: '+1/+1' } }] },
  ])
})

test('Decisive Denial composes controlled-versus-uncontrolled fight or a noncreature counter with controller payment', () => {
  expect(cardRuleDefinitionSnapshotFor('Decisive Denial')!.definition.abilities[0]).toMatchObject({
    kind: 'spell', decisions: { modes: { count: { kind: 'constant', value: 1 } } }, modes: [
      { decisions: { targets: [{ filter: { filter: { controller: 'you', type: 'Creature' } } }, { filter: { filter: { not: { controller: 'you' }, type: 'Creature' } } }] }, instructions: [{ kind: 'fight' }] },
      { decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'spell', not: { type: 'Creature' } } } }] }, instructions: [{ kind: 'payOptional', payer: { kind: 'relatedPlayer', relation: 'controller', of: { kind: 'targetRef', clauseIndex: 0 } }, cost: { kind: 'mana', amount: '{3}' }, ifDeclined: [{ kind: 'counter', targets: { kind: 'targetRef', clauseIndex: 0 } }] }] },
    ],
  })
})


test('Keep Safe counters a spell targeting a controlled permanent then draws once', () => {
  expect(cardTemplateDefaultsFor('Keep Safe')).toMatchObject({ types: ['Instant'], manaCost: '{1}{U}', manaValue: 2 })
  expect(cardRuleDefinitionSnapshotFor('Keep Safe')!.definition.abilities[0]).toMatchObject({
    kind: 'spell', decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'spell', targets: { kind: 'objects', filter: { zone: 'battlefield', controller: 'you' } } } } }] },
    instructions: [{ kind: 'counter', targets: { kind: 'targetRef', clauseIndex: 0 } }, { kind: 'draw', count: { kind: 'constant', value: 1 } }],
  })
})


test('Benders Waterskin participates in other-player untaps and offers five one-mana choices', () => {
  const abilities = cardRuleDefinitionSnapshotFor("Bender's Waterskin")!.definition.abilities
  expect(abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'untapDuringOthers', targets: { kind: 'objects', filter: { among: { kind: 'contextRef', name: 'source' } } } }] },
    { kind: 'activated', costs: [{ kind: 'tapSource' }], instructions: [{ kind: 'chooseInstructions' }] },
  ])
  if (abilities[1].kind !== 'activated') throw new Error('expected activated ability')
  const instruction = abilities[1].instructions?.[0]
  if (instruction?.kind !== 'chooseInstructions') throw new Error('expected mana choices')
  expect(instruction.options.map(option => option.label)).toEqual([...CARD_COLORS])
})


test('Mister Negative preserves both keywords and an optional targeted exchange drawing actual life lost', () => {
  expect(cardTemplateDefaultsFor('Mister Negative')).toMatchObject({ types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Human', 'Villain'] })
  expect(cardRuleDefinitionSnapshotFor('Mister Negative')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: KEYWORDS.vigilance },
    { kind: 'keyword', keyword: KEYWORDS.lifelink },
    { kind: 'triggered', decisions: { targets: [{ filter: { kind: 'players', filter: { relation: 'opponent' } } }] }, instructions: [{ kind: 'chooseInstructions', optional: true, options: [
      { instructions: [{ kind: 'sequence', instructions: [{ kind: 'exchangeLife', bindResult: 'lifeLost' }, { kind: 'draw', count: { kind: 'resultRef', binding: 'lifeLost', field: 'amount' } }] }] },
      { instructions: [] },
    ] }] },
  ])
})


test('Windfall discards each hand then draws the greatest actual discarded count', () => {
  expect(cardTemplateDefaultsFor('Windfall')).toMatchObject({ types: ['Sorcery'], manaCost: '{2}{U}', manaValue: 3 })
  expect(cardRuleDefinitionSnapshotFor('Windfall')!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    instructions: [
      { kind: 'forEachPlayer', bindMax: { from: 'discarded', field: 'discardedCount', as: 'greatest' }, instructions: [{ kind: 'discard' }] },
      { kind: 'draw', count: { kind: 'resultRef', binding: 'greatest', field: 'amount' } },
    ],
  })
})

test('catalog Marina Vendrell inspects seven for enchantments and toggles a Room door', () => {
  expect(effectsFor('Marina Vendrell')).toEqual([])
  expect(cardTemplateDefaultsFor('Marina Vendrell')).toMatchObject({
    types: ['Creature'],
    subtypes: ['Human', 'Warlock'],
    supertypes: ['Legendary'],
    manaCost: '{W}{U}{B}{R}{G}',
    manaValue: 5,
  })
  const abilities = cardRuleDefinitionSnapshotFor('Marina Vendrell')!.definition.abilities
  expect(abilities).toHaveLength(2)
  expect(abilities[0]).toMatchObject({
    kind: 'triggered',
    on: { kind: 'enters' },
    instructions: [
      { kind: 'inspectTop', count: { kind: 'constant', value: 7 }, visibility: 'public' },
      { kind: 'move', to: 'hand' },
      { kind: 'move', to: 'library', position: 'bottom', order: 'random' },
    ],
  })
  expect(abilities[1]).toMatchObject({
    kind: 'activated',
    timing: 'sorcery',
    costs: [{ kind: 'tapSource' }],
    instructions: [{ kind: 'lockOrUnlockDoor', targets: { kind: 'targetRef', clauseIndex: 0 } }],
  })
})

test('catalog Fact or Fiction inspects five, lets an opponent partition, and routes both piles', () => {
  expect(effectsFor('Fact or Fiction')).toEqual([])
  expect(cardTemplateDefaultsFor('Fact or Fiction')).toMatchObject({ types: ['Instant'], manaCost: '{3}{U}', manaValue: 4 })
  expect(cardRuleDefinitionSnapshotFor('Fact or Fiction')!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    instructions: [
      { kind: 'inspectTop', count: { kind: 'constant', value: 5 }, visibility: 'public' },
      { kind: 'choosePlayer' },
      { kind: 'partitionPiles' },
      { kind: 'move', to: 'hand' },
      { kind: 'move', to: 'graveyard' },
    ],
  })
})

test("catalog Council's Judgment votes for opponent nonlands and exiles every winner", () => {
  expect(effectsFor("Council's Judgment")).toEqual([])
  expect(cardTemplateDefaultsFor("Council's Judgment")).toMatchObject({ types: ['Sorcery'], manaCost: '{1}{W}{W}', manaValue: 3 })
  expect(cardRuleDefinitionSnapshotFor("Council's Judgment")!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    instructions: [
      { kind: 'vote', bindWinners: 'winners', options: { kind: 'objects' } },
      { kind: 'move', to: 'exile' },
    ],
  })
})

test('catalog Coercive Portal votes at upkeep for carnage or homage', () => {
  expect(effectsFor('Coercive Portal')).toEqual([])
  expect(cardTemplateDefaultsFor('Coercive Portal')).toMatchObject({ types: ['Artifact'], manaCost: '{4}', manaValue: 4 })
  expect(cardRuleDefinitionSnapshotFor('Coercive Portal')!.definition.abilities[0]).toMatchObject({
    kind: 'triggered',
    on: { kind: 'stepBegins', step: 'upkeep' },
    instructions: [
      { kind: 'vote', options: { kind: 'named' } },
      { kind: 'if' },
    ],
  })
})

test('catalog Split Decision votes to counter or copy a targeted instant or sorcery', () => {
  expect(effectsFor('Split Decision')).toEqual([])
  expect(cardTemplateDefaultsFor('Split Decision')).toMatchObject({ types: ['Instant'], manaCost: '{1}{U}', manaValue: 2 })
  expect(cardRuleDefinitionSnapshotFor('Split Decision')!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    instructions: [
      { kind: 'vote', options: { kind: 'named' } },
      { kind: 'if' },
    ],
  })
})

test("catalog Selvala's Stampede tallies wild reveals and free-hand permanents", () => {
  expect(effectsFor("Selvala's Stampede")).toEqual([])
  expect(cardTemplateDefaultsFor("Selvala's Stampede")).toMatchObject({ types: ['Sorcery'], manaCost: '{4}{G}{G}', manaValue: 6 })
  expect(cardRuleDefinitionSnapshotFor("Selvala's Stampede")!.definition.abilities[0]).toMatchObject({
    kind: 'spell',
    instructions: [
      { kind: 'vote', options: { kind: 'named' } },
      { kind: 'if' },
      { kind: 'chooseCards' },
      { kind: 'move', to: 'battlefield' },
    ],
  })
})

test('Repay in Kind sets every living player to the signed lowest life total', () => {
  expect(cardTemplateDefaultsFor('Repay in Kind')).toMatchObject({ types: ['Sorcery'], manaCost: '{5}{B}{B}', manaValue: 7 })
  expect(cardRuleDefinitionSnapshotFor('Repay in Kind')!.definition.abilities[0]).toMatchObject({
    kind: 'spell', instructions: [{ kind: 'setLife', targets: { kind: 'players', filter: {} }, amount: { kind: 'lowestLife', of: { kind: 'players', filter: {} } } }],
  })
})


test('linked exile cards compose persistent sets, full selectors, and independent characteristic bonuses', () => {
  const sands = cardRuleDefinitionSnapshotFor('Endless Sands')!.definition.abilities
  expect(sands).toMatchObject([
    { kind: 'activated', instructions: [{ kind: 'addMana', amount: { C: { kind: 'constant', value: 1 } } }] },
    { kind: 'activated', decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', controller: 'you' } } }] }, instructions: [{ kind: 'linkExile' }] },
    { kind: 'activated', costs: [{ kind: 'mana' }, { kind: 'tapSource' }, { kind: 'sacrifice' }], instructions: [{ kind: 'forEach', of: { kind: 'objects', filter: { zone: 'exile', type: 'Creature', exiledWith: { kind: 'contextRef', name: 'source' } } }, instructions: [{ kind: 'move', to: 'battlefield', controller: { kind: 'relatedPlayer', relation: 'owner' } }] }] },
  ])
  const bishop = cardRuleDefinitionSnapshotFor('Bishop of Binding')!.definition.abilities
  expect(bishop).toMatchObject([
    { kind: 'triggered', instructions: [{ kind: 'linkExile', untilSourceLeaves: true }] },
    { kind: 'triggered', decisions: { targets: [{ filter: { filter: { type: 'Creature', subtypes: ['Vampire'] } } }] }, instructions: [{ kind: 'createEffect', effect: { kind: 'pump', power: { kind: 'sumCharacteristics', characteristic: 'power' }, toughness: { kind: 'sumCharacteristics', characteristic: 'power' } } }] },
  ])
  expect(cardRuleDefinitionSnapshotFor('Lumbering Battlement')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: 'vigilance' },
    { kind: 'triggered', instructions: [{ kind: 'chooseCards', filter: { filter: { token: false, other: true, controller: 'you' } } }, { kind: 'linkExile', untilSourceLeaves: true }] },
    { kind: 'static', effects: [{ kind: 'modifyStats', power: { kind: 'multiply' }, toughness: { kind: 'multiply' } }] },
  ])
  expect(cardRuleDefinitionSnapshotFor('Phyrexian Ingester')!.definition.abilities).toMatchObject([
    { kind: 'triggered', decisions: { targets: [{ min: { kind: 'constant', value: 1 }, filter: { filter: { token: false, type: 'Creature' } } }] }, instructions: [{ kind: 'chooseInstructions', optional: true }] },
    { kind: 'static', effects: [{ kind: 'modifyStats', power: { kind: 'sumCharacteristics', characteristic: 'power' }, toughness: { kind: 'sumCharacteristics', characteristic: 'toughness' } }] },
  ])
})


test('Pit of Offerings retains tapped entry, three graveyard targets, and both mana abilities', () => {
  expect(cardRuleDefinitionSnapshotFor('Pit of Offerings')!.definition.abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'replacement', transform: { kind: 'modifyEvent', changes: { tapped: true } } }] },
    { kind: 'triggered', decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'graveyard' } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 3 } }] }, instructions: [{ kind: 'linkExile' }] },
    { kind: 'activated', instructions: [{ kind: 'addMana', amount: { C: { kind: 'constant', value: 1 } } }] },
    { kind: 'activated', instructions: [{ kind: 'addManaFrom', basis: 'colors', of: { filter: { zone: 'exile', exiledWith: { kind: 'contextRef', name: 'source' } } } }] },
  ])
})


test('Palace Jailer has two independent entry abilities with opponent-monarch exile duration', () => {
  expect(cardRuleDefinitionSnapshotFor('Palace Jailer')!.definition.abilities).toMatchObject([
    { kind: 'triggered', on: { kind: 'enters' }, decisions: { targets: [] }, instructions: [{ kind: 'becomeMonarch', targets: { kind: 'contextRef', name: 'controller' } }] },
    { kind: 'triggered', on: { kind: 'enters' }, decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', controller: 'opponent' } }, min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 } }] }, instructions: [{ kind: 'linkExile', targets: { kind: 'targetRef', clauseIndex: 0 }, untilOpponentMonarch: true }] },
  ])
})


test('Ripples of Undeath binds its first-main mill and pays mana plus life before recovering from that set', () => {
  expect(cardRuleDefinitionSnapshotFor('Ripples of Undeath')!.definition.abilities).toMatchObject([
    { kind: 'triggered', on: { kind: 'stepBegins', step: 'precombatMain', player: { name: 'controller' } }, instructions: [
      { kind: 'mill', count: { value: 3 }, bindChoice: 'milled' },
      { kind: 'payOptional', cost: { kind: 'manaAndLife', mana: '{1}', life: { value: 3 } }, ifPaid: [
        { kind: 'chooseCards', filter: { filter: { among: { kind: 'choiceRef', binding: 'milled' } } }, min: { value: 1 }, max: { value: 1 } },
        { kind: 'move', to: 'hand' },
      ] },
    ] },
  ])
})

test('Phial of Galadriel composes both conditional replacements and five-color tap mana', () => {
  const abilities = cardRuleDefinitionSnapshotFor('Phial of Galadriel')!.definition.abilities
  expect(abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'replacement', event: { kind: 'draw' }, when: { kind: 'compareAmount', operator: 'eq', right: { value: 0 } } }] },
    { kind: 'static', effects: [{ kind: 'replacement', event: { kind: 'gainLife' }, when: { kind: 'compareAmount', operator: 'lte', right: { value: 5 } }, transform: { kind: 'modifyEvent', changes: { amount: { kind: 'multiply', factor: { value: 2 } } } } }] },
    { kind: 'activated', costs: [{ kind: 'tapSource' }], instructions: [{ kind: 'chooseInstructions', options: ['W', 'U', 'B', 'R', 'G'].map(label => ({ label, instructions: [{ kind: 'addMana', amount: { [label]: { value: 1 } } }] })) }] },
  ])
})

test("Sin, Spira's Punishment repeats a random tapped copy while the exiled card is a land", () => {
  expect(cardRuleDefinitionSnapshotFor("Sin, Spira's Punishment")!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: KEYWORDS.flying },
    { kind: 'triggered', on: { kind: 'enters' }, instructions: [{ kind: 'chooseRandom' }, { kind: 'copy', tapped: true }, { kind: 'captureAmount' }, { kind: 'move' }, { kind: 'repeatWhile' }] },
    { kind: 'triggered', on: { kind: 'attacks' }, instructions: [{ kind: 'chooseRandom' }, { kind: 'copy', tapped: true }, { kind: 'captureAmount' }, { kind: 'move' }, { kind: 'repeatWhile' }] },
  ])
})

test('Awaken the Honored Dead is a three-chapter saga with a reflexive discard return', () => {
  expect(cardRuleDefinitionSnapshotFor('Awaken the Honored Dead')!.definition.abilities).toMatchObject([
    { kind: 'saga', chapters: [
      { numbers: [1], instructions: [{ kind: 'destroy' }] },
      { numbers: [2], instructions: [{ kind: 'mill' }] },
      { numbers: [3], instructions: [{ kind: 'payOptional', whenPaid: [{ kind: 'move' }] }] },
    ] },
  ])
})

test('Kiora Bests the Sea God creates a Kraken, skips the next untap, then steals', () => {
  expect(cardRuleDefinitionSnapshotFor('Kiora Bests the Sea God')!.definition.abilities).toMatchObject([
    { kind: 'saga', chapters: [
      { numbers: [1], instructions: [{ kind: 'createToken' }] },
      { numbers: [2], instructions: [{ kind: 'tap', skipNextUntap: true }] },
      { numbers: [3], instructions: [{ kind: 'changeControl' }, { kind: 'untap' }] },
    ] },
  ])
})

test('Summon: Titan mills, returns lands, then pumps another creature', () => {
  expect(cardRuleDefinitionSnapshotFor('Summon: Titan')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: KEYWORDS.reach },
    { kind: 'keyword', keyword: KEYWORDS.trample },
    { kind: 'saga', chapters: [
      { numbers: [1], instructions: [{ kind: 'mill' }] },
      { numbers: [2], instructions: [{ kind: 'move', to: 'battlefield', tapped: true }] },
      { numbers: [3], instructions: [{ kind: 'createEffect' }, { kind: 'createEffect' }] },
    ] },
  ])
})

test('Mirkwood Bats retains flying and one untargeted opponent drain per created or sacrificed token', () => {
  expect(cardRuleDefinitionSnapshotFor('Mirkwood Bats')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: 'flying' },
    { kind: 'triggered', on: { kind: 'tokenCreated', filter: { controller: 'you' } }, decisions: { targets: [] }, instructions: [{ kind: 'loseLife', amount: { value: 1 }, targets: { kind: 'players', filter: { relation: 'opponent' } } }] },
    { kind: 'triggered', on: { kind: 'sacrificed', filter: { controller: 'you', token: true } }, decisions: { targets: [] }, instructions: [{ kind: 'loseLife', amount: { value: 1 }, targets: { kind: 'players', filter: { relation: 'opponent' } } }] },
  ])
})


test('Sail into the West composes public voting with collected recovery or optional discard/draw', () => {
  expect(cardRuleDefinitionSnapshotFor('Sail into the West')!.definition.abilities).toMatchObject([
    { kind: 'spell', instructions: [
      { kind: 'vote', options: { kind: 'named', options: [{ id: 'return' }, { id: 'embark' }] } },
      { kind: 'if', condition: { kind: 'voteLeads', binding: 'vote', option: 'return' }, then: [
        { kind: 'chooseCardsForEachPlayer', min: { value: 0 }, max: { value: 2 }, filter: { filter: { zone: 'graveyard', owner: { name: 'event.player' } } } },
        { kind: 'move', to: 'hand' }, { kind: 'exileThisSpell' },
      ], otherwise: [{ kind: 'chooseParticipants' }, { kind: 'discardHands' }, { kind: 'draw', count: { value: 7 } }] },
    ] },
  ])
})

test.each([
  ['Blanket of Night', 'Swamp'],
  ['Urborg, Tomb of Yawgmoth', 'Swamp'],
  ['Yavimaya, Cradle of Growth', 'Forest'],
] as const)('catalog %s grants %s to every land', (name, landType) => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'grantLandType', landType, targets: { kind: 'objects', filter: { zone: 'battlefield', type: 'Land' } } }] },
  ])
})

test('Dakmor Salvage dredges two beside tapped entry and {B}', () => {
  expect(cardRuleDefinitionSnapshotFor('Dakmor Salvage')!.definition.abilities).toMatchObject([
    { kind: 'dredge', count: 2 },
    { kind: 'static', effects: [{ kind: 'replacement', event: { kind: 'enterBattlefield' }, transform: { kind: 'modifyEvent', changes: { tapped: true } } }] },
    { kind: 'activated', costs: [{ kind: 'tapSource' }], instructions: [{ kind: 'addMana', amount: { B: { value: 1 } } }] },
  ])
})

test('Life from the Loam dredges three and returns up to three owned graveyard lands', () => {
  expect(cardRuleDefinitionSnapshotFor('Life from the Loam')!.definition.abilities).toMatchObject([
    { kind: 'dredge', count: 3 },
    { kind: 'spell', decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'graveyard', owner: 'you', type: 'Land' } }, min: { value: 0 }, max: { value: 3 } }] }, instructions: [{ kind: 'move', to: 'hand' }] },
  ])
})

test('Myriad Landscape searches two basics that share a land type', () => {
  expect(cardRuleDefinitionSnapshotFor('Myriad Landscape')!.definition.abilities).toMatchObject([
    { kind: 'static' },
    { kind: 'activated', costs: [{ kind: 'tapSource' }] },
    { kind: 'activated', costs: [{ kind: 'mana', amount: '{2}' }, { kind: 'tapSource' }, { kind: 'sacrifice' }], instructions: [{ kind: 'sequence', instructions: [
      { kind: 'chooseCards', related: CHOICE_RELATIONS.shareLandType, min: { value: 0 }, max: { value: 2 }, filter: { filter: { zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] } } },
      { kind: 'move', to: 'battlefield', tapped: true },
      { kind: 'shuffle' },
    ] }] },
  ])
})

test('Finale of Devastation searches library or graveyard and pumps only at X ≥ 10', () => {
  expect(cardRuleDefinitionSnapshotFor('Finale of Devastation')!.definition.abilities).toMatchObject([
    { kind: 'spell', decisions: { variables: [{ name: 'X' }] }, instructions: [
      { kind: 'sequence', instructions: [
        { kind: 'chooseCards', filter: { filter: { owner: 'you', type: 'Creature', any: [{ zone: 'library' }, { zone: 'graveyard' }] } } },
        { kind: 'captureAmount' },
        { kind: 'move', to: 'battlefield' },
        { kind: 'if' },
      ] },
      { kind: 'if', condition: { kind: 'compareAmount', operator: 'gte', right: { value: 10 } } },
    ] },
  ])
})

test('Waterlogged Teachings searches an instant or a card with flash', () => {
  expect(cardRuleDefinitionSnapshotFor('Waterlogged Teachings')!.definition.abilities).toMatchObject([
    { kind: 'spell', instructions: [{ kind: 'sequence', instructions: [
      { kind: 'chooseCards', filter: { filter: { zone: 'library', owner: 'you', any: [{ type: 'Instant' }, { keyword: KEYWORDS.flash }] } } },
      { kind: 'reveal' },
      { kind: 'move', to: 'hand' },
      { kind: 'shuffle' },
    ] }] },
  ])
})

test('catalog Alabaster Host Intercessor composes linked exile and Plainscycling', () => {
  expect(cardRuleDefinitionSnapshotFor('Alabaster Host Intercessor')!.definition.abilities).toMatchObject([
    {
      kind: 'triggered', on: { kind: 'enters', filter: { kind: 'contextRef', name: 'source' } },
      decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', controller: 'opponent' } } }] },
      instructions: [{ kind: 'linkExile', targets: { kind: 'targetRef', clauseIndex: 0 }, untilSourceLeaves: true }],
    },
    {
      kind: 'activated', cycling: true, availableFrom: ['hand'],
      costs: [{ kind: 'mana', amount: '{2}' }, { kind: 'discard', filter: { kind: 'contextRef', name: 'source' } }],
      instructions: [{ kind: 'sequence', instructions: [
        { kind: 'chooseCards', chooser: { kind: 'contextRef', name: 'controller' }, filter: { kind: 'objects', filter: { zone: 'library', owner: 'you', subtypes: ['Plains'] } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 }, bindChoice: 'found', viewLibrary: true },
        { kind: 'move', targets: { kind: 'choiceRef', binding: 'found' }, to: 'hand' },
        { kind: 'shuffle', targets: { kind: 'contextRef', name: 'controller' } },
      ] }],
    },
  ])
})

test('family 21 catalog composes combat taxes, ward, devour, and even-mana restrictions', () => {
  expect(cardRuleDefinitionSnapshotFor('Archangel of Tithes')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: 'flying' },
    { kind: 'static', effects: [{ kind: 'attackTax', amount: 1, whileUntapped: true }, { kind: 'blockTax', amount: 1, whileAttacking: true }] },
  ])
  expect(cardRuleDefinitionSnapshotFor('Baird, Steward of Argive')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: 'vigilance' },
    { kind: 'static', effects: [{ kind: 'attackTax', amount: 1 }] },
  ])
  expect(cardRuleDefinitionSnapshotFor('Standard Bearer')!.definition.abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'targetingRequirement', requirement: 'flagbearer' }] },
  ])
  expect(cardRuleDefinitionSnapshotFor('Void Winnower')!.definition.abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'opponentsCantCast', parity: 'even' }, { kind: 'opponentsCantBlock', parity: 'even' }] },
  ])
  expect(cardRuleDefinitionSnapshotFor('Sire of Seven Deaths')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: 'reach' },
    { kind: 'keyword', keyword: KEYWORDS.firstStrike },
    { kind: 'keyword', keyword: 'vigilance' },
    { kind: 'keyword', keyword: 'menace' },
    { kind: 'keyword', keyword: 'trample' },
    { kind: 'keyword', keyword: 'lifelink' },
    { kind: 'static', effects: [{ kind: 'ward', cost: { kind: 'life', amount: 7 } }] },
  ])
  expect(cardRuleDefinitionSnapshotFor('Famished Worldsire')!.definition.abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'ward', cost: { kind: 'mana', generic: 3 } }, { kind: 'replacement' }] },
    { kind: 'triggered', on: { kind: 'enters' }, instructions: [
      { kind: 'inspectTop' },
      { kind: 'chooseCards' },
      { kind: 'move', to: 'battlefield', tapped: true },
      { kind: 'move', to: 'library', position: 'bottom', order: 'random' },
    ] },
  ])
  expect(cardRuleDefinitionSnapshotFor('Summon: Leviathan')!.definition.abilities).toMatchObject([
    { kind: 'static', effects: [{ kind: 'ward', cost: { kind: 'mana', generic: 2 } }] },
    { kind: 'saga', chapters: [
      { numbers: [1], instructions: [{ kind: 'move', to: 'hand' }] },
      { numbers: [2, 3], instructions: [{ kind: 'createDelayed', repeatUntilCleanup: true }] },
    ] },
  ])
})

test('catalog Wall of Shards composes its keywords and cumulative upkeep payment', () => {
  expect(cardRuleDefinitionSnapshotFor('Wall of Shards')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: 'defender' },
    { kind: 'keyword', keyword: 'flying' },
    { kind: 'triggered', on: { kind: 'stepBegins', step: 'upkeep', player: { kind: 'players', filter: { relation: 'you' } } } },
  ])
})

test('family 22 catalog composes characteristics, types, grants, and attachments', () => {
  const abilities = (name: string) => cardRuleDefinitionSnapshotFor(name)!.definition.abilities
  expect(abilities('Curious Colossus')).toMatchObject([{ decisions: { targets: [{ filter: { kind: 'players', filter: { relation: 'opponent' } } }] }, instructions: [
    { kind: 'createEffect', effect: { kind: 'addTypes', subtypes: ['Coward'] }, duration: { kind: 'permanent' } },
    { kind: 'createEffect', effect: { kind: 'removeAbilities' } },
    { kind: 'createEffect', effect: { kind: 'setStats', power: { kind: 'constant', value: 1 }, toughness: { kind: 'constant', value: 1 } } },
  ] }])
  expect(abilities('Masked Vandal')).toMatchObject([{ kind: 'keyword', keyword: 'changeling' }, { on: { kind: 'enters' }, instructions: [{ kind: 'sequence' }] }])
  expect(abilities('Maskwood Nexus')).toMatchObject([
    { effects: [{ kind: 'addTypes', allCreatureTypes: true }] },
    { costs: [{ kind: 'mana', amount: '{3}' }, { kind: 'tapSource' }], instructions: [{ kind: 'createToken', token: { colors: ['U'], abilities: [{ keyword: 'changeling' }] } }] },
  ])
  expect(cardTemplateDefaultsFor('Lumra, Bellow of the Woods')).toMatchObject({ types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Elemental', 'Bear'] })
  expect(abilities('Lumra, Bellow of the Woods')).toMatchObject([
    { keyword: 'reach' }, { keyword: 'vigilance' }, { effects: [{ kind: 'modifyStats', set: true, characteristicDefining: true }] },
    { instructions: [{ kind: 'mill', count: { value: 4 } }, { kind: 'move', to: 'battlefield', tapped: true }] },
  ])
  expect(abilities('Starfield of Nyx')).toMatchObject([{ on: { kind: 'stepBegins', step: 'upkeep' } }, { effects: [{ kind: 'addTypes', types: ['Creature'] }, { kind: 'modifyStats', set: true }] }])
  expect(abilities('Rain of Filth')).toMatchObject([{ instructions: [{ kind: 'createEffect', duration: { kind: 'untilCleanup' }, effect: { kind: 'grantActivatedAbility', ability: { costs: [{ kind: 'sacrifice', filter: { name: 'source' } }], instructions: [{ kind: 'addMana', amount: { B: { value: 1 } } }] } } }] }])
  expect(abilities('Kindred Dominance')).toMatchObject([{ instructions: [{ kind: 'chooseCreatureType' }, { kind: 'destroy' }] }])
  expect(abilities('Raise the Palisade')).toMatchObject([{ instructions: [{ kind: 'chooseCreatureType' }, { kind: 'move', to: 'hand' }] }])
  expect(abilities('Colossification')).toMatchObject([{ effects: [{ kind: 'enchant' }, { kind: 'modifyStats', power: { value: 20 }, toughness: { value: 20 } }] }, { on: { kind: 'enters' }, instructions: [{ kind: 'tap' }] }])
  expect(abilities('Tenuous Truce')).toMatchObject([{ effects: [{ kind: 'enchant', filter: { kind: 'players', filter: { relation: 'opponent' } } }] }, { on: { step: 'end' }, instructions: [{ kind: 'draw' }, { kind: 'draw' }] }, { on: { kind: 'playerAttacks' } }, { on: { kind: 'playerAttacks' } }])
})


test('zone-play catalog entries compose land permissions, top visibility, and token abilities', () => {
  const definitions = (name: string) => cardRuleDefinitionSnapshotFor(name)!.definition.abilities
  expect(definitions('Courser of Kruphix')).toMatchObject([
    { kind: 'static', effects: [{ kind: 'revealLibraryTop', players: { filter: { relation: 'you' } } }] },
    { kind: 'static', effects: [{ kind: 'playLands', topOnly: true, cards: { filter: { zone: 'library', type: 'Land', owner: 'you' } } }] },
    { kind: 'triggered', instructions: [{ kind: 'gainLife', amount: { kind: 'constant', value: 1 } }] },
  ])
  expect(definitions('Icetill Explorer')).toMatchObject([
    { kind: 'static', effects: [{ kind: 'extraLandPlays', count: 1 }] },
    { kind: 'static', effects: [{ kind: 'playLands', cards: { filter: { zone: 'graveyard', owner: 'you', type: 'Land' } } }] },
    { kind: 'triggered', instructions: [{ kind: 'mill', count: { kind: 'constant', value: 1 } }] },
  ])
  expect(definitions('Mole Man, Moloid Master')).toMatchObject([
    { kind: 'static', effects: [{ kind: 'playLands' }] },
    { kind: 'triggered', instructions: [{ kind: 'createToken', token: { name: 'Moloid', colors: ['G'], abilities: [
      { kind: 'triggered', instructions: [{ kind: 'chooseInstructions' }] },
    ] } }] },
  ])
})
