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
  payOptional,
  permanentEffect,
  pumpEffect,
  ref,
  spell,
  untilCleanup,
} from './v1'

describe('programValidation', () => {

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
        payOptional({ payer: ref('controller'), cost: { kind: 'sacrifice', filter: objects({ zone: 'battlefield' }), count: { kind: 'constant', value: 1 } }, bindResult: 'paid', ifPaid: [], ifDeclined: [], whenPaidDecisions: { targets: [] }, whenPaid: [gainLife({ amount: 1, targets: ref('controller') })] }),
      ],
    })]))
    expect(compiled.definition.abilities[0]).toMatchObject({ kind: 'spell' })
  })
})
