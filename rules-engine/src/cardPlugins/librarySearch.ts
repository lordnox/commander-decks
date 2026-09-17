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
import { payActivateCosts } from './activated'
import { conditionHolds, searchEffect, type SearchSpec } from './effects'
import { effectsFor } from './cardRules'
import { enteringObjectId } from './entersTapped'
import {
  clearPendingDialog,
  DIALOG_CHOSEN,
  pendingDialogFor,
  setPendingDialog,
} from '../pendingDialog'

export type { SearchDestination, SearchSpec } from './effects'

export const SEARCH_PENDING = 'librarySearch.pending'
export const SEARCH_DONE = 'librarySearch.done'
export const SEARCH_BEGIN = 'librarySearch.begin'
export const SEARCH_CHOSEN = 'librarySearch.chosen'
export const SEARCH_FETCH = 'librarySearch.fetch'
export const SEARCH_SACRIFICE_BEGIN = 'librarySearch.sacrificeBegin'

/** The searching seat's open choice, stored in authoritative state. */
export type PendingSearch = {
  source: string
  sourceId: string
  via: 'spell' | 'ability' | 'enters'
  kicked?: boolean
  max?: number
}

export const searchSpecFor = (name: string): SearchSpec | undefined =>
  searchEffect(effectsFor(name))?.spec

export const searchSpecForPending = (pending: PendingSearch): SearchSpec | undefined => {
  const spec = searchSpecFor(pending.source)
  if (!spec) return
  return pending.max === undefined ? spec : { ...spec, max: pending.max }
}

const abilityEffect = (object: GameObject) => {
  const effect = searchEffect(effectsFor(object.name))
  return effect?.via === 'ability' ? effect : undefined
}

const spellSpec = (object: GameObject) => {
  const effect = searchEffect(effectsFor(object.name))
  return effect?.via === 'spell' ? effect.spec : undefined
}

const entersSpec = (object: GameObject) => {
  const effect = searchEffect(effectsFor(object.name))
  return effect?.via === 'enters' ? effect.spec : undefined
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

/**
 * A double-faced card in a library has only its front face's characteristics.
 * The object's combined characteristics remain useful to the replay importer,
 * but cannot make a front-face instant into a land a search may find.
 */
const libraryCharacteristics = (object: GameObject): GameObject =>
  object.frontFace ? { ...object, ...object.frontFace } : object

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
      Boolean(object) && (
        kicked && spec.kickedMatch
          ? spec.kickedMatch(libraryCharacteristics(object))
          : spec.match(libraryCharacteristics(object))
      ))

const searchDone = (state: GameState, seat: PlayerId) =>
  state.players[seat]?.data[SEARCH_DONE] === true

const openSearch = (draft: Draft, seat: PlayerId, pending: PendingSearch) => {
  draft.players[seat].data[SEARCH_PENDING] = pending
  draft.note(`${seat} searches their library for ${pending.source}`)
}

const hasSearchAbility = (object: GameObject) => Boolean(abilityEffect(object))

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
        const life = source ? abilityEffect(source)?.costs.life ?? 0 : 0
        if (abilityCtx.state.players[abilityCtx.event.seat].life <= life) {
          return `${abilityCtx.event.seat} cannot pay ${life} life`
        }
      },
      (abilityCtx) => {
        const source = abilityCtx.state.objects[abilityCtx.event.objectId]
        const cost = source ? abilityEffect(source)?.costs.mana : undefined
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
    const spec = object ? spellSpec(object) : undefined
    if (!item || !object || !spec) return
    if (searchDone(state, item.controller)) return
    if (pendingSearch(state, item.controller)) return null
    // Scapeshift sacrifices as it resolves, so the spell waits on the stack
    // until its controller has chosen. Only then is the search bounded.
    if (spec.sacrificeOnResolve) {
      if (pendingDialogFor(state, item.controller)?.kind === 'sacrifice-lands') return null
      return {
        type: 'custom',
        name: SEARCH_SACRIFICE_BEGIN,
        seat: item.controller,
        payload: { sourceId: item.objectId },
      }
    }
    return {
      type: 'custom',
      name: SEARCH_BEGIN,
      seat: item.controller,
      payload: {
        source: item.name,
        sourceId: item.objectId,
        via: 'spell',
        kicked: item.kicked === true,
        max: spec.empoweredIf
          && spec.empoweredMax
          && conditionHolds(spec.empoweredIf, state, object)
          ? spec.empoweredMax
          : undefined,
      },
    }
  },
  apply: (ctx) => {
    const { state, event, draft } = ctx
    if (event.type === 'custom' && event.name === SEARCH_SACRIFICE_BEGIN && event.seat) {
      const sourceId = event.payload?.sourceId
      const source = typeof sourceId === 'string' ? draft.object(sourceId) : undefined
      if (!source) return
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: event.seat,
        kind: 'sacrifice-lands',
        prompt: `Sacrifice any number of lands. ${source.name} then searches for that many land cards.`,
        waiting: 'is choosing lands to sacrifice.',
        judge: `${source.name} is resolving; its controller is sacrificing lands.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['battlefield', 'sacrifice'],
      })
      draft.note(`${source.name} resolves: ${event.seat} sacrifices lands`)
      return
    }

    if (event.type === 'custom' && event.name === DIALOG_CHOSEN && event.seat) {
      const dialog = pendingDialogFor(state, event.seat)
      if (dialog?.kind !== 'sacrifice-lands') return
      const sacrificed = (Array.isArray(event.payload?.objectIds)
        ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
        : []).filter((objectId) => {
        const land = draft.object(objectId)
        return land?.zone === 'battlefield'
          && land.controller === event.seat
          && land.types.includes('Land')
      })
      for (const objectId of sacrificed) {
        draft.enqueue({ type: 'move', objectId, to: 'graveyard' })
      }
      clearPendingDialog(draft, event.seat)
      // Searching for up to zero cards finds nothing, so only the shuffle and
      // the rest of the resolution are left.
      if (sacrificed.length === 0) {
        draft.players[event.seat].data[SEARCH_DONE] = true
        draft.enqueue({ type: 'shuffleLibrary', seat: event.seat })
        draft.enqueue({ type: 'resolveTop' })
        draft.note(`${dialog.source} sacrifices no lands`)
        return
      }
      openSearch(draft, event.seat, {
        source: dialog.source,
        sourceId: dialog.sourceId,
        via: 'spell',
        max: sacrificed.length,
      })
      return
    }
    if (event.type === 'custom' && event.name === SEARCH_BEGIN && event.seat) {
      const source = String(event.payload?.source ?? '')
      if (!searchSpecFor(source)) return
      openSearch(draft, event.seat, {
        source,
        sourceId: String(event.payload?.sourceId ?? ''),
        via: String(event.payload?.via) === 'ability'
          ? 'ability'
          : String(event.payload?.via) === 'enters'
            ? 'enters'
            : 'spell',
        ...(event.payload?.kicked === true ? { kicked: true } : {}),
        ...(typeof event.payload?.max === 'number' ? { max: event.payload.max } : {}),
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

    const enteredId = enteringObjectId(event, state)
    const entered = enteredId ? draft.object(enteredId) : undefined
    const enteredSpec = entered ? entersSpec(entered) : undefined
    if (entered && enteredSpec && entered.zone === 'battlefield') {
      draft.enqueue({ type: 'move', objectId: entered.id, to: 'graveyard' })
      if (enteredSpec.gainLife) {
        draft.players[entered.controller].life += enteredSpec.gainLife
        draft.note(`${entered.controller} gains ${enteredSpec.gainLife} life (${entered.name})`)
      }
      openSearch(draft, entered.controller, {
        source: entered.name,
        sourceId: entered.id,
        via: 'enters',
      })
      return
    }

    applyAbility(SEARCH_FETCH, ({ event: ability, draft: next }) => {
      const source = next.object(ability.objectId)
      if (!source) return
      const effect = abilityEffect(source)
      if (!effect) return
      payActivateCosts(next, source, ability.seat, effect.costs)
      openSearch(next, ability.seat, {
        source: source.name,
        sourceId: source.id,
        via: 'ability',
      })
    })?.(ctx)
  },
}
