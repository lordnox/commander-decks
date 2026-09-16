import {
  applyAbility,
  controlledByActivator,
  sourceCanTap,
  sourceOnBattlefield,
  whenAbility,
} from '../plugins/activateAbility'
import { payCost } from '../plugins/spells'
import type Draft from '../draft'
import type { GameObject, GameState, PlayerId, Plugin } from '../types'
import { effectsFor } from './cardRules'
import { searchEffect, type SearchSpec } from './effects'

export type { SearchDestination, SearchSpec } from './effects'

export const SEARCH_PENDING = 'librarySearch.pending'
export const SEARCH_DONE = 'librarySearch.done'
export const SEARCH_BEGIN = 'librarySearch.begin'
export const SEARCH_CHOSEN = 'librarySearch.chosen'
export const SEARCH_FETCH = 'librarySearch.fetch'

/** The searching seat's open choice, stored in authoritative state. */
export type PendingSearch = {
  source: string
  sourceId: string
  via: 'spell' | 'ability'
  kicked?: boolean
}

export const searchSpecFor = (name: string): SearchSpec | undefined =>
  searchEffect(effectsFor(name))?.spec

const abilitySpec = (object: GameObject) => {
  const effect = searchEffect(effectsFor(object.name))
  return effect?.via === 'ability' ? effect.spec : undefined
}

const spellSpec = (object: GameObject) => {
  const effect = searchEffect(effectsFor(object.name))
  return effect?.via === 'spell' ? effect.spec : undefined
}

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
  kicked = false,
) =>
  (state.zoneOrder[seat]?.library ?? [])
    .map((objectId) => state.objects[objectId])
    .filter((object): object is GameObject =>
      Boolean(object) && (kicked && spec.kickedMatch ? spec.kickedMatch(object) : spec.match(object)))

const searchDone = (state: GameState, seat: PlayerId) =>
  state.players[seat]?.data[SEARCH_DONE] === true

const openSearch = (draft: Draft, seat: PlayerId, pending: PendingSearch) => {
  draft.players[seat].data[SEARCH_PENDING] = pending
  draft.note(`${seat} searches their library for ${pending.source}`)
}

const hasSearchAbility = (object: GameObject) => Boolean(abilitySpec(object))

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
        if (!source || !hasSearchAbility(source)) {
          return 'that card has no library-search ability'
        }
      },
      sourceOnBattlefield(),
      controlledByActivator(),
      sourceCanTap(),
      (abilityCtx) => {
        const source = abilityCtx.state.objects[abilityCtx.event.objectId]
        const life = source ? abilitySpec(source)?.life ?? 0 : 0
        if (abilityCtx.state.players[abilityCtx.event.seat].life <= life) {
          return `${abilityCtx.event.seat} cannot pay ${life} life`
        }
      },
      (abilityCtx) => {
        const source = abilityCtx.state.objects[abilityCtx.event.objectId]
        const cost = source ? abilitySpec(source)?.manaCost : undefined
        if (!cost) return
        const pool = abilityCtx.state.players[abilityCtx.event.seat].mana
        if (!payCost(pool, cost)) return `${abilityCtx.event.seat} cannot pay ${cost}`
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
    const object = item ? state.objects[item.objectId] : undefined
    if (!item || !object || !spellSpec(object)) return
    if (searchDone(state, item.controller)) return
    if (pendingSearch(state, item.controller)) return null
    return {
      type: 'custom',
      name: SEARCH_BEGIN,
      seat: item.controller,
      payload: {
        source: item.name,
        sourceId: item.objectId,
        via: 'spell',
        kicked: item.kicked === true,
      },
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
        ...(event.payload?.kicked === true ? { kicked: true } : {}),
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
      const spec = abilitySpec(source)
      if (!spec) return
      if (spec.life) {
        next.enqueue({
          type: 'loseLife',
          seat: ability.seat,
          amount: spec.life,
          source: source.name,
        })
      }
      if (spec.manaCost) {
        next.enqueue({ type: 'payMana', seat: ability.seat, cost: spec.manaCost })
      }
      if (spec.sacrifice !== false) {
        next.enqueue({ type: 'move', objectId: source.id, to: 'graveyard' })
      }
      openSearch(next, ability.seat, {
        source: source.name,
        sourceId: source.id,
        via: 'ability',
      })
    })?.(ctx)
  },
}
