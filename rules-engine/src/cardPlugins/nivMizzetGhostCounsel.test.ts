import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { activated } from './activated'
import { choiceEffects } from './choiceEffects'

const niv = () => cardTemplate('Niv-Mizzet, Ghost Counsel', {
  types: ['Creature'],
  subtypes: ['Spirit', 'Dragon'],
  supertypes: ['Legendary'],
  colors: ['W', 'B'],
  power: 4,
  toughness: 4,
  oracleText:
    'Flying\nWhenever you gain life, you may pay that much life. If you do, draw that many cards.\n'
    + '{T}: Each opponent loses 1 life and you gain 1 life.',
})

const plugins = [activated, choiceEffects]

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
  { random: () => 0.5, cardPlugins: plugins },
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

const chooseDialog = (
  server: ReturnType<typeof game>,
  state: ReturnType<typeof game>['state'],
  accepted: boolean,
) => ok(server.rules(state, {
  type: 'custom',
  name: DIALOG_CHOSEN,
  seat: 'p1',
  payload: { accepted },
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
      payload: { triggerAmount: 2 },
    })
  })

  test('accepting pays life and draws using the captured gain amount', () => {
    const server = game()
    const offered = gainAndResolve(server, server.state, 3)
    expect(pendingDialog(offered)).toMatchObject({
      kind: 'may-pay-life-draw',
      seat: 'p1',
      count: 3,
    })
    const beforeHand = offered.zoneCounts.p1.hand
    const accepted = chooseDialog(server, offered, true)
    expect(accepted.players.p1.life).toBe(40)
    expect(accepted.zoneCounts.p1.hand).toBe(beforeHand + 3)
    expect(pendingDialog(accepted)).toBeUndefined()
  })

  test('declining leaves life and hand unchanged', () => {
    const server = game()
    const offered = gainAndResolve(server, server.state, 2)
    const beforeHand = offered.zoneCounts.p1.hand
    const declined = chooseDialog(server, offered, false)
    expect(declined.players.p1.life).toBe(42)
    expect(declined.zoneCounts.p1.hand).toBe(beforeHand)
  })

  test('cannot accept when life is below the trigger amount', () => {
    const server = game()
    let state = ok(server.rules(server.state, { type: 'gainLife', seat: 'p1', amount: 5 }))
    state = resolveStack(server.rules, state)
    state.players.p1.life = 3
    expect(server.rules(state, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: true },
    }).ok).toBe(false)
  })

  test('tap drains opponents, gains one life, then offers pay-one-draw-one without looping', () => {
    const server = game()
    const objectId = nivId(server.state)
    const tapped = ok(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId,
      abilityId: 'nivMizzetGhostCounsel.drain',
    }))
    const drained = resolveStack(server.rules, tapped)
    expect(drained.players.p2.life).toBe(39)
    expect(drained.players.p1.life).toBe(41)
    expect(pendingDialog(drained)).toMatchObject({
      kind: 'may-pay-life-draw',
      count: 1,
    })

    const paid = chooseDialog(server, drained, true)
    expect(paid.players.p1.life).toBe(40)
    expect(paid.stack).toHaveLength(0)
    expect(pendingDialog(paid)).toBeUndefined()
  })

  test('opponents do not see the pending dialog in projection', () => {
    const server = game()
    const offered = gainAndResolve(server, server.state, 1)
    expect(pendingDialog(offered)).toBeDefined()
    expect(server.project(offered, 'p2').players.p1.data['kernel.pendingDialog']).toBeUndefined()
  })

  test('host restart keeps the open may-pay-life-draw choice', () => {
    const server = game()
    const offered = gainAndResolve(server, server.state, 2)
    const restarted = structuredClone(offered)
    expect(pendingDialog(restarted)).toMatchObject({
      kind: 'may-pay-life-draw',
      seat: 'p1',
      count: 2,
      source: 'Niv-Mizzet, Ghost Counsel',
    })
  })
})
