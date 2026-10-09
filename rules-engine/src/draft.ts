import { STUN_COUNTER } from './rules/untap'
import type { CardInstruction } from './cardPlugins/effects'
import { counterPtBonus } from './definitions'
import { captureObject, pinTarget, refreshLastKnownSource, snapshotObject } from './objectIdentity'
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
    sameZone?: 'reorder' | 'newObject',
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
   * `payload` and allocates a stable stack id via `addToStack`.
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
  draft.move = (id, to, position = 'bottom', sameZone) => {
    const object = draft.objects[id]
    if (!object) return undefined
    const from = object.zone
    const sameZoneCreatesObject = sameZone === 'newObject'
      || (sameZone === undefined && (from === 'exile' || from === 'command'))
    const becomesNewObject = from !== to || sameZoneCreatesObject
    const before = becomesNewObject ? snapshotObject(object) : undefined
    if (before) {
      refreshLastKnownSource(draft.stack, before)
      for (const player of draft.playerOrder) refreshLastKnownSource(draft.players[player].data, before)
    }
    const zones = draft.zoneOrder[object.owner]
    zones[from] = zones[from].filter((objectId) => objectId !== id)
    if (!zones[to].includes(id)) {
      if (position === 'top') zones[to].unshift(id)
      else zones[to].push(id)
    }
    if (from !== to) {
      draft.zoneCounts[object.owner][from] = Math.max(
        0,
        draft.zoneCounts[object.owner][from] - 1,
      )
      draft.zoneCounts[object.owner][to] += 1
    }
    object.zone = to
    if (becomesNewObject) object.incarnation += 1
    if (from === 'battlefield' && to !== 'battlefield') {
      // CR 400.7: the object that arrives is new, so counters do not follow it.
      // Their contribution to P/T is stored eagerly and must come back out.
      const bonus = counterPtBonus(object)
      if (object.power !== null) object.power -= bonus
      if (object.toughness !== null) object.toughness -= bonus
      object.counters = {}
    }
    if (to !== 'battlefield') {
      delete object.enteredWithCastOption
      object.tapped = false
      object.damageMarked = 0
      delete object.deathtouched
      object.attacking = null
      delete object.blocked
      object.blocking = null
      object.summoningSickness = false
      delete object.skipNextUntap
      delete object.counters[STUN_COUNTER]
    }
    return object
  }
  draft.zoneOf = (zone, seat) =>
    Object.values(draft.objects).filter(
      (object) => object.zone === zone && (!seat || object.controller === seat),
    )
  draft.addToStack = (item) => {
    const cloned = structuredClone(item)
    const id = cloned.id ?? draft.allocId('stack')
    const source = draft.object(cloned.objectId)
    const existingExecution = cloned.execution
    const capturedSource = existingExecution?.source.ref.objectId === item.objectId
      ? existingExecution.source
      : source
        ? captureObject(source)
        : undefined
    const stackItem: StackItem = {
      ...cloned,
      id,
      targets: cloned.targets.map((target) => pinTarget(draft, target)),
      ...(capturedSource
        ? {
            execution: {
              ...existingExecution,
              controller: cloned.controller,
              source: capturedSource,
              ...(cloned.kind === 'spell' && source?.ruleDefinition
                ? { definitionSnapshot: source.ruleDefinition }
                : {}),
            },
          }
        : {}),
    }
    draft.stack.unshift(stackItem)
    return stackItem
  }
  draft.addTriggeredAbility = (source, instructions, meta = {}) => {
    const { payload: extraPayload, ...rest } = meta
    return draft.addToStack({
      kind: 'ability',
      objectId: source.id,
      controller: meta.execution?.controller ?? source.controller,
      name: source.name,
      targets: [],
      execution: meta.execution ?? {
        controller: source.controller,
        source: captureObject(source),
      },
      ...rest,
      payload: {
        instructions,
        triggeringPlayer: extraPayload?.triggeringPlayer,
        ...extraPayload,
      },
    })
  }
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
