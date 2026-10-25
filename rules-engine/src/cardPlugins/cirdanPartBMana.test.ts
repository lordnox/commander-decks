import { describe, expect, test } from 'bun:test'
import { deckCardTemplate } from '../deckCardFixtures'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import type { CardTemplate } from '../newGame'
import { pendingOptionSelection } from '../rules/selectOptions'
import { PAY_LIFE_OPTION } from './dsl/v1'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'

/**
 * Círdan part B (mana): Sea Gate Restoration // Sea Gate, Reborn privacy and restart
 * coverage that remains for #403, built from the deck's Oracle text.
 */

const SEA_GATE = 'Sea Gate Restoration // Sea Gate, Reborn'

const game = (options: { hand?: CardTemplate[] }) =>
  createServerGame(
    commanderRules,
    {
      players: 2,
      hands: { p1: options.hand ?? [] },
      libraries: {
        p1: Array.from({ length: 12 }, (_, index) => cardTemplate(`Library ${index}`)),
      },
    },
    { random: () => 0.5 },
  )

type Server = ReturnType<typeof game>

const one = (state: GameState, name: string) =>
  Object.values(state.objects).filter((object) => object.name === name)[0]

const playSeaGate = (server: Server, state = server.state) =>
  ok(server.rules(state, {
    type: 'playLand',
    seat: 'p1',
    objectId: one(state, SEA_GATE).id,
  }))

describe('Sea Gate Restoration // Sea Gate, Reborn', () => {
  const card = () => deckCardTemplate(SEA_GATE)

  test('the life choice is private to its controller and survives a restart', () => {
    const server = game({ hand: [card()] })
    const asked = playSeaGate(server)
    expect(server.project(asked, 'p1').players.p1.data['kernel.pendingOptionSelection']).toBeDefined()
    expect(server.project(asked, 'p2').players.p1.data['kernel.pendingOptionSelection']).toBeUndefined()
    const restarted = structuredClone(asked)
    const pending = pendingOptionSelection(restarted, 'p1')!
    const paid = ok(server.rules(restarted, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: PAY_LIFE_OPTION,
    }))
    expect(paid.players.p1.life).toBe(server.state.players.p1.life - 3)
  })
})
