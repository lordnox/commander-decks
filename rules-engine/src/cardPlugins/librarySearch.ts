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
import { basicLand, conditionHolds, searchEffect, type SearchDestination, type SearchSpec } from './effects'
import { effectsFor } from './cardRules'
import { enteringObjectId } from './entersTapped'
import {
  clearPendingDialog,
  DIALOG_CHOSEN,
  hasPendingDialog,
  pendingDialogFor,
  setPendingDialog,
} from '../pendingDialog'

export type { SearchDestination, SearchSpec } from './effects'

export const SEARCH_PENDING = 'librarySearch.pending'
export const SEARCH_DONE = 'librarySearch.done'
export const SEARCH_DEFERRED = 'librarySearch.deferred'
export const SEARCH_BEGIN = 'librarySearch.begin'
export const SEARCH_CHOSEN = 'librarySearch.chosen'
export const SEARCH_FETCH = 'librarySearch.fetch'
export const SEARCH_SACRIFICE_BEGIN = 'librarySearch.sacrificeBegin'

export type SearchMove = {
  objectId: string
  destination: SearchDestination
}

/** The searching seat's open choice, stored in authoritative state. */
export type PendingSearch = {
  source: string
  sourceId: string
  via: 'spell' | 'ability' | 'enters' | 'resolve'
  kicked?: boolean
  max?: number
}

const inlineSpecKey = (sourceId: string) => `librarySearch.inlineSpec.${sourceId}`

export const searchSpecFor = (name: string): SearchSpec | undefined =>
  searchEffect(effectsFor(name))?.spec

const inlineSpec = (state: GameState | Draft, sourceId: string): SearchSpec | undefined => {
  for (const seat of state.playerOrder) {
    const stored = state.players[seat]?.data[inlineSpecKey(sourceId)]
    if (stored && typeof stored === 'object' && typeof (stored as SearchSpec).match === 'function') {
      return stored as SearchSpec
    }
  }
}

export const searchSpecForPending = (
  state: GameState | Draft,
  pending: PendingSearch,
): SearchSpec | undefined => {
  const inline = inlineSpec(state, pending.sourceId)
  const spec = inline ?? searchSpecFor(pending.source)
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
  draft.players[seat].data[SEARCH_PENDING] = [...pendingSearches(draft, seat), pending]
  draft.note(`${seat} searches their library for ${pending.source}`)
}

const closeSearch = (draft: Draft, seat: PlayerId) => {
  const remaining = pendingSearches(draft, seat).slice(1)
  if (remaining.length === 0) delete draft.players[seat].data[SEARCH_PENDING]
  else draft.players[seat].data[SEARCH_PENDING] = remaining
}

const hasSearchAbility = (object: GameObject) => Boolean(abilityEffect(object))

const shouldSacrificeOnEnter = (spec: SearchSpec) =>
  spec.sacrificeSource !== false && Boolean(spec.gainLife)

const storeInlineSpec = (draft: Draft, seat: PlayerId, sourceId: string, spec: SearchSpec) => {
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

const beginEnterSearch = (
  draft: Draft,
  entered: GameObject,
  enteredSpec: SearchSpec,
) => {
  if (enteredSpec.optionalEnter) {
    setPendingDialog(draft, {
      sourceId: entered.id,
      source: entered.name,
      seat: entered.controller,
      kind: 'may-search',
      prompt: enteredSpec.prompt,
      waiting: 'is deciding whether to search.',
      judge: `Waiting for optional search from ${entered.name}.`,
      chosenEvent: DIALOG_CHOSEN,
      destinations: ['skip', 'target'],
      optional: true,
    })
    return
  }
  if (shouldSacrificeOnEnter(enteredSpec)) {
    draft.enqueue({ type: 'move', objectId: entered.id, to: 'graveyard' })
    if (enteredSpec.gainLife) {
      draft.players[entered.controller].life += enteredSpec.gainLife
      draft.note(`${entered.controller} gains ${enteredSpec.gainLife} life (${entered.name})`)
    }
  }
  openSearch(draft, entered.controller, {
    source: entered.name,
    sourceId: entered.id,
    via: 'enters',
  })
}

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
    if (spec.sacrificeOnResolve) {
      if (hasPendingDialog(state, item.controller, 'sacrifice-lands')) return null
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
      if (dialog?.kind === 'sacrifice-lands') {
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
      if (dialog?.kind === 'may-search') {
        const entered = draft.object(dialog.sourceId)
        const enteredSpec = entered ? entersSpec(entered) : undefined
        clearPendingDialog(draft, event.seat)
        if (!entered || !enteredSpec || event.payload?.accepted !== true) {
          draft.players[event.seat].data[SEARCH_DEFERRED] = true
          draft.note(`${entered?.name ?? dialog.source}: no search`)
          return
        }
        openSearch(draft, entered.controller, {
          source: entered.name,
          sourceId: entered.id,
          via: 'enters',
        })
        return
      }
    }
    if (event.type === 'custom' && event.name === SEARCH_BEGIN && event.seat) {
      const source = String(event.payload?.source ?? '')
      const sourceId = String(event.payload?.sourceId ?? '')
      const via = String(event.payload?.via) === 'ability'
        ? 'ability'
        : String(event.payload?.via) === 'enters'
          ? 'enters'
          : String(event.payload?.via) === 'resolve'
            ? 'resolve'
            : 'spell'
      const payloadSpec = resolvePayloadSpec(event.payload?.spec)
      if (via === 'resolve') {
        if (!payloadSpec) return
        storeInlineSpec(draft, event.seat, sourceId, payloadSpec)
      } else if (!searchSpecFor(source)) {
        return
      }
      openSearch(draft, event.seat, {
        source,
        sourceId,
        via,
        ...(event.payload?.kicked === true ? { kicked: true } : {}),
        ...(typeof event.payload?.max === 'number' ? { max: event.payload.max } : {}),
      })
      return
    }

    if (event.type === 'custom' && event.name === SEARCH_CHOSEN && event.seat) {
      const pending = pendingSearch(state, event.seat)
      closeSearch(draft, event.seat)
      if (pending?.via === 'spell') draft.players[event.seat].data[SEARCH_DONE] = true
      if (pending?.sourceId) delete draft.players[event.seat].data[inlineSpecKey(pending.sourceId)]
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
      beginEnterSearch(draft, entered, enteredSpec)
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
