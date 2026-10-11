import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDelayed,
  createEffect,
  eventDelayed,
  gainLife,
  grantAbilityEffect,
  objects,
  openResolutionPayment,
  payOptional,
  permanentEffect,
  pumpEffect,
  ref,
  reflexiveFromPayment,
  settleResolutionPayment,
  spell,
  temporaryEffect,
  delayedProgram,
  untilCleanup,
} from './v1'

const context = {
  definitionRevision: 'v1-0123456789abcdef',
  source: { objectId: 'source', incarnation: 2, name: 'Source' },
  controller: 'p1',
  parentStackId: 'stack',
}

describe('Rule DSL Part 10 programs', () => {
  test('validates temporary effects, generated abilities, delayed programs, and paid outcomes', () => {
    const compiled = compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [
        createEffect({ targets: objects({}), effect: pumpEffect(2, 2), duration: untilCleanup() }),
        createEffect({
          targets: objects({}), duration: permanentEffect(), effect: grantAbilityEffect({
            kind: 'triggered', on: eventDelayed({ type: 'draw' }), instructions: [gainLife({ amount: 1, targets: ref('controller') })],
          }),
        }),
        createDelayed({ condition: eventDelayed({ type: 'dies' }), instructions: [gainLife({ amount: 1, targets: ref('controller') })] }),
        payOptional({ payer: ref('controller'), cost: { kind: 'sacrifice', filter: objects({ zone: 'battlefield' }), count: { kind: 'constant', value: 1 } }, bindResult: 'paid', ifPaid: [], ifDeclined: [] }),
      ],
    })]))
    expect(compiled.definition.abilities[0]).toMatchObject({ kind: 'spell' })
  })

  test('payment owns its payer and creates a reflexive program only after payment', () => {
    const waiting = openResolutionPayment({
      id: 'payment', payer: ref('controller'), cost: { kind: 'mana', amount: '{1}' }, resultBinding: 'paid', context,
      ifPaid: [], ifDeclined: [], whenPaid: [gainLife({ amount: 1, targets: ref('controller') })],
    })
    expect(reflexiveFromPayment(waiting)).toBeUndefined()
    const declined = settleResolutionPayment(waiting, { paid: false, actionSucceeded: false, destination: 'graveyard' })
    expect(reflexiveFromPayment(declined)).toBeUndefined()
    const paid = settleResolutionPayment(waiting, { paid: true, actionSucceeded: true, destination: 'graveyard' })
    expect(reflexiveFromPayment(paid)).toMatchObject({ payment: { binding: 'paid', paid: true }, source: context })
  })

  test('temporary and delayed programs pin independent source/version contexts', () => {
    const effect = temporaryEffect({ source: context, targets: ['target'], effect: pumpEffect(1, 1), duration: untilCleanup(), createdAt: 4 })
    const delayed = { source: { ...context, definitionRevision: 'v1-fedcba9876543210' }, condition: eventDelayed({ type: 'move' }), instructions: [], recurring: true }
    const program = delayedProgram(delayed)
    expect(effect.source.definitionRevision).toBe(context.definitionRevision)
    expect(program.source.definitionRevision).toBe('v1-fedcba9876543210')
  })
})

