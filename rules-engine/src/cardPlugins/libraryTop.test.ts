import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { courserOfKruphix } from './courserOfKruphix'
import {
  draw,
  gainLife,
  landfall,
  onResolve as onResolveEffect,
  staticPlayLandsFromLibraryTop,
  staticRevealLibraryTop,
} from './effects'
import { onResolve } from './onResolve'

const card = (name: string, types: string[] = ['Instant']) =>
  cardTemplate(name, { types })

const forest = () => cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'] })

const revealer = () => cardTemplate('Fixture Library Top', {
  types: ['Enchantment', 'Creature'],
  effects: [
    staticRevealLibraryTop(),
    staticPlayLandsFromLibraryTop(),
    landfall(gainLife(1)),
  ],
})

const plugins = { random: () => 0.5, cardPlugins: [onResolve, courserOfKruphix] }

const passAll = (server: ReturnType<typeof createServerGame>, state: Parameters<typeof server.rules>[0]) => {
  let current = state
  for (const seat of current.playerOrder) {
    current = ok(server.rules(current, { type: 'passPriority', seat }))
  }
  return current
}

describe('public library top', () => {
  test('reveals the library top while a reveal-top source is on the battlefield', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [revealer()] },
        libraries: { p1: [card('Card A'), card('Card B')] },
        players: 2,
      },
      plugins,
    )

    const opponent = server.project(server.state, 'p2')
    expect(opponent.players.p1.data.revealed_top).toEqual(['Card A'])
    expect(opponent.zoneOrder.p1.library).toEqual([])
  })

  test('draw 3 during a resolving spell keeps each card known with no priority between draws', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [revealer()] },
        hands: { p1: [cardTemplate('Draw Three', {
          types: ['Sorcery'],
          effects: [onResolveEffect(draw(3))],
        })] },
        libraries: {
          p1: [card('Card A'), card('Card B'), card('Card C'), card('Card D')],
        },
        players: 2,
      },
      plugins,
    )

    expect(server.project(server.state, 'p2').players.p1.data.revealed_top).toEqual(['Card A'])

    const spellId = server.state.zoneOrder.p1.hand[0]
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellId }))
    const resolved = passAll(server, cast)

    expect(resolved.stack).toHaveLength(0)
    expect(resolved.stack.some((item) => item.actionId === 'draw')).toBe(false)

    const opponent = server.project(resolved, 'p2')
    expect(opponent.zoneOrder.p1.hand.map((id) => opponent.objects[id].name)).toEqual([
      'Card A',
      'Card B',
      'Card C',
    ])
    expect(opponent.players.p1.data.revealed_top).toEqual(['Card D'])
  })

  test('may play a land from the top of the library', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [revealer()] },
        libraries: { p1: [forest(), card('Bolt')] },
        players: 2,
      },
      plugins,
    )

    const landId = server.state.zoneOrder.p1.library[0]
    const played = resolveStack(
      server.rules,
      ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: landId })),
    )

    expect(played.objects[landId].zone).toBe('battlefield')
    expect(played.players.p1.life).toBe(commanderRules.startingLife + 1)
    expect(server.project(played, 'p2').players.p1.data.revealed_top).toEqual(['Bolt'])
  })

  test('stops revealing the library top when the source leaves', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [revealer()] },
        libraries: { p1: [card('Card A')] },
        players: 2,
      },
      plugins,
    )

    const sourceId = server.state.zoneOrder.p1.battlefield[0]
    const left = ok(server.rules(server.state, {
      type: 'move',
      objectId: sourceId,
      to: 'graveyard',
    }))

    expect(server.project(left, 'p2').players.p1.data.revealed_top).toBeUndefined()
  })
})
