import { syncRevealedLibraryTop } from './cardPlugins/libraryTopKnowledge'
import { createCatalog } from './catalog'
import type { GameFormat } from './formats'
import { freezeDraft, makeDraft } from './draft'
import { rules } from './kernel'
import { newGame, type NewGameOptions } from './newGame'
import { isKnownTo, revealedLibraryTop } from './knowledge'
import { isHiddenForetold } from './plugins/foretell'
import {
  createAuthoritativeHiddenInformation,
  initializeRandomState,
  RANDOM_STATE,
  replicaSnapshotError,
  replicaHiddenInformation,
} from './plugins/hiddenInformation'
import type { GameEvent, GameState, PlayerId, Plugin } from './types'
import { redactSecretCouncil } from './cardPlugins/secretCouncil'
import { CUMULATIVE_UPKEEP_PENDING } from './cardPlugins/cumulativeUpkeep'
import { PENDING_SELECTION, pendingSelectionsFor } from './rules/selectCards'
import { PENDING_PLAYER_SELECTION } from './rules/selectPlayers'
import { PENDING_DIALOG, pendingDialogsFor } from './pendingDialog'
import { PENDING_OPTION_SELECTION } from './rules/selectOptions'

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
      for (const objectId of selection.candidates) {
        const object = authoritative.objects[objectId]
        if (object?.zone !== 'library') continue
        if (
          selection.kind === 'choosePile'
          && !isKnownTo(object, viewer, authoritative.playerOrder)
        ) {
          continue
        }
        visibleLibraryCards.add(objectId)
      }
    }
  }
  for (const [objectId, object] of Object.entries(projected.objects)) {
    const hiddenLibrary = object.zone === 'library' && !visibleLibraryCards.has(objectId)
    const hiddenHand = object.zone === 'hand'
      && object.owner !== viewer
      && !isKnownTo(object, viewer, projected.playerOrder)
    const hiddenForetold = isHiddenForetold(object, viewer, projected.playerOrder)
    const hiddenFaceDown = object.faceDown
      && !isKnownTo(object, viewer, projected.playerOrder)
    if (hiddenLibrary || hiddenHand || hiddenForetold || hiddenFaceDown) {
      delete projected.objects[objectId]
    }
  }

  for (const player of projected.playerOrder) {
    projected.zoneOrder[player].library = []
    projected.zoneOrder[player].exile = projected.zoneOrder[player].exile.filter(
      (id) => {
        const object = projected.objects[id]
        return object && !isHiddenForetold(object, viewer, projected.playerOrder)
      },
    )
    if (player !== viewer) {
      projected.zoneOrder[player].hand = projected.zoneOrder[player].hand.filter(
        (id) => {
          const object = projected.objects[id]
          return object && isKnownTo(object, viewer, projected.playerOrder)
        },
      )
    }
    delete projected.players[player].data[RANDOM_STATE]
    if (player !== viewer) {
      delete projected.players[player].data[PENDING_SELECTION]
      delete projected.players[player].data[PENDING_PLAYER_SELECTION]
      delete projected.players[player].data[PENDING_OPTION_SELECTION]
      if (pendingDialogsFor(authoritative, player).length > 0) {
        delete projected.players[player].data[PENDING_DIALOG]
      }
    }
    if (player !== viewer) delete projected.players[player].data[CUMULATIVE_UPKEEP_PENDING]
    const topName = revealedTops[player]
    if (topName) projected.players[player].data.revealed_top = [topName]
    else delete projected.players[player].data.revealed_top
    const knownLibrary = (authoritative.zoneOrder[player]?.library ?? [])
      .map((objectId) => authoritative.objects[objectId])
      .filter((object): object is NonNullable<typeof object> =>
        Boolean(object) && isKnownTo(object, viewer, authoritative.playerOrder))
      .map((object) => object.name)
    if (knownLibrary.length > 0) {
      projected.players[player].data.revealed_library = knownLibrary
    } else {
      delete projected.players[player].data.revealed_library
    }
  }
  for (const player of projected.playerOrder) {
    for (const zone of Object.keys(projected.zoneOrder[player])) {
      if (zone === 'library') continue
      projected.zoneOrder[player][zone as keyof typeof projected.zoneOrder[typeof player]] =
        projected.zoneOrder[player][zone as keyof typeof projected.zoneOrder[typeof player]]
          .filter((id) => Boolean(projected.objects[id]))
    }
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
