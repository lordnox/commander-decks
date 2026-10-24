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
  colors: ['W', 'B'],
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

const nivId = (state: ReturnType<typeof game>['state']) =>
  Object.values(state.objects).find((object) => object.name === 'Niv-Mizzet, Ghost Counsel')!.id

const gainAndResolve = (
  server: ReturnType<typeof game>,
  state: ReturnType<typeof game>['state'],
  amount: number,
) => {
  const gained = ok(server.rules(state, { type: 'gainLife', seat: 'p1', amount }))
  return resolveStack(server.rules, gained)
}

const choosePay = (
  server: ReturnType<typeof game>,
  state: ReturnType<typeof game>['state'],
  optionId: 'pay' | 'decline',
) => ok(server.rules(state, {
  type: 'selectOption',
  seat: 'p1',
  selectionId: pendingOptionSelection(state, 'p1')!.id,
  optionId,
}))

describe('Niv-Mizzet, Ghost Counsel', () => {
  test('only its controller gaining life puts the trigger on the stack', () => {
    const server = game()
    const opponentGain = ok(server.rules(server.state, { type: 'gainLife', seat: 'p2', amount: 5 }))
    expect(opponentGain.stack).toHaveLength(0)

    const yours = ok(server.rules(server.state, { type: 'gainLife', seat: 'p1', amount: 2 }))
    expect(yours.stack[0]).toMatchObject({
      kind: 'ability',
      name: 'Niv-Mizzet, Ghost Counsel',
      controller: 'p1',
    })
  })

  test('accepting pays life and draws using the captured gain amount', () => {
    const server = game()
    const offered = gainAndResolve(server, server.state, 3)
    expect(pendingOptionSelection(offered, 'p1')).toMatchObject({
      seat: 'p1',
      source: 'Niv-Mizzet, Ghost Counsel',
    })
    const beforeHand = offered.zoneCounts.p1.hand
    const accepted = choosePay(server, offered, 'pay')
    expect(accepted.players.p1.life).toBe(40)
    expect(accepted.zoneCounts.p1.hand).toBe(beforeHand + 3)
    expect(pendingOptionSelection(accepted, 'p1')).toBeUndefined()
  })

  test('declining leaves life and hand unchanged', () => {
    const server = game()
    const offered = gainAndResolve(server, server.state, 2)
    const beforeHand = offered.zoneCounts.p1.hand
    const declined = choosePay(server, offered, 'decline')
    expect(declined.players.p1.life).toBe(42)
    expect(declined.zoneCounts.p1.hand).toBe(beforeHand)
  })

  test('cannot accept when life is below the trigger amount', () => {
    const server = game()
    let state = ok(server.rules(server.state, { type: 'gainLife', seat: 'p1', amount: 5 }))
    state = resolveStack(server.rules, state)
    state.players.p1.life = 3
    expect(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pendingOptionSelection(state, 'p1')!.id,
      optionId: 'pay',
    }).ok).toBe(false)
  })

  test('tap drains opponents, gains one life, then offers pay-one-draw-one without looping', () => {
    const server = game()
    const objectId = nivId(server.state)
    const tapped = ok(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId,
      abilityId: '$.abilities[2]',
    }))
    const drained = resolveStack(server.rules, tapped)
    expect(drained.players.p2.life).toBe(39)
    expect(drained.players.p1.life).toBe(41)
    expect(pendingOptionSelection(drained, 'p1')).toBeDefined()

    const paid = choosePay(server, drained, 'pay')
    expect(paid.players.p1.life).toBe(40)
    expect(paid.stack).toHaveLength(0)
    expect(pendingOptionSelection(paid, 'p1')).toBeUndefined()
  })

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
