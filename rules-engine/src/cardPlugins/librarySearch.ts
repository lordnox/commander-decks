import type Draft from '../draft'
import type { GameObject, GameState, PlayerId, Plugin } from '../types'
import {
  basicLand,
  hasSubtype,
  manaValueOf,
  type SearchDestination,
  type SearchSpec,
} from './effects'

export type { SearchDestination, SearchSpec } from './effects'

export const SEARCH_PENDING = 'librarySearch.pending'
export const SEARCH_BEGIN = 'librarySearch.begin'
export const SEARCH_CHOSEN = 'librarySearch.chosen'

export type SearchMove = {
  objectId: string
  destination: SearchDestination
}

/** The searching seat's open choice, stored in authoritative state. */
export type PendingSearch = {
  source: string
  sourceId: string
  via: 'resolve'
  max?: number
  x?: number
  shuffleIfSearched?: boolean
}

const inlineSpecKey = (sourceId: string) => `librarySearch.inlineSpec.${sourceId}`

export const typecycleSearchSpec = (subtype: string): SearchSpec => ({
  prompt: `Search your library for a ${subtype} card, reveal it, put it into your hand, then shuffle.`,
  match: hasSubtype(subtype),
  destination: 'hand',
  min: 1,
  max: 1,
  reveal: true,
})

type InlineSearchRef = SearchSpec | { subtype: string }

const inlineSearchRef = (state: GameState | Draft, sourceId: string): InlineSearchRef | undefined => {
  for (const seat of state.playerOrder) {
    const stored = state.players[seat]?.data[inlineSpecKey(sourceId)]
    if (!stored || typeof stored !== 'object') continue
    if (typeof (stored as { subtype?: string }).subtype === 'string') {
      return stored as { subtype: string }
    }
    if (typeof (stored as SearchSpec).match === 'function') {
      return stored as SearchSpec
    }
  }
}

const inlineSpec = (state: GameState | Draft, sourceId: string): SearchSpec | undefined => {
  const stored = inlineSearchRef(state, sourceId)
  if (!stored) return
  if (typeof (stored as { subtype?: string }).subtype === 'string') {
    return typecycleSearchSpec((stored as { subtype: string }).subtype)
  }
  return stored as SearchSpec
}

export const searchSpecForPending = (
  state: GameState | Draft,
  pending: PendingSearch,
): SearchSpec | undefined => {
  const spec = inlineSpec(state, pending.sourceId)
  if (!spec) return
  return pending.max === undefined ? spec : { ...spec, max: pending.max }
}

export const validateSplitSearchSelection = (
  spec: SearchSpec,
  selections: Array<{ destination: SearchDestination }>,
): string | void => {
  const split = spec.split
  if (!split) return
  const battlefield = selections.filter(({ destination }) => destination === 'battlefield').length
  const hand = selections.filter(({ destination }) => destination === 'hand').length
  if (selections.length > split.totalMax) {
    return `Choose at most ${split.totalMax} basic land card(s).`
  }
  if (battlefield < split.battlefield.min || battlefield > split.battlefield.max) {
    return `Choose ${split.battlefield.min === split.battlefield.max
      ? split.battlefield.min
      : `between ${split.battlefield.min} and ${split.battlefield.max}`} land(s) for the battlefield.`
  }
  if (hand < split.hand.min || hand > split.hand.max) {
    return `Choose ${split.hand.min === split.hand.max
      ? split.hand.min
      : `between ${split.hand.min} and ${split.hand.max}`} land(s) for your hand.`
  }
  if (split.paired && selections.length === 2 && (battlefield !== 1 || hand !== 1)) {
    return 'When you find two lands, put one onto the battlefield and one into your hand.'
  }
}

const isPending = (value: unknown): value is PendingSearch =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingSearch).source === 'string'
  && typeof (value as PendingSearch).sourceId === 'string'

const pendingSearches = (state: GameState | Draft, seat: PlayerId): PendingSearch[] => {
  const value = state.players[seat]?.data[SEARCH_PENDING]
  if (Array.isArray(value)) return value.filter(isPending)
  return isPending(value) ? [value] : []
}

export const pendingSearch = (state: GameState, seat: PlayerId) =>
  pendingSearches(state, seat)[0]

export const searchingSeat = (state: GameState) =>
  state.playerOrder.find((seat) => pendingSearch(state, seat))

const libraryCharacteristics = (object: GameObject): GameObject =>
  object.frontFace ? { ...object, ...object.frontFace } : object

const matchesSearch = (
  object: GameObject,
  spec: SearchSpec,
  x?: number,
) => {
  const characteristics = libraryCharacteristics(object)
  if (!spec.match(characteristics)) return false
  if (spec.maxManaValue === 'x') return manaValueOf(characteristics) <= Math.max(0, x ?? 0)
  if (typeof spec.maxManaValue === 'number') {
    return manaValueOf(characteristics) <= spec.maxManaValue
  }
  return true
}

export const searchCandidates = (
  state: GameState,
  seat: PlayerId,
  spec: SearchSpec,
  x?: number,
) => {
  const zones = spec.zones ?? ['library']
  return zones.flatMap((zone) => {
    const ids = (zone === 'graveyard'
      ? state.zoneOrder[seat]?.graveyard
      : state.zoneOrder[seat]?.library) ?? []
    return ids
      .map((objectId) => state.objects[objectId])
      .filter((object): object is GameObject =>
        Boolean(object) && matchesSearch(object, spec, x))
  })
}

const openSearch = (draft: Draft, seat: PlayerId, pending: PendingSearch) => {
  draft.players[seat].data[SEARCH_PENDING] = [...pendingSearches(draft, seat), pending]
  draft.note(`${seat} searches their library for ${pending.source}`)
}

const closeSearch = (draft: Draft, seat: PlayerId) => {
  const remaining = pendingSearches(draft, seat).slice(1)
  if (remaining.length === 0) delete draft.players[seat].data[SEARCH_PENDING]
  else draft.players[seat].data[SEARCH_PENDING] = remaining
}

const storeInlineSpec = (draft: Draft, seat: PlayerId, sourceId: string, spec: InlineSearchRef) => {
  draft.players[seat].data[inlineSpecKey(sourceId)] = spec
}

const resolvePayloadSpec = (payloadSpec: unknown): SearchSpec | undefined => {
  if (!payloadSpec || typeof payloadSpec !== 'object') return
  const candidate = payloadSpec as SearchSpec
  if (typeof candidate.match === 'function') return candidate
  if (candidate.destination && candidate.min !== undefined && candidate.max !== undefined) {
    return {
      ...candidate,
      match: basicLand,
    }
  }
}

export const librarySearch: Plugin = {
  id: 'librarySearch',
  legal: (ctx) => {
    const { state, event } = ctx
    if (event.type !== 'passPriority') return
    const seat = searchingSeat(state)
    if (seat) return `${seat} is searching their library for ${pendingSearch(state, seat)!.source}`
  },
  apply: (ctx) => {
    const { state, event, draft } = ctx
    if (event.type === 'custom' && event.name === SEARCH_BEGIN && event.seat) {
      const source = String(event.payload?.source ?? '')
      const sourceId = String(event.payload?.sourceId ?? '')
      const via = 'resolve' as const
      const payloadSpec = resolvePayloadSpec(event.payload?.spec)
      const subtype = typeof event.payload?.subtype === 'string'
        ? event.payload.subtype
        : undefined
      if (subtype) storeInlineSpec(draft, event.seat, sourceId, { subtype })
      else if (payloadSpec) storeInlineSpec(draft, event.seat, sourceId, payloadSpec)
      else return
      const spec = payloadSpec
      openSearch(draft, event.seat, {
        source,
        sourceId,
        via,
        ...(typeof event.payload?.max === 'number' ? { max: event.payload.max } : {}),
        ...(typeof event.payload?.x === 'number' ? { x: event.payload.x } : {}),
        ...(event.payload?.shuffleIfSearched === true || spec?.shuffleIfSearched
          ? { shuffleIfSearched: true }
          : {}),
      })
      return
    }

    if (event.type === 'custom' && event.name === SEARCH_CHOSEN && event.seat) {
      const pending = pendingSearch(state, event.seat)
      closeSearch(draft, event.seat)
      if (pending?.sourceId) delete draft.players[event.seat].data[inlineSpecKey(pending.sourceId)]
      return
    }
  },
}
