import { syncRevealedLibraryTop } from './cardPlugins/libraryTopKnowledge'
import { createCatalog } from './catalog'
import type { GameFormat } from './formats'
import { freezeDraft, makeDraft } from './draft'
import { rules } from './kernel'
import { newGame, type NewGameOptions } from './newGame'
import { isKnownTo, revealedLibraryTop } from './knowledge'
import {
  createAuthoritativeHiddenInformation,
  initializeRandomState,
  RANDOM_STATE,
  replicaSnapshotError,
  replicaHiddenInformation,
} from './plugins/hiddenInformation'
import type { GameEvent, GameState, PlayerId, Plugin } from './types'
import { redactSecretCouncil } from './cardPlugins/secretCouncil'
import { pendingSelectionsFor } from './rules/selectCards'

export type ServerDependencies = {
  random: () => number
  cardPlugins?: Plugin[]
}

const createRuntimeEngine = (
  format: GameFormat,
  hiddenInformation: ReturnType<typeof createAuthoritativeHiddenInformation>,
  runtimeCardPlugins: Plugin[] = [],
) => {
  const catalog = createCatalog([...format.plugins, ...runtimeCardPlugins, hiddenInformation])
  return {
    catalog,
    rules: (state: GameState, event: GameEvent) =>
      rules(state, event, catalog),
    addPlugin: catalog.register,
  }
}

export const projectForViewer = (
  authoritative: GameState,
  viewer: PlayerId | null,
): GameState => {
  if (authoritative.knowledge.mode !== 'authoritative') {
    throw new Error('only authoritative state can be projected')
  }
  if (viewer !== null && !authoritative.players[viewer]) {
    throw new Error(`viewer ${viewer} is not in the game`)
  }

  const projected = structuredClone(authoritative)
  projected.knowledge = { mode: 'replica', viewer }

  const revealedTops = Object.fromEntries(
    projected.playerOrder.flatMap((player) => {
      const top = revealedLibraryTop(projected, player, viewer)
      return top ? [[player, top.name] as const] : []
    }),
  )

  const visibleLibraryCards = new Set<string>()
  if (viewer) {
    for (const selection of pendingSelectionsFor(authoritative, viewer)) {
      if (selection.kind === 'scry' || selection.kind === 'surveil') {
        for (const objectId of selection.candidates) visibleLibraryCards.add(objectId)
      }
    }
  }

  for (const [objectId, object] of Object.entries(projected.objects)) {
    const hiddenLibrary = object.zone === 'library' && !visibleLibraryCards.has(objectId)
    const hiddenHand = object.zone === 'hand'
      && object.owner !== viewer
      && !isKnownTo(object, viewer, projected.playerOrder)
    if (hiddenLibrary || hiddenHand) delete projected.objects[objectId]
  }

  for (const player of projected.playerOrder) {
    projected.zoneOrder[player].library = []
    if (player !== viewer) {
      projected.zoneOrder[player].hand = projected.zoneOrder[player].hand.filter(
        (id) => {
          const object = projected.objects[id]
          return object && isKnownTo(object, viewer, projected.playerOrder)
        },
      )
    }
    delete projected.players[player].data[RANDOM_STATE]
    const topName = revealedTops[player]
    if (topName) projected.players[player].data.revealed_top = [topName]
    else delete projected.players[player].data.revealed_top
  }
  redactSecretCouncil(projected.players, viewer)

  return projected
}

export const createServerGame = (
  format: GameFormat,
  options?: NewGameOptions,
  dependencies: ServerDependencies = { random: Math.random },
) => {
  const engine = createRuntimeEngine(
    format,
    createAuthoritativeHiddenInformation(dependencies.random),
    dependencies.cardPlugins,
  )
  const runtimeCardPlugins = dependencies.cardPlugins ?? []
  const initialState = newGame(format, {
    ...options,
    builtinRules: options?.builtinRules ?? [
      ...format.rules,
      ...runtimeCardPlugins.map((plugin) => plugin.id),
    ],
  })
  initializeRandomState(initialState, dependencies.random)
  const boot = makeDraft(initialState)
  syncRevealedLibraryTop(boot)
  const state = freezeDraft(boot)
  return {
    ...engine,
    state,
    project: (state: GameState, viewer: PlayerId | null) =>
      projectForViewer(state, viewer),
  }
}

export const createClientGame = (format: GameFormat, snapshot: GameState) => {
  const redactionError = replicaSnapshotError(snapshot)
  if (redactionError) throw new Error(redactionError)
  const engine = createRuntimeEngine(format, replicaHiddenInformation)
  return {
    ...engine,
    state: structuredClone(snapshot),
    sync: (state: GameState, next: GameState) =>
      engine.rules(state, { type: 'authoritativeSync', snapshot: next }),
  }
}
