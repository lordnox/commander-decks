import type { GameObject, GameState, ManaPool, PlayerId, ZoneId } from './types'

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

export type Draft = GameState & {
  pending: import('./types').GameEvent[]
  allocId: (prefix?: string) => string
  allocTs: () => number
  enqueue: (event: import('./types').GameEvent) => void
  note: (line: string) => void
  object: (id: string) => GameObject | undefined
  move: (id: string, to: ZoneId) => GameObject | undefined
  zoneOf: (zone: ZoneId, player?: PlayerId) => GameObject[]
}

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
  draft.move = (id, to) => {
    const object = draft.objects[id]
    if (!object) return undefined
    const from = object.zone
    const zones = draft.zoneOrder[object.owner]
    zones[from] = zones[from].filter((objectId) => objectId !== id)
    if (!zones[to].includes(id)) zones[to].push(id)
    draft.zoneCounts[object.owner][from] = Math.max(
      0,
      draft.zoneCounts[object.owner][from] - 1,
    )
    draft.zoneCounts[object.owner][to] += 1
    object.zone = to
    if (to !== 'battlefield') {
      object.tapped = false
      object.damageMarked = 0
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
  return draft
}

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
    ...state
  } = draft
  return state
}
