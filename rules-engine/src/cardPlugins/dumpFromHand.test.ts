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
  test('Show and Tell asks each player to put a permanent', () => {
    const monster = cardTemplate('Apex Altisaur', { types: ['Creature'], power: 10, toughness: 10 })
    const land = cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'], tapProduces: { G: 1 } })
    const spell = cardTemplate('Show and Tell', {
      types: ['Sorcery'],
      manaCost: '{2}{U}',
      manaValue: 3,
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [spell, monster], p2: [land] },
      },
      { random: () => 0.5, cardPlugins: [onResolve, dumpFromHand, choiceEffects] },
    )
    const withMana = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 1, B: 0, R: 0, G: 2, C: 0 } },
      },
    }
    const cast = ok(server.rules(withMana, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(withMana, 'Show and Tell').id,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    const first = pendingDialog(resolved)
    expect(first).toMatchObject({
      kind: 'put-permanents',
      source: 'Show and Tell',
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
