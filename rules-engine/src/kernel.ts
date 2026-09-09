import type { PluginCatalog } from './catalog'
import { freezeDraft, makeDraft } from './draft'
import type {
  GameEvent,
  GameState,
  HookCtx,
  ReduceResult,
  RuleInstance,
  ZoneId,
} from './types'

const SBA_CAP = 32

const sortedRules = (state: GameState) =>
  [...state.rules].sort((a, b) => a.timestamp - b.timestamp)

const ctxFor = (
  state: GameState,
  event: GameEvent,
  draft: ReturnType<typeof makeDraft>,
  rule: RuleInstance,
  catalog: PluginCatalog,
): HookCtx => ({ state, event, draft, rule, catalog })

const replaceEvent = (
  state: GameState,
  event: GameEvent,
  catalog: PluginCatalog,
): GameEvent | GameEvent[] | null => {
  let current: GameEvent = event
  const used = new Set<string>()
  let guard = 0
  while (guard < 64) {
    guard += 1
    let hit = false
    for (const rule of sortedRules(state)) {
      if (used.has(rule.instanceId)) continue
      const plugin = catalog.get(rule.pluginId)
      const next = plugin?.replace?.(ctxFor(state, current, makeDraft(state), rule, catalog))
      if (next === undefined) continue
      if (next === null) return null
      used.add(rule.instanceId)
      if (Array.isArray(next)) return next
      current = next
      hit = true
      break
    }
    if (!hit) return current
  }
  return current
}

const legalError = (
  state: GameState,
  event: GameEvent,
  draft: ReturnType<typeof makeDraft>,
  catalog: PluginCatalog,
) => {
  for (const rule of sortedRules(state)) {
    const plugin = catalog.get(rule.pluginId)
    const error = plugin?.legal?.(ctxFor(state, event, draft, rule, catalog))
    if (error) return error
  }
  return undefined
}

const coreApply = (draft: ReturnType<typeof makeDraft>, event: GameEvent) => {
  switch (event.type) {
    case 'addRule': {
      draft.rules.push({
        instanceId: draft.allocId('rule'),
        pluginId: event.pluginId,
        sourceId: event.sourceId ?? null,
        timestamp: draft.allocTs(),
        params: event.params ?? {},
      })
      draft.note(`addRule ${event.pluginId}`)
      return
    }
    case 'removeRule': {
      draft.rules = draft.rules.filter((rule) => {
        if (event.instanceId) return rule.instanceId !== event.instanceId
        if (event.sourceId != null && event.pluginId) {
          return !(rule.sourceId === event.sourceId && rule.pluginId === event.pluginId)
        }
        if (event.sourceId != null) return rule.sourceId !== event.sourceId
        if (event.pluginId) return rule.pluginId !== event.pluginId
        return true
      })
      draft.note('removeRule')
      return
    }
    case 'move': {
      const object = draft.object(event.objectId)
      if (!object) return
      const previous = object.zone
      const leftBattlefield = previous === 'battlefield' && event.to !== 'battlefield'
      const entered = previous !== 'battlefield' && event.to === 'battlefield'
      draft.move(event.objectId, event.to)
      if (leftBattlefield) {
        draft.rules = draft.rules.filter((rule) => rule.sourceId !== event.objectId)
        draft.note(`${object.name} leaves battlefield`)
      }
      if (entered) {
        object.summoningSickness = object.types.includes('Creature')
        for (const pluginId of object.grantedRules) {
          draft.rules.push({
            instanceId: draft.allocId('rule'),
            pluginId,
            sourceId: object.id,
            timestamp: draft.allocTs(),
            params: {},
          })
        }
        draft.note(`${object.name} enters battlefield`)
      }
      return
    }
    case 'tap': {
      const object = draft.object(event.objectId)
      if (object) object.tapped = true
      return
    }
    case 'untap': {
      const object = draft.object(event.objectId)
      if (object) object.tapped = false
      return
    }
    case 'concede': {
      draft.players[event.seat].lost = true
      draft.note(`${event.seat} concedes`)
      return
    }
    default:
      return
  }
}

const pluginApply = (
  state: GameState,
  event: GameEvent,
  draft: ReturnType<typeof makeDraft>,
  catalog: PluginCatalog,
) => {
  for (const rule of sortedRules(draft)) {
    catalog.get(rule.pluginId)?.apply?.(ctxFor(state, event, draft, rule, catalog))
  }
}

const collectSba = (
  state: GameState,
  draft: ReturnType<typeof makeDraft>,
  catalog: PluginCatalog,
) => {
  const events: GameEvent[] = []
  const dummy: GameEvent = { type: 'custom', name: 'sba' }
  for (const rule of sortedRules(draft)) {
    const extra = catalog.get(rule.pluginId)?.sba?.(ctxFor(state, dummy, draft, rule, catalog))
    if (extra) events.push(...extra)
  }
  return events
}

const checkEnded = (draft: ReturnType<typeof makeDraft>) => {
  const alive = Object.values(draft.players).filter((player) => !player.lost)
  if (alive.length <= 1) draft.ended = true
}

type ReduceOnce = ReduceResult & { queued?: GameEvent[] }

export const reduceOnce = (
  state: GameState,
  event: GameEvent,
  catalog: PluginCatalog,
): ReduceOnce => {
  if (
    state.ended
    && event.type !== 'addRule'
    && event.type !== 'removeRule'
    && event.type !== 'concede'
    && event.type !== 'authoritativeSync'
  ) {
    return { ok: false, error: 'game has ended', state }
  }

  const preDraft = makeDraft(state)
  const preError = legalError(state, event, preDraft, catalog)
  if (preError) return { ok: false, error: preError, state }

  const replaced = replaceEvent(state, event, catalog)
  if (replaced === null) {
    return { ok: true, state: { ...state, prevented: true }, prevented: true }
  }
  if (Array.isArray(replaced)) {
    let current = state
    for (const inner of replaced) {
      const next = rules(current, inner, catalog)
      if (!next.ok) return next
      current = next.state
    }
    return { ok: true, state: current }
  }

  const draft = makeDraft(state)
  const error = legalError(state, replaced, draft, catalog)
  if (error) return { ok: false, error, state }

  coreApply(draft, replaced)
  pluginApply(state, replaced, draft, catalog)
  checkEnded(draft)
  const queued = [...draft.pending]
  return { ok: true, state: freezeDraft(draft), queued }
}

export const rules = (
  state: GameState,
  event: GameEvent,
  catalog: PluginCatalog,
): ReduceResult => {
  const first = reduceOnce(state, event, catalog)
  if (!first.ok || first.prevented) return first
  let current = first.state
  for (const queued of first.queued ?? []) {
    const next = rules(current, queued, catalog)
    if (!next.ok) return next
    current = next.state
  }
  for (let i = 0; i < SBA_CAP; i += 1) {
    const draft = makeDraft(current)
    const pending = collectSba(current, draft, catalog)
    if (pending.length === 0) {
      checkEnded(draft)
      return { ok: true, state: freezeDraft(draft) }
    }
    const next = reduceOnce(current, pending[0], catalog)
    if (!next.ok) return next
    if (next.prevented) break
    current = next.state
    for (const queued of next.queued ?? []) {
      const nested = rules(current, queued, catalog)
      if (!nested.ok) return nested
      current = nested.state
    }
  }
  return { ok: true, state: current }
}

export const isBattlefield = (zone: ZoneId) => zone === 'battlefield'
