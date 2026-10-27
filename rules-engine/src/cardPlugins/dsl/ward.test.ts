import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame, projectForViewer } from '../../runtime'
import { DIALOG_CHOSEN, pendingDialog } from '../../pendingDialog'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { pendingSelectionFor } from '../../rules/selectCards'
import { ok } from '../../testHelpers'
import {
  activated,
  animate,
  ref,
  tapCost,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  select,
  spell,
  staticAbility,
  saga,
  objects,
  changeControl,
  target,
  ward,
} from './v1'
const snapshot = (cost: Parameters<typeof ward>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card([staticAbility(ward(cost))])))

const targetSpell = createDefinitionSnapshot(compileCardRuleDefinition(card([
  spell({
    decisions: { targets: [select({ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature' } }, count: 1 })] },
    instructions: [],
  }),
])))

const game = (cost: Parameters<typeof ward>[0], extras: Parameters<typeof createServerGame>[1] = {}) =>
  createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Canonical Target Spell', {
      types: ['Instant'],
      manaCost: '{0}',
      manaValue: 0,
      ruleDefinition: targetSpell,
    })] },
    battlefield: {
      p2: [cardTemplate('Warded fixture', {
        types: ['Creature'],
        power: 2,
        toughness: 2,
        ruleDefinition: snapshot(cost),
      })],
      ...extras.battlefield,
    },
  }, { random: () => 0 })

test('a catalog permanent presents its printed ward payment to the target player', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Roaming Throne')] },
    hands: { p2: [cardTemplate('Ward probe', { types: ['Instant'], manaCost: '{C}', ruleDefinition: targetSpell })] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  ready.priority = 'p2'
  ready.players.p2.mana.C = 3
  const cast = ok(server.rules(ready, {
    type: 'castSpell',
    seat: 'p2',
    objectId: Object.values(ready.objects).find(object => object.name === 'Ward probe')!.id,
    targets: [{ kind: 'object', objectId: Object.values(ready.objects).find(object => object.name === 'Roaming Throne')!.id }],
  }))
  const waiting = ok(server.rules(cast, { type: 'resolveTop' }))
  expect(pendingDialog(waiting)).toMatchObject({ kind: 'ward-pay', count: 2 })
})

const castAt = (server: ReturnType<typeof game>) => ok(server.rules(server.state, {
  type: 'castSpell',
  seat: 'p1',
  objectId: Object.values(server.state.objects).find(object => object.name === 'Canonical Target Spell')!.id,
  targets: [{ kind: 'object', objectId: Object.values(server.state.objects).find(object => object.name === 'Warded fixture')!.id }],
}))

test('canonical mana ward leaves a stack trigger and counters on decline', () => {
  const server = game({ kind: 'mana', generic: 2 })
  const cast = castAt(server)
  expect(cast.stack[0]?.payload?.canonicalWard).toBe(true)
  const waiting = ok(server.rules(cast, { type: 'resolveTop' }))
  expect(projectForViewer(waiting, 'p1').stack[0]?.payload?.warded).toBeUndefined()
  expect(pendingDialog(waiting)).toMatchObject({ kind: 'ward-pay', count: 2 })
  const declined = ok(server.rules(waiting, {
    type: 'custom',
    name: DIALOG_CHOSEN,
    seat: 'p1',
    payload: { accepted: false },
  }))
  expect(declined.stack.some(item => item.kind === 'spell')).toBe(false)
})

test('canonical life ward asks the caster and decline counters the spell', () => {
  const server = game({ kind: 'life', amount: 2 })
  const waiting = ok(server.rules(castAt(server), { type: 'resolveTop' }))
  const selection = pendingOptionSelection(waiting, 'p1')!
  expect(selection.action).toMatchObject({ kind: 'ward-life', life: 2 })
  const declined = ok(server.rules(waiting, {
    type: 'selectOption',
    seat: 'p1',
    selectionId: selection.id,
    optionId: 'decline',
  }))
  expect(declined.stack.some(item => item.kind === 'spell')).toBe(false)
  expect(Object.values(declined.objects).find(object => object.name === 'Canonical Target Spell')?.zone).toBe('graveyard')
})

test('canonical sacrifice ward requires the full nonland set', () => {
  const server = game({ kind: 'sacrifice', count: 2, nonland: true }, {
    battlefield: {
      p1: [
        cardTemplate('Offering A', { types: ['Creature'], power: 1, toughness: 1 }),
        cardTemplate('Offering B', { types: ['Creature'], power: 1, toughness: 1 }),
        cardTemplate('Forest', { types: ['Land'] }),
      ],
    },
  })
  const waiting = ok(server.rules(castAt(server), { type: 'resolveTop' }))
  const selection = pendingSelectionFor(waiting, 'p1')!
  expect(selection).toMatchObject({ kind: 'sacrifice', count: 2, min: 2 })
  expect(selection.candidates).toHaveLength(2)
  const paid = ok(server.rules(waiting, {
    type: 'selectCards',
    seat: 'p1',
    selectionId: selection.id,
    kind: 'sacrifice',
    count: 2,
    objectIds: selection.candidates,
  }))
  expect(paid.stack.some(item => item.kind === 'spell')).toBe(true)
  expect(paid.objects[selection.candidates[0]!]?.zone).not.toBe('battlefield')
})

test('the compiler rejects an empty ward cost', () => {
  expect(() => compileCardRuleDefinition(card([staticAbility(ward({ kind: 'mana', generic: 0 }))]))).toThrow()
  expect(() => compileCardRuleDefinition(card([staticAbility(ward({ kind: 'life', amount: 0 }))]))).toThrow()
})

test('temporary ward instances stack independently, survive restore, and expire at cleanup', () => {
  const server = game({ kind: 'mana', generic: 1 })
  const fixture = Object.values(server.state.objects).find(object => object.name === 'Warded fixture')!
  fixture.ruleDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({ costs: [], instructions: [animate({ targets: ref('source'), ward: { kind: 'mana', generic: 3 } })] })])))
  let state = server.state
  for (let index = 0; index < 2; index += 1) {
    state = ok(server.rules({ ...state, priority: 'p2' }, { type: 'activateAbility', seat: 'p2', objectId: fixture.id, abilityId: '$.abilities[0]' }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
  }
  state = { ...state, priority: 'p1' }
  const cast = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'castSpell', seat: 'p1', objectId: Object.values(state.objects).find(object => object.name === 'Canonical Target Spell')!.id, targets: [{ kind: 'object', objectId: fixture.id }] }))
  expect(cast.stack.filter(item => item.payload?.canonicalWard)).toHaveLength(2)
  const expired = ok(server.rules({ ...state, step: 'end' }, { type: 'advanceStep' }))
  const after = ok(server.rules(expired, { type: 'castSpell', seat: 'p1', objectId: Object.values(state.objects).find(object => object.name === 'Canonical Target Spell')!.id, targets: [{ kind: 'object', objectId: fixture.id }] }))
  expect(after.stack.filter(item => item.payload?.canonicalWard)).toHaveLength(0)
})

test.each([false, true])('ward targets canonical activations after costs commit (tap=%s)', tapped => {
  const server = game({ kind: 'mana', generic: 3 }, { battlefield: { p1: [cardTemplate('Ability fixture', {
    types: ['Artifact'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([activated({ costs: tapped ? [tapCost()] : [], decisions: { targets: [select({ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature' } }, count: 1 })] }, instructions: [] })]))),
  })] } })
  const source = Object.values(server.state.objects).find(object => object.name === 'Ability fixture')!
  const target = Object.values(server.state.objects).find(object => object.name === 'Warded fixture')!
  const state = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]', targets: [{ kind: 'object', objectId: target.id }] }))
  expect(state.objects[source.id]!.tapped).toBe(tapped)
  expect(state.stack).toHaveLength(2)
  expect(state.stack[0]!.payload?.canonicalWard).toBe(true)
  const waiting = ok(server.rules(state, { type: 'resolveTop' }))
  const declined = ok(server.rules(waiting, { type: 'custom', name: DIALOG_CHOSEN, seat: 'p1', payload: { accepted: false } }))
  expect(declined.stack).toHaveLength(0)
  expect(declined.objects[source.id]!.zone).toBe('battlefield')
})

test('ward uses format-defined opponents rather than every other controller', () => {
  const server = game({ kind: 'mana', generic: 3 })
  server.state.opponents.p2 = []
  expect(castAt(server).stack.filter(item => item.payload?.canonicalWard)).toHaveLength(0)
})

test.each([
  { pay: false, catalog: false }, { pay: true, catalog: false },
  { pay: false, catalog: true }, { pay: true, catalog: true },
])('targeted chapters trigger ward after choosing targets (%j)', ({ pay, catalog }) => {
  const server = game({ kind: 'mana', generic: 5 }, { battlefield: { p1: [catalog ? cardTemplate('Kiora Bests the Sea God', { counters: { lore: 2 } }) : cardTemplate('Chapter fixture', {
    types: ['Enchantment'], subtypes: ['Saga'], counters: { lore: 2 },
    ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([saga({ chapters: [
      { numbers: [1, 2], instructions: [] },
      { numbers: [3], decisions: { targets: [select({ filter: objects({ zone: 'battlefield', controller: 'opponent' }), count: 1 })] }, instructions: [changeControl({ targets: target(0), controller: ref('controller') })] },
    ] })]))),
  })] } })
  const source = Object.values(server.state.objects).find(object => object.name === (catalog ? 'Kiora Bests the Sea God' : 'Chapter fixture'))!
  const foe = Object.values(server.state.objects).find(object => object.name === 'Warded fixture')!
  const choosing = ok(server.rules(server.state, { type: 'putCounters', objectId: source.id, counter: 'lore', count: 1 }))
  expect(choosing.stack).toHaveLength(0)
  expect(pendingDialog(choosing)).toBeUndefined()
  const pick = pendingSelectionFor(choosing, 'p1')!
  const stacked = ok(server.rules(choosing, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [foe.id] }))
  expect(stacked.stack).toHaveLength(2)
  const chapter = stacked.stack[1]!
  expect(chapter.targets).toEqual([{ kind: 'object', objectId: foe.id, incarnation: foe.incarnation, zone: 'battlefield' }])
  expect(stacked.stack[0]).toMatchObject({ controller: 'p2', payload: { canonicalWard: true, spellStackId: chapter.id } })
  expect(stacked.priority).toBe('p1')
  expect(pendingDialog(stacked)).toBeUndefined()
  const waiting = ok(server.rules(JSON.parse(JSON.stringify(stacked)), { type: 'resolveTop' }))
  expect(waiting.objects[foe.id].controller).toBe('p2')
  expect(waiting.stack.some(item => item.id === chapter.id)).toBe(true)
  expect(pendingDialog(waiting)).toMatchObject({ kind: 'ward-pay', count: 5, seat: 'p1' })
  waiting.players.p1.mana.C = 5
  const answered = ok(server.rules(JSON.parse(JSON.stringify(waiting)), { type: 'custom', name: DIALOG_CHOSEN, seat: 'p1', payload: { accepted: pay } }))
  expect(answered.objects[foe.id].controller).toBe('p2')
  expect(answered.stack).toHaveLength(pay ? 1 : 0)
  if (pay) {
    expect(answered.players.p1.mana.C).toBe(0)
    const done = ok(server.rules(answered, { type: 'resolveTop' }))
    expect(done.objects[foe.id].controller).toBe('p1')
    expect(done.objects[source.id].zone).toBe('graveyard')
  } else {
    expect(answered.objects[source.id].zone).toBe('graveyard')
  }
})
