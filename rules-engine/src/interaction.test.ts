import { describe, expect, test } from 'bun:test'
import { InteractionStore } from './interaction'
import type { InteractionRequest } from '../../shared/interaction'
import { validateInteractionAnswer } from '../../shared/interaction'

const request: InteractionRequest = {
  requestId: 'req-1',
  revision: 4,
  chooser: 'p1',
  source: { name: 'Discard' },
  phase: 'resolution',
  purpose: 'choice',
  cancellation: 'mustAnswer',
  selection: {
    kind: 'selectCards',
    candidates: [{ id: 'card-1', incarnation: 2, zone: 'hand', name: 'Forest' }],
    min: 1,
    max: 1,
    distinct: true,
  },
}

describe('InteractionStore', () => {
  test('keeps immutable continuation data and consumes exactly once', () => {
    const store = new InteractionStore<{ cursor: number }, string>()
    store.open(request, { cursor: 3 })
    expect(() => store.open({ ...request, chooser: 'p2' }, { cursor: 3 })).toThrow('different immutable data')
    const answer = {
      requestId: 'req-1',
      revision: 4,
      chooser: 'p1',
      selection: { kind: 'selectCards' as const, ids: ['card-1'] },
    }
    const accepted = store.answer(answer)
    expect(accepted).toEqual({ kind: 'accepted', continuation: { cursor: 3 } })
    if (accepted.kind === 'accepted' && accepted.continuation) accepted.continuation.cursor = 99
    expect(store.answer(answer)).toEqual({ kind: 'duplicate' })
    expect(store.continuation('req-1')).toBeUndefined()
  })

  test('invalid, wrong-seat, and stale answers retain the request', () => {
    const store = new InteractionStore()
    store.open(request, { cursor: 3 })
    expect(store.answer({
      requestId: 'req-1', revision: 3, chooser: 'p1',
      selection: { kind: 'selectCards', ids: ['card-1'] },
    })).toEqual({ kind: 'invalid', error: 'stale interaction revision' })
    expect(store.answer({
      requestId: 'req-1', revision: 4, chooser: 'p2',
      selection: { kind: 'selectCards', ids: ['card-1'] },
    })).toEqual({ kind: 'invalid', error: 'wrong interaction seat' })
    expect(store.continuation('req-1')).toEqual({ cursor: 3 })
  })

  test('mandatory requests cannot be cancelled and concession invalidates only that chooser', () => {
    const store = new InteractionStore()
    store.open(request, { cursor: 3 })
    const optional = { ...request, requestId: 'req-2', chooser: 'p2', cancellation: 'cancelProposal' as const }
    store.open(optional, { cursor: 4 })
    expect(store.answer({ requestId: 'req-1', revision: 4, chooser: 'p1', cancel: true }))
      .toEqual({ kind: 'invalid', error: 'mandatory interaction cannot be cancelled' })
    expect(store.cancel('req-1')).toBe(false)
    expect(store.cancel('req-2')).toBe(true)
    store.open({ ...request, requestId: 'req-3', chooser: 'p1' }, { cursor: 5 })
    store.invalidateForChooser('p1')
    expect(store.continuation('req-1')).toBeUndefined()
    expect(store.continuation('req-3')).toBeUndefined()
    expect(store.request('req-2')?.chooser).toBe('p2')
  })

  test('target answers cover every scoped clause and preserve incarnation and zone', () => {
    const targetRequest: InteractionRequest = {
      requestId: 'targets', revision: 1, chooser: 'p1', source: { name: 'Spell' },
      phase: 'announcement', purpose: 'target', cancellation: 'cancelProposal',
      selection: {
        kind: 'selectTargets',
        clauses: [
          {
            scopeId: '$.abilities[0]', clauseIndex: 0,
            candidates: [{ kind: 'object', ref: { id: 'o1', incarnation: 2, zone: 'battlefield' } }],
            min: 1, max: 1, distinct: true,
          },
          {
            scopeId: '$.abilities[0]', clauseIndex: 1,
            candidates: [{ kind: 'object', ref: { id: 'o1', incarnation: 3, zone: 'graveyard' } }],
            min: 1, max: 1, distinct: true,
          },
        ],
        constraints: [],
      },
    }
    expect(validateInteractionAnswer(targetRequest, {
      requestId: 'targets', revision: 1, chooser: 'p1',
      selection: {
        kind: 'selectTargets',
        clauses: [{
          scopeId: '$.abilities[0]', clauseIndex: 0,
          targets: [{ kind: 'object', ref: { id: 'o1', incarnation: 2, zone: 'battlefield' } }],
        }],
      },
    })).toEqual({ ok: false, error: 'every target clause must be answered' })
    expect(validateInteractionAnswer(targetRequest, {
      requestId: 'targets', revision: 1, chooser: 'p1',
      selection: {
        kind: 'selectTargets',
        clauses: [
          {
            scopeId: '$.abilities[0]', clauseIndex: 0,
            targets: [{ kind: 'object', ref: { id: 'o1', incarnation: 2, zone: 'battlefield' } }],
          },
          {
            scopeId: '$.abilities[0]', clauseIndex: 1,
            targets: [{ kind: 'object', ref: { id: 'o1', incarnation: 3, zone: 'graveyard' } }],
          },
        ],
      },
    })).toEqual({ ok: true })
  })

  test('target constraints use scope and clause identity plus server metadata', () => {
    const request: InteractionRequest = {
      requestId: 'scoped-targets', revision: 1, chooser: 'p1', source: { name: 'Spell' },
      phase: 'resolution', purpose: 'target', cancellation: 'mustAnswer',
      selection: {
        kind: 'selectTargets',
        clauses: [
          { scopeId: 'first', clauseIndex: 0, candidates: [{ kind: 'object', ref: { id: 'o1', incarnation: 1, zone: 'battlefield', controller: 'p1' } }], min: 1, max: 1, distinct: true },
          { scopeId: 'second', clauseIndex: 0, candidates: [{ kind: 'object', ref: { id: 'o2', incarnation: 1, zone: 'battlefield', controller: 'p1' } }], min: 1, max: 1, distinct: true },
        ],
        constraints: [{ kind: 'sameController', clauses: [
          { scopeId: 'first', clauseIndex: 0 },
          { scopeId: 'second', clauseIndex: 0 },
        ] }],
      },
    }
    expect(validateInteractionAnswer(request, {
      requestId: 'scoped-targets', revision: 1, chooser: 'p1',
      selection: {
        kind: 'selectTargets',
        clauses: [
          { scopeId: 'first', clauseIndex: 0, targets: [{ kind: 'object', ref: { id: 'o1', incarnation: 1, zone: 'battlefield', controller: 'p2' } }] },
          { scopeId: 'second', clauseIndex: 0, targets: [{ kind: 'object', ref: { id: 'o2', incarnation: 1, zone: 'battlefield', controller: 'p2' } }] },
        ],
      },
    })).toEqual({ ok: true })
  })
})
