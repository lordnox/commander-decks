import { createCatalog } from './catalog'
import type { GameFormat } from './formats'
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

  for (const [objectId, object] of Object.entries(projected.objects)) {
    const hiddenLibrary = object.zone === 'library'
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
  return {
    ...engine,
    state: initialState,
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
