import { captureObject, isSameObject, objectIdentity, targetObject } from '../objectIdentity'
import type { CapturedObject, GameState, StackExecutionContext } from '../types'

// Recursively inspect canonical data for an explicit current-or-LKI player query.
const needsReferenceLki = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(needsReferenceLki)
  const node = value as Record<string, unknown>
  if (node.kind === 'relatedPlayer' && node.information === 'currentOrLastKnown') return true
  return Object.values(node).some(needsReferenceLki)
}

/** Keep LKI watches separate from immutable historical occurrence snapshots. */
export const withReferencedObjects = (state: GameState, execution: StackExecutionContext, definition = execution.definitionSnapshot) => {
  if (!definition || !needsReferenceLki(definition.definition)) return execution
  const watched: CapturedObject[] = structuredClone(execution.referencedObjects ?? [])
  const add = (snapshot: CapturedObject['snapshot'] | undefined) => {
    if (!snapshot || watched.some(entry => isSameObject(snapshot, entry.ref))) return
    const current = state.objects[snapshot.id]
    watched.push(captureObject(isSameObject(current, objectIdentity(snapshot)) ? current : snapshot, 'lastKnown'))
  }
  if (!execution.sourceLess) add(execution.source.snapshot)
  add(execution.occurrence?.object?.before)
  add(execution.occurrence?.object?.after)
  add(execution.occurrence?.source?.snapshot)
  for (const binding of execution.targetBindings ?? []) {
    for (const recipient of binding.recipients) if (recipient.kind === 'object') {
      const current = targetObject(state, recipient)
      if (current) add(current)
    }
  }
  for (const choices of Object.values(execution.choices ?? {})) for (const recipient of choices) {
    if (recipient.kind !== 'object') continue
    const current = state.objects[recipient.objectId]
    if (isSameObject(current, recipient)) add(current)
  }
  return { ...execution, referencedObjects: watched }
}
