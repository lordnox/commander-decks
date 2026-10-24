import { objectIdentity } from '../../objectIdentity'
import type { Plugin } from '../../types'

export const CANONICAL_RANDOM_RESULT = 'dsl.randomChoice'

export const canonicalRandom: Plugin = {
  id: 'canonicalRandom',
  apply: ({ event, draft }) => {
    if (event.type !== 'custom' || event.name !== CANONICAL_RANDOM_RESULT) return
    const frame = draft.resolution
    if (frame?.kind !== 'canonicalSpell') return
    const payload = event.payload
    if (!payload || typeof payload !== 'object') return
    const binding = 'binding' in payload && typeof payload.binding === 'string' ? payload.binding : undefined
    const stackId = 'stackId' in payload && typeof payload.stackId === 'string' ? payload.stackId : undefined
    const selected = 'selected' in payload && typeof payload.selected === 'string' ? payload.selected : undefined
    if (!binding || stackId !== frame.stackId) return
    const object = selected ? draft.objects[selected] : undefined
    frame.choices = {
      ...frame.choices,
      [binding]: object ? [{ kind: 'object' as const, ...objectIdentity(object) }] : [],
    }
  },
}
