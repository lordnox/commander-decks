import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import { choiceEffects } from './choiceEffects'
import { dumpFromHand } from './dumpFromHand'
import { onResolve } from './onResolve'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('dump from hand', () => {
  test('Hypergenesis asks each player to put a permanent', () => {
    const monster = cardTemplate('Apex Altisaur', { types: ['Creature'], power: 10, toughness: 10 })
    const land = cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'], tapProduces: { G: 1 } })
    const spell = cardTemplate('Hypergenesis', {
      types: ['Sorcery'],
      manaCost: '{0}',
      manaValue: 0,
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [spell, monster], p2: [land] },
      },
      { random: () => 0.5, cardPlugins: [onResolve, dumpFromHand, choiceEffects] },
    )
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Hypergenesis').id,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    const first = pendingDialog(resolved)
    expect(first).toMatchObject({
      kind: 'put-permanents',
      source: 'Hypergenesis',
      seat: 'p1',
    })
    expect(pendingDialog(ok(server.rules(resolved, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { objectIds: [] },
    })))).toMatchObject({ seat: 'p2', kind: 'put-permanents' })
  })
})
