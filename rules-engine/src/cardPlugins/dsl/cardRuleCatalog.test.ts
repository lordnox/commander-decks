import { expect, test } from 'bun:test'
import { effectsFor } from '../cardRules'
import { cardRuleDefinitionSnapshotFor, cardTemplateDefaultsFor } from './cardRuleCatalog'

// Card configuration has structural coverage; instruction suites own execution.
test.each([
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
    instructions: [{ kind: 'chooseInstructions', options: [
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
