import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'
import { createServerGame, projectForViewer } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { SECRET_COUNCIL, secretCouncil } from './secretCouncil'

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const cirdan = () => cardTemplate('Círdan the Shipwright', {
  types: ['Creature'],
  supertypes: ['Legendary'],
  power: 3,
  toughness: 4,
  manaCost: '{3}{G}{U}',
  manaValue: 5,
  oracleText: 'Vigilance\nSecret council — Whenever Círdan enters or attacks, each player secretly votes for a player.',
})

describe('secret council', () => {
  test('Círdan entering opens a hidden vote and dumps for zero votes', () => {
    const monster = cardTemplate('Sire of Seven Deaths', {
      types: ['Creature'],
      power: 7,
      toughness: 7,
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cirdan(), monster] },
        libraries: {
          p1: [cardTemplate('Draw 1'), cardTemplate('Draw 2')],
          p2: [cardTemplate('P2 Draw 1'), cardTemplate('P2 Draw 2'), cardTemplate('P2 Draw 3'), cardTemplate('P2 Draw 4')],
          p3: [cardTemplate('P3 Draw 1')],
          p4: [cardTemplate('P4 Draw 1')],
        },
      },
      { random: () => 0.5, cardPlugins: [secretCouncil] },
    )
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: named(server.state, 'Círdan the Shipwright').id,
      to: 'battlefield',
    })))
    expect(pendingDialog(entered)).toMatchObject({
      kind: 'secret-vote',
      seat: 'p1',
      source: 'Círdan the Shipwright',
    })
    const afterP1 = ok(server.rules(entered, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { targets: ['p2'] },
    }))
    const replica = projectForViewer(afterP1, 'p3')
    const pending = replica.players.p1.data[SECRET_COUNCIL] as { votes?: Record<string, string> }
    expect(pending.votes?.p1).toBeUndefined()

    let state = afterP1
    for (const seat of ['p2', 'p3', 'p4'] as const) {
      const dialog = pendingDialog(state)
      expect(dialog?.kind).toBe('secret-vote')
      state = ok(server.rules(state, {
        type: 'custom',
        name: DIALOG_CHOSEN,
        seat,
        payload: { targets: ['p2'] },
      }))
    }
    expect(state.players.p2.life).toBe(40)
    expect(state.zoneOrder.p2.hand.length).toBeGreaterThan(0)
    expect(pendingDialog(state)).toMatchObject({
      kind: 'put-permanents',
      seat: 'p1',
    })
  })

  test('a host restart still sees the open secret vote', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [cirdan()] } },
      { random: () => 0.5, cardPlugins: [secretCouncil] },
    )
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: named(server.state, 'Círdan the Shipwright').id,
      to: 'battlefield',
    })))
    const restored = createServerGame(
      commanderRules,
      {},
      { random: () => 0.5, cardPlugins: [secretCouncil] },
    )
    restored.state = structuredClone(entered)
    expect(pendingDialog(restored.state)).toMatchObject({
      kind: 'secret-vote',
      seat: 'p1',
      source: 'Círdan the Shipwright',
    })
  })
})
