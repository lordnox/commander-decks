import type { GameEvent, GameState, ReplacementLineage } from '../types'

export const lineageFromEvent = (event: GameEvent): ReplacementLineage | undefined =>
  'replacementLineage' in event ? event.replacementLineage : undefined

export const withLineage = (event: GameEvent, lineage: ReplacementLineage): GameEvent => {
  const next = {
    ...event,
    replacementLineage: structuredClone(lineage),
    ...(legacyReplacedBy(lineage).length > 0 ? { replacedBy: legacyReplacedBy(lineage) } : {}),
  } as GameEvent
  return next
}

export const beginLineage = (state: GameState, simultaneityGroupId?: string): ReplacementLineage => ({
  id: `lineage-${state.nextId}`,
  usedInstanceIds: [],
  settledOptionalDeclines: [],
  ...(simultaneityGroupId ? { simultaneityGroupId } : {}),
})

export const markInstanceUsed = (lineage: ReplacementLineage, instanceId: string, pluginId?: string) => {
  if (!lineage.usedInstanceIds.includes(instanceId)) lineage.usedInstanceIds.push(instanceId)
  if (pluginId && !lineage.legacyPluginIdsUsed?.includes(pluginId)) {
    lineage.legacyPluginIdsUsed = [...(lineage.legacyPluginIdsUsed ?? []), pluginId]
  }
}

export const markOptionalDeclined = (lineage: ReplacementLineage, instanceId: string) => {
  if (!lineage.settledOptionalDeclines?.includes(instanceId)) {
    lineage.settledOptionalDeclines = [...(lineage.settledOptionalDeclines ?? []), instanceId]
  }
}

export const legacyReplacedBy = (lineage: ReplacementLineage) => [
  ...lineage.usedInstanceIds,
  ...(lineage.legacyPluginIdsUsed ?? []),
]

export const descendantLineage = (lineage: ReplacementLineage) => structuredClone(lineage)
