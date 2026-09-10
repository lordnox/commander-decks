import { cardPlugins } from './cardPlugins'
import { createCatalog } from './catalog'
import type { GameFormat } from './formats'
import { rules } from './kernel'
import { newGame, type NewGameOptions } from './newGame'
import {
  createAuthoritativeHiddenInformation,
  replicaSnapshotError,
  replicaHiddenInformation,
} from './plugins/hiddenInformation'
import type { GameEvent, GameState, PlayerId, Plugin } from './types'

export type ServerDependencies = {
  random: () => number
  cardPlugins?: Plugin[]
}

const createRuntimeEngine = (
  format: GameFormat,
  hiddenInformation: ReturnType<typeof createAuthoritativeHiddenInformation>,
  runtimeCardPlugins = cardPlugins,
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

  for (const [objectId, object] of Object.entries(projected.objects)) {
    const hiddenLibrary = object.zone === 'library'
    const hiddenHand = object.zone === 'hand' && object.owner !== viewer
    if (hiddenLibrary || hiddenHand) delete projected.objects[objectId]
  }

  for (const player of projected.playerOrder) {
    projected.zoneOrder[player].library = []
    if (player !== viewer) projected.zoneOrder[player].hand = []
  }

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
  const runtimeCardPlugins = dependencies.cardPlugins ?? cardPlugins
  return {
    ...engine,
    state: newGame(format, {
      ...options,
      builtinRules: options?.builtinRules ?? [
        ...format.rules,
        ...runtimeCardPlugins.map((plugin) => plugin.id),
      ],
    }),
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
