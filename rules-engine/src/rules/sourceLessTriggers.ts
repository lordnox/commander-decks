import { withReferencedObjects } from './canonicalReferences'
import { generatedAbilitySnapshot } from '../cardPlugins/dsl/generatedPrograms'
import type { GeneratedAbility } from '../cardPlugins/dsl/schema/v1'
import { gameObjectFieldDefaults } from '../definitions'
import { captureObject } from '../objectIdentity'
import type Draft from '../draft'
import type { GameObject, OccurrenceSnapshot, PlayerId } from '../types'
import { SOURCELESS_TRIGGER_ANCHOR } from './sourceLessConstants'

/** Inherent game abilities join ordinary APNAP placement without inventing a card source. */
export const queueSourceLessTrigger = (draft: Draft, input: {
  controller: PlayerId
  name: string
  ability: GeneratedAbility
  occurrence?: OccurrenceSnapshot
}) => {
  // The driver keeps a uniform captured-context shape. This execution-only anchor
  // is explicitly source-less: it is absent from objects and cannot resolve as source/LKI.
  const anchor: GameObject = {
    ...gameObjectFieldDefaults(),
    id: SOURCELESS_TRIGGER_ANCHOR,
    name: input.name,
    owner: input.controller,
    controller: input.controller,
    zone: 'command',
  }
  const snapshot = generatedAbilitySnapshot(input.ability)
  draft.pendingTriggers = [...(draft.pendingTriggers ?? []), {
    id: draft.allocId('trigger'),
    source: anchor,
    instructions: [],
    effect: { do: [] },
    execution: withReferencedObjects(draft, {
      controller: input.controller,
      sourceLess: true,
      monarchRevision: draft.monarchRevision ?? 0,
      source: captureObject(anchor, 'lastKnown'),
      ...(input.occurrence ? { occurrence: structuredClone(input.occurrence) } : {}),
    }, snapshot),
    canonical: { definitionSnapshot: snapshot, abilityIndex: 0 },
    triggeringPlayer: input.occurrence?.player ?? input.controller,
  }]
}
