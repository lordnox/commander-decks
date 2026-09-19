import type { CardInstruction } from '../cardPlugins/effectDefinitions'
import type Draft from '../draft'
import type { DelayedTriggerCondition, GameObject } from '../types'

/** CR 603.7a, d–g — snapshot the source and controller when the ability is created. */
export const registerDelayedTrigger = (
  draft: Draft,
  source: GameObject,
  condition: DelayedTriggerCondition,
  instructions: CardInstruction[],
) => {
  draft.delayedTriggers.push({
    id: draft.allocId('delayed'),
    sourceId: source.id,
    sourceName: source.name,
    controller: source.controller,
    condition,
    instructions,
    timestamp: draft.allocTs(),
  })
}
