import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { enters } from './effects'
import { randomExileCopy } from './randomExileCopy'

describe('random exile copy handler', () => {
  test('runs from declarative instructions without checking the source card name', () => {
    const source = cardTemplate('Generic Random Copier', {
      types: ['Creature'],
      effects: [enters({
        kind: 'randomExileCopyWhile',
        repeatWhileType: 'Land',
        tapped: true,
      })],
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            source,
            cardTemplate('Test Land', { types: ['Land'] }),
            cardTemplate('Test Relic', { types: ['Artifact'] }),
          ],
        },
      },
      { random: () => 0, cardPlugins: [randomExileCopy] },
    )
    let state = server.state
    for (const objectId of state.zoneOrder.p1.hand.slice(1)) {
      state = ok(server.rules(state, { type: 'move', objectId, to: 'graveyard' }))
    }
    state = ok(server.rules(state, {
      type: 'move',
      objectId: state.zoneOrder.p1.hand[0],
      to: 'battlefield',
    }))
    state = resolveStack(server.rules, state)

    const tokens = Object.values(state.objects).filter((object) => object.token)
    expect(tokens.map((token) => token.name)).toEqual(['Test Land', 'Test Relic'])
    expect(tokens.every((token) => token.tapped)).toBe(true)
  })
})
