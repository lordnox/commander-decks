import {
  applyAbility,
  controlledByActivator,
  sourceCanTap,
  sourceOnBattlefield,
  whenAbility,
} from '../plugins/activateAbility'
import type Draft from '../draft'
import type { GameObject, GameState, PlayerId, Plugin } from '../types'

export const SEARCH_PENDING = 'librarySearch.pending'
export const SEARCH_DONE = 'librarySearch.done'
export const SEARCH_BEGIN = 'librarySearch.begin'
export const SEARCH_CHOSEN = 'librarySearch.chosen'
export const SEARCH_FETCH = 'librarySearch.fetch'

export type SearchDestination = 'hand' | 'battlefield' | 'graveyard'

export type SearchSpec = {
  /** Sentence shown to the searching seat only. */
  prompt: string
  match: (object: GameObject) => boolean
  destination: SearchDestination
  /** Battlefield destinations that Oracle puts onto the battlefield tapped. */
  tapped?: boolean
  min: number
  max: number
  /** Oracle "reveal it": the found card is published to the whole table. */
  reveal?: boolean
  /** Life paid as part of an activation cost. */
  life?: number
}

/** The searching seat's open choice, stored in authoritative state. */
export type PendingSearch = {
  source: string
  sourceId: string
  via: 'spell' | 'ability'
}

const basicLand = (object: GameObject) =>
  object.types.includes('Land') && object.supertypes.includes('Basic')

const hasSubtype = (...subtypes: string[]) => (object: GameObject) =>
  object.types.includes('Land') && subtypes.some((subtype) => object.subtypes.includes(subtype))

/** Sorceries and instants whose resolution is a library search. */
export const SEARCH_SPELLS: Record<string, SearchSpec> = {
  "Nature's Lore": {
    prompt: 'Search your library for a Forest card and put it onto the battlefield.',
    match: hasSubtype('Forest'),
    destination: 'battlefield',
    min: 1,
    max: 1,
  },
  'Three Visits': {
    prompt: 'Search your library for a Forest card and put it onto the battlefield.',
    match: hasSubtype('Forest'),
    destination: 'battlefield',
    min: 1,
    max: 1,
  },
  Farseek: {
    prompt: 'Search your library for a Plains, Island, Swamp, or Mountain card. It enters tapped.',
    match: hasSubtype('Plains', 'Island', 'Swamp', 'Mountain'),
    destination: 'battlefield',
    tapped: true,
    min: 1,
    max: 1,
  },
  Entomb: {
    prompt: 'Search your library for a card and put it into your graveyard.',
    match: () => true,
    destination: 'graveyard',
    min: 1,
    max: 1,
  },
  'Buried Alive': {
    prompt: 'Search your library for up to three creature cards and put them into your graveyard.',
    match: (object) => object.types.includes('Creature'),
    destination: 'graveyard',
    min: 0,
    max: 3,
  },
  'Unmarked Grave': {
    prompt: 'Search your library for a nonlegendary card and put it into your graveyard.',
    match: (object) => !object.supertypes.includes('Legendary'),
    destination: 'graveyard',
    min: 1,
    max: 1,
  },
}

/** Lands whose `{T}`, pay life, sacrifice ability is a library search. */
export const SEARCH_ABILITIES: Record<string, SearchSpec> = {
  'Misty Rainforest': {
    prompt: 'Search your library for a Forest or Island card and put it onto the battlefield.',
    match: hasSubtype('Forest', 'Island'),
    destination: 'battlefield',
    min: 1,
    max: 1,
    life: 1,
  },
  'Polluted Delta': {
    prompt: 'Search your library for an Island or Swamp card and put it onto the battlefield.',
    match: hasSubtype('Island', 'Swamp'),
    destination: 'battlefield',
    min: 1,
    max: 1,
    life: 1,
  },
  'Verdant Catacombs': {
    prompt: 'Search your library for a Swamp or Forest card and put it onto the battlefield.',
    match: hasSubtype('Swamp', 'Forest'),
    destination: 'battlefield',
    min: 1,
    max: 1,
    life: 1,
  },
  'Prismatic Vista': {
    prompt: 'Search your library for a basic land card and put it onto the battlefield.',
    match: basicLand,
    destination: 'battlefield',
    min: 1,
    max: 1,
    life: 1,
  },
}

export const searchSpecFor = (name: string): SearchSpec | undefined =>
  SEARCH_SPELLS[name] ?? SEARCH_ABILITIES[name]

export const pendingSearch = (
  state: GameState,
  seat: PlayerId,
): PendingSearch | undefined => {
  const value = state.players[seat]?.data[SEARCH_PENDING]
  if (!value || typeof value !== 'object') return undefined
  const pending = value as PendingSearch
  return typeof pending.source === 'string' && searchSpecFor(pending.source)
    ? pending
    : undefined
}

/** The seat with an open search, if any. At most one is open at a time. */
export const searchingSeat = (state: GameState) =>
  state.playerOrder.find((seat) => pendingSearch(state, seat))

/** Library cards this search may legally find. Authoritative state only. */
export const searchCandidates = (
  state: GameState,
  seat: PlayerId,
  spec: SearchSpec,
) =>
  (state.zoneOrder[seat]?.library ?? [])
    .map((objectId) => state.objects[objectId])
    .filter((object): object is GameObject => Boolean(object) && spec.match(object))

const searchDone = (state: GameState, seat: PlayerId) =>
  state.players[seat]?.data[SEARCH_DONE] === true

const openSearch = (draft: Draft, seat: PlayerId, pending: PendingSearch) => {
  draft.players[seat].data[SEARCH_PENDING] = pending
  draft.note(`${seat} searches their library for ${pending.source}`)
}

const abilityLand = (name: string) => SEARCH_ABILITIES[name]?.life !== undefined

/**
 * One search capability for every "search your library" card in the pool. The
 * kernel never picks the card: it stops, records whose choice is open, and
 * resumes only after the host dispatches the chosen moves and
 * `librarySearch.chosen`. A restarted host rebuilds the same dialog from this
 * marker because it lives in authoritative state, not in the host process.
 */
export const librarySearch: Plugin = {
  id: 'librarySearch',
  legal: (ctx) => {
    const { state, event } = ctx
    if (event.type === 'passPriority') {
      const seat = searchingSeat(state)
      if (seat) {
        return `${seat} is searching their library for ${pendingSearch(state, seat)!.source}`
      }
      return
    }
    const fetchError = whenAbility(
      SEARCH_FETCH,
      (abilityCtx) => {
        const source = abilityCtx.state.objects[abilityCtx.event.objectId]
        if (!source || !abilityLand(source.name)) {
          return 'that card has no library-search ability'
        }
      },
      sourceOnBattlefield(),
      controlledByActivator(),
      sourceCanTap(),
      (abilityCtx) => {
        const source = abilityCtx.state.objects[abilityCtx.event.objectId]
        const life = source ? SEARCH_ABILITIES[source.name]?.life ?? 0 : 0
        if (abilityCtx.state.players[abilityCtx.event.seat].life <= life) {
          return `${abilityCtx.event.seat} cannot pay ${life} life`
        }
      },
      (abilityCtx) => {
        if (searchingSeat(abilityCtx.state)) return 'another library search is still open'
      },
    )?.(ctx)
    if (fetchError) return fetchError
  },
  replace: ({ state, event }) => {
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (!item || !SEARCH_SPELLS[item.name]) return
    if (searchDone(state, item.controller)) return
    if (pendingSearch(state, item.controller)) return null
    return {
      type: 'custom',
      name: SEARCH_BEGIN,
      seat: item.controller,
      payload: { source: item.name, sourceId: item.objectId, via: 'spell' },
    }
  },
  apply: (ctx) => {
    const { state, event, draft } = ctx
    if (event.type === 'custom' && event.name === SEARCH_BEGIN && event.seat) {
      const source = String(event.payload?.source ?? '')
      if (!searchSpecFor(source)) return
      openSearch(draft, event.seat, {
        source,
        sourceId: String(event.payload?.sourceId ?? ''),
        via: String(event.payload?.via) === 'ability' ? 'ability' : 'spell',
      })
      return
    }

    if (event.type === 'custom' && event.name === SEARCH_CHOSEN && event.seat) {
      const pending = pendingSearch(state, event.seat)
      delete draft.players[event.seat].data[SEARCH_PENDING]
      if (pending?.via === 'spell') draft.players[event.seat].data[SEARCH_DONE] = true
      return
    }

    if (event.type === 'resolveTop') {
      const item = state.stack[0]
      if (item && searchDone(state, item.controller)) {
        delete draft.players[item.controller].data[SEARCH_DONE]
      }
    }

    applyAbility(SEARCH_FETCH, ({ event: ability, draft: next }) => {
      const source = next.object(ability.objectId)
      if (!source) return
      const spec = SEARCH_ABILITIES[source.name]
      if (!spec) return
      if (spec.life) {
        next.enqueue({
          type: 'loseLife',
          seat: ability.seat,
          amount: spec.life,
          source: source.name,
        })
      }
      next.enqueue({ type: 'move', objectId: source.id, to: 'graveyard' })
      openSearch(next, ability.seat, {
        source: source.name,
        sourceId: source.id,
        via: 'ability',
      })
    })?.(ctx)
  },
}
