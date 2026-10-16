import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { effectsFor } from './cardRules'
import { entersTapped as entersTappedPlugin } from './entersTapped'
import { onResolve as onResolvePlugin } from './onResolve'
import { targetedResolve } from './targetedResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const filler = (name: string) => cardTemplate(name, { types: ['Instant'] })

const enterBattlefield = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  name: string,
) => resolveStack(server.rules, ok(server.rules(state, {
  type: 'move',
  objectId: named(state, name).id,
  to: 'battlefield',
})))

describe('plug-dack part 37 card pool', () => {
  test('Sandstone Oracle resolves entersTargetingOpponent into drawHandDifference draws', () => {
    const oracle = cardTemplate('Sandstone Oracle', {
      types: ['Artifact', 'Creature'],
      effects: effectsFor('Sandstone Oracle'),
    })
    const server = createServerGame(
      commanderRules,
      {
        players: 3,
        hands: {
          p1: [oracle],
          p2: [filler('P2a'), filler('P2b'), filler('P2c')],
          p3: [filler('P3a')],
        },
        libraries: {
          p1: [filler('D1'), filler('D2'), filler('D3'), filler('D4')],
        },
      },
      { random: () => 0.5 },
    )
    let state = enterBattlefield(server, server.state, 'Sandstone Oracle')
    const choice = pendingPlayerSelectionFor(state, 'p1')!
    expect(choice.prompt).toContain('opponent')
    expect(choice.action).toMatchObject({
      kind: 'putTriggeredAbility',
      instructions: [{ kind: 'drawHandDifference' }],
    })
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: choice.id,
      players: ['p2'],
    }))
    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p1.hand).toHaveLength(3)
    expect(state.zoneOrder.p2.hand).toHaveLength(3)
  })

  test('Subjugator Angel taps opposing creatures on enter', () => {
    const angel = cardTemplate('Subjugator Angel', {
      types: ['Creature'],
      effects: effectsFor('Subjugator Angel'),
    })
    const mine = cardTemplate('My Soldier', { types: ['Creature'] })
    const theirs = cardTemplate('Their Soldier', { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [angel] },
        battlefield: { p1: [mine], p2: [theirs] },
      },
      { random: () => 0.5, cardPlugins: [onResolvePlugin, targetedResolve, entersTappedPlugin] },
    )
    const entered = enterBattlefield(server, server.state, 'Subjugator Angel')
    expect(entered.objects[named(entered, 'My Soldier').id].tapped).toBe(false)
    expect(entered.objects[named(entered, 'Their Soldier').id].tapped).toBe(true)
  })

})
