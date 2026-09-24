import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { ok } from '../testHelpers'
import { millThenRecover, onResolve } from './effects'
import { onResolve as onResolvePlugin } from './onResolve'
import { PENDING_SELECTION, pendingSelectionFor } from '../rules/selectCards'

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const resolveRecoverSpell = (args: {
  mana?: { C: number }
  life?: number
  extraGraveyard?: string
}) => {
  const server = createServerGame(
    commanderRules,
    {
      players: 2,
      hands: {
        p1: [
          cardTemplate('Ripple Relic', {
            types: ['Instant'],
            manaCost: '{0}',
            manaValue: 0,
            effects: [onResolve(millThenRecover(3, { mana: '{1}', life: 2 }))],
          }),
          ...(args.extraGraveyard
            ? [cardTemplate(args.extraGraveyard, { types: ['Instant'] })]
            : []),
        ],
      },
      libraries: {
        p1: ['Milled One', 'Milled Two', 'Milled Three', 'Library Rest'].map((name) =>
          cardTemplate(name, { types: ['Instant'] })),
      },
    },
    { random: () => 0.5, cardPlugins: [onResolvePlugin] },
  )
  let start = server.state
  if (args.extraGraveyard) {
    start = ok(server.rules(start, {
      type: 'move',
      objectId: named(start, args.extraGraveyard).id,
      to: 'graveyard',
    }))
  }
  const withPay = {
    ...start,
    players: {
      ...start.players,
      p1: {
        ...start.players.p1,
        mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: args.mana?.C ?? 0 },
        ...(args.life !== undefined ? { life: args.life } : {}),
      },
    },
  }
  const cast = ok(server.rules(withPay, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(withPay, 'Ripple Relic').id,
  }))
  return { server, resolved: ok(server.rules(cast, { type: 'resolveTop' })) }
}

describe('millThenRecover', () => {
  test('paying puts one of the milled cards into hand', () => {
    const { server, resolved } = resolveRecoverSpell({ mana: { C: 1 } })
    const milled = ['Milled One', 'Milled Two', 'Milled Three'].map((name) => named(resolved, name))
    const selection = pendingSelectionFor(resolved, 'p1')
    expect(selection?.candidates).toEqual(milled.map((card) => card.id))
    expect(milled.every((card) => card.zone === 'graveyard')).toBe(true)

    const chosen = ok(server.rules(resolved, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [milled[1].id],
    }))
    expect(chosen.objects[milled[1].id].zone).toBe('hand')
    expect(chosen.objects[milled[0].id].zone).toBe('graveyard')
    expect(chosen.objects[milled[2].id].zone).toBe('graveyard')
    expect(chosen.players.p1.mana.C).toBe(0)
    expect(chosen.players.p1.life).toBe(commanderRules.startingLife - 2)
    expect(pendingSelectionFor(chosen, 'p1')).toBeUndefined()
  })

  test('cannot pay skips the recover choice after mill', () => {
    const { resolved } = resolveRecoverSpell({ mana: { C: 0 } })
    expect(named(resolved, 'Milled One').zone).toBe('graveyard')
    expect(named(resolved, 'Milled Two').zone).toBe('graveyard')
    expect(named(resolved, 'Milled Three').zone).toBe('graveyard')
    expect(pendingSelectionFor(resolved, 'p1')).toBeUndefined()
  })

  test('cannot pay life skips the recover choice after mill', () => {
    const { resolved } = resolveRecoverSpell({ mana: { C: 1 }, life: 1 })
    expect(named(resolved, 'Milled One').zone).toBe('graveyard')
    expect(pendingSelectionFor(resolved, 'p1')).toBeUndefined()
  })

  test('the chosen card must be one of the milled cards', () => {
    const { server, resolved } = resolveRecoverSpell({
      mana: { C: 1 },
      extraGraveyard: 'Old Grave',
    })
    const old = named(resolved, 'Old Grave')
    expect(old.zone).toBe('graveyard')
    const rejected = server.rules(resolved, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [old.id],
    })
    expect(rejected.ok).toBe(false)
  })

  test('declining pays nothing and leaves the milled cards in the graveyard', () => {
    const { server, resolved } = resolveRecoverSpell({ mana: { C: 1 } })
    const declined = ok(server.rules(resolved, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [],
    }))
    expect(named(declined, 'Milled One').zone).toBe('graveyard')
    expect(declined.players.p1.mana.C).toBe(1)
    expect(declined.players.p1.life).toBe(commanderRules.startingLife)
  })

  test('library identities stay hidden and only the chooser sees the pending selection', () => {
    const { resolved } = resolveRecoverSpell({ mana: { C: 1 } })
    const rest = named(resolved, 'Library Rest')
    const chooser = projectForViewer(resolved, 'p1')
    const opponent = projectForViewer(resolved, 'p2')

    expect(chooser.players.p1.data[PENDING_SELECTION]).toBeTruthy()
    expect(opponent.players.p1.data[PENDING_SELECTION]).toBeUndefined()
    expect(chooser.objects[rest.id]).toBeUndefined()
    expect(opponent.objects[rest.id]).toBeUndefined()
    expect(opponent.objects[named(resolved, 'Milled One').id]?.zone).toBe('graveyard')
  })
})
