import { describe, expect, test } from 'bun:test'
import {
  card,
  chooseCards,
  compileCardRuleDefinition,
  createDelayed,
  createEffect,
  draw,
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

  test('allows signed stat deltas without allowing negative draw counts', () => {
    const negativePump = card([spell({
      instructions: [createEffect({
        targets: objects({}),
        effect: pumpEffect(-5, -5),
        duration: untilCleanup(),
      })],
    })])
    expect(compileCardRuleDefinition(negativePump).definition.abilities[0]).toMatchObject({
      instructions: [{ kind: 'createEffect', effect: {
        kind: 'pump', power: { kind: 'constant', value: -5 }, toughness: { kind: 'constant', value: -5 },
      } }],
    })

    const negativeDraw = card([spell({
      instructions: [draw({ count: -1, targets: ref('controller') })],
    })])
    expect(() => compileCardRuleDefinition(negativeDraw)).toThrow()
  })

  test('validates current object supertype selectors', () => {
    const valid = card([spell({
      instructions: [chooseCards({
        bindChoice: 'basic', chooser: ref('controller'),
        filter: objects({ zone: 'library', type: 'Land', supertypes: ['Basic'] }), count: 1,
      })],
    })])
    expect(() => compileCardRuleDefinition(valid)).not.toThrow()

    const malformed = structuredClone(valid) as unknown as { abilities: Array<{ instructions: Array<{ filter: { supertypes: unknown[] } }> }> }
    malformed.abilities[0]!.instructions[0]!.filter.supertypes = [3]
    expect(() => compileCardRuleDefinition(malformed)).toThrow()
  })

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
