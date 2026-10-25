import { describe, expect, test } from 'bun:test'
import { cardRuleDefinitionSnapshotFor } from './cardRuleCatalog'
import { damage, draws, gainLife, players, ref, self } from './v1'

describe('cardRuleCatalog — damageAndLeaves', () => {
  test('Flame Rift composes four damage to every player from the spell source', () => {
    expect(cardRuleDefinitionSnapshotFor('Flame Rift')!.definition.abilities).toMatchObject([{
      kind: 'spell',
      instructions: [damage({ amount: 4, targets: players({ relation: 'any' }), source: ref('source') })],
    }])
  })

  test('Thragtusk composes self-entry life gain and self-leave token creation rather than dies', () => {
    expect(cardRuleDefinitionSnapshotFor('Thragtusk')!.definition.abilities).toMatchObject([{
      kind: 'triggered',
      on: self.enters,
      instructions: [gainLife({ amount: 5, targets: ref('controller') })],
    }, {
      kind: 'triggered',
      on: self.leaves,
      instructions: [{
        kind: 'createToken',
        count: { kind: 'constant', value: 1 },
        targets: ref('controller'),
        token: { name: 'Beast', types: ['Creature'], subtypes: ['Beast'], colors: ['G'], power: 3, toughness: 3 },
      }],
    }])
  })

  test('Fate Unraveler composes opponent-draw damage to the triggering player', () => {
    expect(cardRuleDefinitionSnapshotFor('Fate Unraveler')!.definition.abilities).toMatchObject([{
      kind: 'triggered',
      on: draws({ player: players({ relation: 'opponent' }) }),
      instructions: [damage({ amount: 1, targets: ref('triggering.player'), source: ref('source') })],
    }])
  })
})
