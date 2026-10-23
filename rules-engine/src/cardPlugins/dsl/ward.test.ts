import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame, projectForViewer } from '../../runtime'
import { DIALOG_CHOSEN, pendingDialog } from '../../pendingDialog'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { pendingSelectionFor } from '../../rules/selectCards'
import { ok } from '../../testHelpers'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  select,
  spell,
  staticAbility,
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
