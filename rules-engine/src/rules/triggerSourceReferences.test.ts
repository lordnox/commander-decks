import { describe, expect, test } from 'bun:test'
import { movedSourceReferenceMatchesOccurrence } from './triggers'
import type { OccurrenceSnapshot } from '../types'

describe('moved source reference matching', () => {
  test('only the source reference follows its own moved occurrence across incarnations', () => {
    const source = { id: 'object-1', incarnation: 1 }
    const moved = { id: 'object-1', incarnation: 2 }
    const occurrence = {
      kind: 'event', eventType: 'move',
      object: { before: { ...source }, after: { ...moved } },
    } as OccurrenceSnapshot

    expect(movedSourceReferenceMatchesOccurrence(
      { kind: 'contextRef', name: 'source' }, source, moved, occurrence,
    )).toBe(true)
    expect(movedSourceReferenceMatchesOccurrence(
      { kind: 'targetRef', clauseIndex: 0 }, source, moved, occurrence,
    )).toBe(false)
    expect(movedSourceReferenceMatchesOccurrence(
      { kind: 'choiceRef', binding: 'selected' }, source, moved, occurrence,
    )).toBe(false)
    expect(movedSourceReferenceMatchesOccurrence(
      { kind: 'contextRef', name: 'source' }, source, { id: 'object-2', incarnation: 2 }, occurrence,
    )).toBe(false)
  })
})
