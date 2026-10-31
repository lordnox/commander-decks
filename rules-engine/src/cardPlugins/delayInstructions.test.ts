import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { choiceEffects } from './choiceEffects'
import { librarySearch } from './librarySearch'
import { targetedResolve } from './targetedResolve'
import { ward } from './ward'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('Malakir Rebirth', () => {
  test('the catalog spell returns its target if it dies this turn', () => {
    const creature = cardTemplate('Watched Bear', { types: ['Creature'], power: 2, toughness: 2 })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Malakir Rebirth')] },
        battlefield: { p1: [creature] },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve, activated, choiceEffects, librarySearch, ward] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.B = 1
    const watched = named(ready, 'Watched Bear').id
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Malakir Rebirth').id,
      targets: [{ kind: 'object', objectId: watched }],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.players.p1.life).toBe(commanderRules.startingLife - 2)
    expect(resolved.objects[watched].canonicalGrantedAbilities).toHaveLength(1)
    const died = ok(server.rules(resolved, { type: 'move', objectId: watched, to: 'graveyard' }))
    const returned = resolveStack(server.rules, died)
    expect(returned.objects[watched]).toMatchObject({ zone: 'battlefield', tapped: true })
  })
})
