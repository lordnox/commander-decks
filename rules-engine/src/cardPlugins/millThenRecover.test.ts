import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, createServerGame as createRuntimeGame, projectForViewer } from '../runtime'
import { ok } from '../testHelpers'
import { stackCopyPending } from './stackCopy'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingOptionSelection, PENDING_OPTION_SELECTION } from '../rules/selectOptions'
import { activated } from './activated'
import { choiceEffects } from './choiceEffects'
import { librarySearch } from './librarySearch'
import { targetedResolve } from './targetedResolve'
import { card, choice, chooseCards, compileCardRuleDefinition, createDefinitionSnapshot, manaAndLifeCost, mill, move, objects, payOptional, ref, spell } from './dsl/v1'

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const resolveRecoverSpell = (args: {
  mana?: { C: number }
  life?: number
  extraGraveyard?: string
}) => {
  const ruleDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
    instructions: [
      mill({ count: 3, targets: ref('controller'), bindChoice: 'milled' }),
      payOptional({
        payer: ref('controller'),
        cost: manaAndLifeCost('{1}', 2),
        bindResult: 'paid',
        ifPaid: [
          chooseCards({
            chooser: ref('controller'),
            bindChoice: 'recovered',
            filter: objects({ among: choice('milled') }),
            min: 1,
            max: 1,
          }),
          move({ targets: choice('recovered'), to: 'hand' }),
        ],
      }),
    ],
  })])))
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
            ruleDefinition,
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
    { random: () => 0.5 },
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

describe('optional recovery after milling', () => {
  test('paying puts one of the milled cards into hand', () => {
    const { server, resolved } = resolveRecoverSpell({ mana: { C: 1 } })
    const milled = ['Milled One', 'Milled Two', 'Milled Three'].map((name) => named(resolved, name))
    const payment = pendingOptionSelection(resolved, 'p1')!
    expect(milled.every((card) => card.zone === 'graveyard')).toBe(true)
    const paid = ok(server.rules(resolved, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: payment.id,
      optionId: 'pay',
    }))
    const selection = pendingSelectionFor(paid, 'p1')
    expect(selection?.candidates).toEqual(milled.map((card) => card.id))

    const chosen = ok(server.rules(paid, {
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

  test('insufficient mana prevents payment and recovery after mill', () => {
    const { server, resolved } = resolveRecoverSpell({ mana: { C: 0 } })
    const payment = pendingOptionSelection(resolved, 'p1')!
    expect(payment.options.map(({ id }) => id)).toContain('pay')
    expect(server.rules(resolved, { type: 'selectOption', seat: 'p1', selectionId: payment.id, optionId: 'pay' }).ok).toBe(false)
    const declined = ok(server.rules(resolved, { type: 'selectOption', seat: 'p1', selectionId: payment.id, optionId: 'decline' }))
    expect(named(declined, 'Milled One').zone).toBe('graveyard')
    expect(named(declined, 'Milled Two').zone).toBe('graveyard')
    expect(named(declined, 'Milled Three').zone).toBe('graveyard')
    expect(pendingSelectionFor(declined, 'p1')).toBeUndefined()
  })

  test('cannot pay life skips the recover choice after mill', () => {
    const { server, resolved } = resolveRecoverSpell({ mana: { C: 1 }, life: 1 })
    const payment = pendingOptionSelection(resolved, 'p1')!
    expect(server.rules(resolved, { type: 'selectOption', seat: 'p1', selectionId: payment.id, optionId: 'pay' }).ok).toBe(false)
    const declined = ok(server.rules(resolved, { type: 'selectOption', seat: 'p1', selectionId: payment.id, optionId: 'decline' }))
    expect(named(declined, 'Milled One').zone).toBe('graveyard')
    expect(pendingSelectionFor(declined, 'p1')).toBeUndefined()
  })

  test('the chosen card must be one of the milled cards', () => {
    const { server, resolved } = resolveRecoverSpell({
      mana: { C: 1 },
      extraGraveyard: 'Old Grave',
    })
    const old = named(resolved, 'Old Grave')
    expect(old.zone).toBe('graveyard')
    const payment = pendingOptionSelection(resolved, 'p1')!
    const paid = ok(server.rules(resolved, { type: 'selectOption', seat: 'p1', selectionId: payment.id, optionId: 'pay' }))
    expect(pendingSelectionFor(paid, 'p1')).toBeDefined()
    const rejected = server.rules(paid, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [old.id],
    })
    expect(rejected.ok).toBe(false)
  })

  test('declining the optional payment leaves the milled cards and resources unchanged', () => {
    const { server, resolved } = resolveRecoverSpell({ mana: { C: 1 } })
    const payment = pendingOptionSelection(resolved, 'p1')!
    const declined = ok(server.rules(resolved, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: payment.id,
      optionId: 'decline',
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

    expect(chooser.players.p1.data[PENDING_OPTION_SELECTION]).toBeTruthy()
    expect(opponent.players.p1.data[PENDING_OPTION_SELECTION]).toBeUndefined()
    expect(chooser.objects[rest.id]).toBeUndefined()
    expect(opponent.objects[rest.id]).toBeUndefined()
    expect(opponent.objects[named(resolved, 'Milled One').id]?.zone).toBe('graveyard')
  })
})

describe('relocated from homerRest.test.ts → millThenRecover.test.ts', () => {
  const createServerGame: typeof createRuntimeGame = (format, options) =>
    createRuntimeGame(format, options, {
      random: () => 0.5,
      cardPlugins: [
        choiceEffects,
        librarySearch,
        targetedResolve,
        activated,
      ],
    })

  const named = (state: import('../types').GameState, name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  test('Incarnation Technique reanimates a creature rather than a land', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Incarnation Technique', { types: ['Sorcery'] })] },
          libraries: {
            p1: [
              cardTemplate('Body', { types: ['Creature'], zone: 'graveyard' }),
              cardTemplate('Land', { types: ['Land'], zone: 'graveyard' }),
              ...Array.from({ length: 5 }, (_, index) =>
                cardTemplate(`Milled ${index}`, { types: ['Instant'] })),
            ],
          },
        },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 4 }
      const cast = ok(server.rules(ready, {
        type: 'castSpell',
        seat: 'p1',
        objectId: named(ready, 'Incarnation Technique').id,
      }))
      const demonstrated = ok(server.rules(cast, { type: 'resolveTop' }))
      const pendingCopy = stackCopyPending(demonstrated)!
      const declined = ok(server.rules(demonstrated, {
        type: 'copyStackItem',
        seat: 'p1',
        sourceId: pendingCopy.sourceId,
        stackId: pendingCopy.stackId,
        accept: false,
      }))
      const choosing = ok(server.rules(declined, { type: 'resolveTop' }))
      const selection = pendingSelectionFor(choosing, 'p1')!
      expect(selection.candidates).toEqual([named(choosing, 'Body').id])
      const resolved = ok(server.rules(choosing, {
        type: 'selectCards',
        seat: 'p1',
        kind: 'choose',
        count: 1,
        objectIds: selection.candidates,
      }))
      expect(named(resolved, 'Body').zone).toBe('battlefield')
      expect(named(resolved, 'Land').zone).toBe('graveyard')
    })

})
