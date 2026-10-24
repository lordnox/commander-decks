import type { PluginCatalog } from '../catalog'
import { makeDraft } from '../draft'
import type { GameEvent, GameState, HookCtx, RuleInstance } from '../types'
import { discoverCanonicalModifiers } from './canonical'
import { discoverPreventionCandidates, type PreventionCandidate } from './prevention'
import type { ReplacementCategory } from './types'

export type LegacyReplacementCandidate = {
  kind: 'legacy'
  category: ReplacementCategory
  instanceId: string
  pluginId: string
  rule: RuleInstance
  label: string
  optional: boolean
  chooser: string
  preview: GameEvent | GameEvent[] | null
}

export type CanonicalReplacementCandidate = ReturnType<typeof discoverCanonicalModifiers>[number]

export type ReplacementCandidate = LegacyReplacementCandidate | CanonicalReplacementCandidate | PreventionCandidate

const sortedRules = (state: GameState) => {
  const unique = new Map<string, RuleInstance>()
  for (const rule of state.rules) unique.set(rule.instanceId, rule)
  return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp)
}

const ctxFor = (
  state: GameState,
  event: GameEvent,
  rule: RuleInstance,
  catalog: PluginCatalog,
): HookCtx => ({ state, event, draft: makeDraft(state), rule, catalog })

const defaultCategory = (event: GameEvent, rule: RuleInstance, state: GameState): ReplacementCategory => {
  if (event.type === 'move' && event.to === 'battlefield' && event.objectId === rule.sourceId) return 'self'
  if (event.type === 'move' && event.to === 'battlefield') {
    const object = state.objects[event.objectId]
    if (object?.controller === state.objects[rule.sourceId ?? '']?.controller) return 'entryControl'
  }
  return 'general'
}

const chooserFor = (state: GameState, event: GameEvent, rule: RuleInstance) => {
  switch (event.type) {
    case 'draw':
      return event.seat
    case 'dealDamage':
      if (event.target.kind === 'player') return event.target.player
      if (event.target.kind === 'object') {
        return state.objects[event.target.objectId]?.controller ?? state.playerOrder[0]
      }
      return state.playerOrder[0]
    case 'move':
    case 'destroy':
    case 'sacrifice': {
      const object = state.objects[event.objectId]
      return object?.controller ?? object?.owner ?? state.playerOrder[0]
    }
    default:
      return state.objects[rule.sourceId ?? '']?.controller ?? state.playerOrder[0]
  }
}

export const discoverReplacementCandidates = (
  state: GameState,
  event: GameEvent,
  catalog: PluginCatalog,
  usedInstanceIds: readonly string[],
  settledOptionalDeclines: readonly string[],
): ReplacementCandidate[] => {
  const legacy: LegacyReplacementCandidate[] = []
  for (const rule of sortedRules(state)) {
    // Splitting a batch into individual draws is structural, not a once-per-event
    // replacement. A later replacement may introduce a fresh multi-draw batch.
    const splitDraw = rule.pluginId === 'draw' && event.type === 'draw' && (event.count ?? 1) > 1
    if (usedInstanceIds.includes(rule.instanceId) && !splitDraw) continue
    if (settledOptionalDeclines.includes(rule.instanceId)) continue
    const plugin = catalog.get(rule.pluginId)
    if (!plugin?.replace) continue
    const preview = plugin.replace(ctxFor(state, event, rule, catalog))
    if (preview === undefined) continue
    legacy.push({
      kind: 'legacy',
      category: defaultCategory(event, rule, state),
      instanceId: rule.instanceId,
      pluginId: rule.pluginId,
      rule,
      label: rule.pluginId,
      optional: false,
      chooser: chooserFor(state, event, rule),
      preview,
    })
  }
  const canonical = discoverCanonicalModifiers(state, event, usedInstanceIds, settledOptionalDeclines)
  const prevention = discoverPreventionCandidates(state, event, usedInstanceIds)
  return [...legacy, ...canonical, ...prevention]
}

export const lowestCategory = (candidates: readonly ReplacementCandidate[]): ReplacementCategory => {
  const order: ReplacementCategory[] = ['self', 'entryControl', 'copyAsEntry', 'backFaceEntry', 'general']
  for (const category of order) {
    if (candidates.some((candidate) => candidate.category === category)) return category
  }
  return 'general'
}

export const candidatesInCategory = (
  candidates: readonly ReplacementCandidate[],
  category: ReplacementCategory,
) => candidates.filter((candidate) => candidate.category === category)
