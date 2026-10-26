import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { pendingOptionSelection } from '../rules/selectOptions'

const niv = () => cardTemplate('Niv-Mizzet, Ghost Counsel', {
  types: ['Creature'],
  subtypes: ['Spirit', 'Dragon'],
  supertypes: ['Legendary'],
  colors: 'WB',
  power: 4,
  toughness: 4,
})

const game = () => createServerGame(
  commanderRules,
  {
    battlefield: { p1: [niv()] },
    libraries: {
      p1: [
        cardTemplate('Plains', { types: ['Land'] }),
        cardTemplate('Island', { types: ['Land'] }),
        cardTemplate('Swamp', { types: ['Land'] }),
        cardTemplate('Mountain', { types: ['Land'] }),
      ],
    },
  },
  { random: () => 0.5 },
)

const gainAndResolve = (
  server: ReturnType<typeof game>,
  state: ReturnType<typeof game>['state'],
  amount: number,
) => {
  const gained = ok(server.rules(state, { type: 'gainLife', seat: 'p1', amount }))
  return resolveStack(server.rules, gained)
}

describe('Niv-Mizzet, Ghost Counsel', () => {
  test('opponents do not see the pending payment in projection', () => {
    const server = game()
    const offered = gainAndResolve(server, server.state, 1)
    expect(pendingOptionSelection(offered, 'p1')).toBeDefined()
    expect(server.project(offered, 'p2').players.p1.data['kernel.pendingOptionSelection']).toBeUndefined()
  })

  test('host restart keeps the open optional life payment', () => {
    const server = game()
    const offered = gainAndResolve(server, server.state, 2)
    const restarted = structuredClone(offered)
    expect(pendingOptionSelection(restarted, 'p1')).toMatchObject({
      seat: 'p1',
      source: 'Niv-Mizzet, Ghost Counsel',
    })
  })
})
