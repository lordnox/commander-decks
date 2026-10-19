import { expect, test } from 'bun:test'
import { effectsFor } from '../cardRules'
import { cardRuleDefinitionSnapshotFor, cardTemplateDefaultsFor } from './cardRuleCatalog'

// Card configuration has structural coverage; instruction suites own execution.
test.each([
  ['Cloudshift', ['blink']],
  ['Flicker of Fate', ['blink']],
  ['Counterspell', ['counter']],
  ['Absorb', ['counter', 'gainLife']],
  ['Anguished Unmaking', ['move', 'loseLife']],
  ['Aetherize', ['move']],
  ['Dismember', ['createEffect']],
  ['Harrow', ['sequence']],
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
  ['Murder', ['destroy']],
  ['Sign in Blood', ['draw', 'loseLife']],
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
  ['Dismember', 'objects', { zone: 'battlefield', type: 'Creature' }],
  ['Anguished Unmaking', 'objects', { zone: 'battlefield', not: { type: 'Land' } }],
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

test('unmigrated Mulldrifter keeps CARD_RULES effects instead of a catalog snapshot', () => {
  expect(cardRuleDefinitionSnapshotFor('Mulldrifter')).toBeUndefined()
  expect(cardTemplateDefaultsFor('Mulldrifter')).toBeUndefined()
  expect(effectsFor('Mulldrifter').length).toBeGreaterThan(0)
})

test('catalog lookup is exact and rejects inherited object keys', () => {
  for (const name of ['counterspell', ' Counterspell', 'toString', 'constructor', '__proto__']) {
    expect(cardRuleDefinitionSnapshotFor(name)).toBeUndefined()
    expect(cardTemplateDefaultsFor(name)).toBeUndefined()
  }
})

test('template callers own their characteristics and rule snapshot', () => {
  const original = cardTemplateDefaultsFor('Counterspell')!
  const edited = cardTemplateDefaultsFor('Counterspell')!
  edited.types.push('Creature')
  Reflect.set(edited.ruleDefinition.definition.abilities, 'length', 0)
  expect(cardTemplateDefaultsFor('Counterspell')).toEqual(original)
  expect(cardRuleDefinitionSnapshotFor('Counterspell')).toEqual(original.ruleDefinition)
  expect(cardTemplateDefaultsFor('Absorb')).toMatchObject({ manaCost: '{W}{U}{U}', manaValue: 3 })
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


test.each(['Charcoal Diamond', 'Sky Diamond', 'Worn Powerstone', 'Mistvault Bridge', 'Bala Ged Sanctuary', 'Fell Mire', 'Malakir Mire'])('catalog %s replaces its own entry with tapped entry', name => {
  expect(effectsFor(name)).toEqual([])
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities).toMatchObject([{
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
  expect(cardRuleDefinitionSnapshotFor(name)!.definition.abilities).toMatchObject([{
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
