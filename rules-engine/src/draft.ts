import type { CardInstruction } from './cardPlugins/effects'
import type { GameEvent, GameObject, GameState, ManaPool, PlayerId, StackItem, ZoneId } from './types'

export const emptyMana = (): ManaPool => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })

export const addPools = (base: ManaPool, extra: Partial<ManaPool>) => {
  const next = { ...base }
  for (const key of Object.keys(extra) as (keyof ManaPool)[]) {
    next[key] = (next[key] ?? 0) + (extra[key] ?? 0)
  }
  return next
}

export const poolTotal = (pool: ManaPool) =>
  pool.W + pool.U + pool.B + pool.R + pool.G + pool.C

export const payFromPool = (pool: ManaPool, cost: Partial<ManaPool>) => {
  const next = { ...pool }
  for (const key of Object.keys(cost) as (keyof ManaPool)[]) {
    const need = cost[key] ?? 0
    if ((next[key] ?? 0) < need) return null
    next[key] -= need
  }
  return next
}

export const parseManaCost = (cost: string): Partial<ManaPool> => {
  const generic = cost.match(/\{(\d+)\}/)
  const out: Partial<ManaPool> = generic ? { C: Number(generic[1]) } : {}
  for (const sym of ['W', 'U', 'B', 'R', 'G', 'C'] as const) {
    const n = [...cost.matchAll(new RegExp(`\\{${sym}\\}`, 'g'))].length
    if (n) out[sym] = (out[sym] ?? 0) + n
  }
  return out
}

export const nextPlayer = (state: GameState, player: PlayerId) => {
  const index = state.playerOrder.indexOf(player)
  return state.playerOrder[(index + 1) % state.playerOrder.length]
}

/**
 * Mutable working copy of `GameState` during one reduce step.
 * Helper methods are stripped by `freezeDraft` before returning to callers.
 */
export type Draft = GameState & {
  /** Events queued during apply; drained after the current event finishes. */
  pending: GameEvent[]
  /** Allocate a stable id (`stack5`, `obj12`, …). Never reuse or regenerate. */
  allocId: (prefix?: string) => string
  /** Allocate the next rule timestamp. */
  allocTs: () => number
  /** Append a follow-up event to `pending`. */
  enqueue: (event: GameEvent) => void
  /** Append a line to `log`. */
  note: (line: string) => void
  /** Look up an object by id in the draft. */
  object: (id: string) => GameObject | undefined
  /** Move an object between zones and update `zoneOrder`. */
  move: (
    id: string,
    to: ZoneId,
    position?: 'top' | 'bottom',
  ) => GameObject | undefined
  /** List objects in a zone, optionally filtered by controller. */
  zoneOf: (zone: ZoneId, player?: PlayerId) => GameObject[]
  /**
   * Push a stack item (LIFO: unshift). Allocates `id` via `allocId('stack')`
   * when omitted; never regenerates an existing id.
   */
  addToStack: (item: Omit<StackItem, 'id'> & { id?: string }) => StackItem
  /**
   * Push a triggered ability onto the stack. Stores `instructions` in
   * `payload` for Phase 1 resolution via `addToStack`.
   */
  addTriggeredAbility: (
    source: GameObject,
    instructions: CardInstruction[],
    meta?: Partial<StackItem>,
  ) => StackItem
}

export type { Draft as default }

export const makeDraft = (state: GameState): Draft => {
  const draft = structuredClone(state) as Draft
  draft.prevented = false
  draft.pending = []
  draft.enqueue = (event) => {
    draft.pending.push(event)
  }
  draft.allocId = (prefix = 'x') => {
    const id = `${prefix}${draft.nextId}`
    draft.nextId += 1
    return id
  }
  draft.allocTs = () => {
    const ts = draft.nextTimestamp
    draft.nextTimestamp += 1
    return ts
  }
  draft.note = (line) => {
    draft.log.push(line)
  }
  draft.object = (id) => draft.objects[id]
  draft.move = (id, to, position = 'bottom') => {
    const object = draft.objects[id]
    if (!object) return undefined
    const from = object.zone
    const zones = draft.zoneOrder[object.owner]
    zones[from] = zones[from].filter((objectId) => objectId !== id)
    if (!zones[to].includes(id)) {
      if (position === 'top') zones[to].unshift(id)
      else zones[to].push(id)
    }
    draft.zoneCounts[object.owner][from] = Math.max(
      0,
      draft.zoneCounts[object.owner][from] - 1,
    )
    draft.zoneCounts[object.owner][to] += 1
    object.zone = to
    if (to !== 'battlefield') {
      object.tapped = false
      object.damageMarked = 0
      delete object.deathtouched
      object.attacking = null
      object.blocking = null
      object.summoningSickness = false
    }
    return object
  }
  draft.zoneOf = (zone, seat) =>
    Object.values(draft.objects).filter(
      (object) => object.zone === zone && (!seat || object.controller === seat),
    )
  draft.addToStack = (item) => {
    const id = item.id ?? draft.allocId('stack')
    const stackItem: StackItem = { ...item, id }
    draft.stack.unshift(stackItem)
    return stackItem
  }
  draft.addTriggeredAbility = (source, instructions, meta = {}) =>
    draft.addToStack({
      kind: 'ability',
      objectId: source.id,
      controller: source.controller,
      name: source.name,
      targets: [],
      payload: { instructions },
      ...meta,
    })
  return draft
}

/** Remove draft-only helpers and return a plain `GameState`. */
export const freezeDraft = (draft: Draft): GameState => {
  const {
    allocId: _a,
    allocTs: _b,
    note: _c,
    object: _d,
    move: _e,
    zoneOf: _f,
    enqueue: _g,
    pending: _h,
    addToStack: _i,
    addTriggeredAbility: _j,
    ...state
  } = draft
  return state
}
