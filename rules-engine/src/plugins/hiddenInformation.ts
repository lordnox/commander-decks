import type Draft from '../draft'
import { isKnownTo, markKnownToAll } from '../knowledge'
import { visibleLibrarySelectionIds } from '../rules/selectCards'
import { isHiddenForetold } from './foretell'
import type { GameObject, GameState, PlayerId, Plugin } from '../types'

export const HIDDEN_INFORMATION_ID = 'hiddenInformation'
export const RANDOM_CHOICE = 'hiddenInformation.randomChoice'
export const RANDOM_STATE = 'hiddenInformation.randomState'

type RandomChoicePayload = {
  choices: string[]
  resultName: string
  context?: Record<string, unknown>
}

const randomChoicePayload = (value: unknown): RandomChoicePayload | undefined => {
  if (!value || typeof value !== 'object') return
  const payload = value as Partial<RandomChoicePayload>
  if (
    !Array.isArray(payload.choices)
    || payload.choices.length === 0
    || !payload.choices.every((choice) => typeof choice === 'string')
    || typeof payload.resultName !== 'string'
    || payload.resultName.length === 0
    || (payload.context !== undefined && (
      !payload.context
      || typeof payload.context !== 'object'
      || Array.isArray(payload.context)
    ))
  ) {
    return
  }
  return payload as RandomChoicePayload
}

export const initializeRandomState = (
  state: GameState,
  random: () => number,
) => {
  const owner = state.playerOrder[0]
  const sample = Math.max(0, Math.min(0.9999999999999999, random()))
  state.players[owner].data[RANDOM_STATE] = Math.floor(sample * 0x100000000)
}

const nextStateRandom = (draft: Draft) => {
  const owner = draft.playerOrder[0]
  const current = draft.players[owner].data[RANDOM_STATE]
  const seed = typeof current === 'number' && Number.isSafeInteger(current)
    ? current >>> 0
    : 0x6d2b79f5
  const next = (Math.imul(1664525, seed) + 1013904223) >>> 0
  draft.players[owner].data[RANDOM_STATE] = next
  return next / 0x100000000
}

/** Pick up to `count` distinct entries from `choices` using the authoritative PRNG. */
export const pickRandomChoices = (draft: Draft, choices: string[], count: number) => {
  const pool = [...choices]
  const picked: string[] = []
  const take = Math.min(count, pool.length)
  for (let i = 0; i < take; i += 1) {
    const index = Math.floor(nextStateRandom(draft) * pool.length)
    picked.push(pool.splice(index, 1)[0])
  }
  return picked
}

const hiddenEvent = (type: string) =>
  type === 'shuffleLibrary'
  || type === 'reveal'
  || type === 'authoritativeSync'

const hiddenHandIds = (
  snapshot: GameState,
  owner: PlayerId,
  viewer: PlayerId | null,
) =>
  snapshot.zoneOrder[owner].hand.filter((id) => {
    const object = snapshot.objects[id]
    return object && isKnownTo(object, viewer, snapshot.playerOrder)
  })

export const replicaSnapshotError = (snapshot: import('../types').GameState) => {
  if (snapshot.knowledge.mode !== 'replica') return 'client snapshots must be replicas'
  const viewer = snapshot.knowledge.viewer
  const visibleLibrary = visibleLibrarySelectionIds(snapshot, viewer)
  for (const object of Object.values(snapshot.objects)) {
    if (object.zone === 'library' && !visibleLibrary.has(object.id)) {
      return 'client snapshot exposes a library object'
    }
    if (object.faceDown && !isKnownTo(object, viewer, snapshot.playerOrder)) {
      return 'client snapshot exposes a face-down object'
    }
    if (
      object.zone === 'hand'
      && object.owner !== viewer
      && !isKnownTo(object, viewer, snapshot.playerOrder)
    ) {
      return 'client snapshot exposes another player’s hand'
    }
    if (isHiddenForetold(object, viewer, snapshot.playerOrder)) {
      return 'client snapshot exposes a face-down foretold card'
    }
  }
  for (const player of snapshot.playerOrder) {
    if (snapshot.zoneOrder[player].library.length > 0) {
      return 'client snapshot exposes library order'
    }
    if (player !== viewer) {
      const visible = hiddenHandIds(snapshot, player, viewer)
      const order = snapshot.zoneOrder[player].hand
      if (order.length > visible.length) {
        return 'client snapshot exposes another player’s hand order'
      }
      if (order.some((id) => !visible.includes(id))) {
        return 'client snapshot exposes another player’s hand order'
      }
    }
  }
  return undefined
}

const redactObject = (
  draft: import('../draft').Draft,
  objectId: string,
  object: GameObject,
) => {
  const viewer = draft.knowledge.viewer
  const hiddenLibrary = object.zone === 'library'
    && !visibleLibrarySelectionIds(draft, viewer).has(objectId)
  const hiddenHand = object.zone === 'hand'
    && object.owner !== viewer
    && !isKnownTo(object, viewer, draft.playerOrder)
  const hiddenForetold = isHiddenForetold(object, viewer, draft.playerOrder)
  const hiddenFaceDown = object.faceDown
    && !isKnownTo(object, viewer, draft.playerOrder)
  if (hiddenLibrary || hiddenHand || hiddenForetold || hiddenFaceDown) {
    delete draft.objects[objectId]
  }
}

const redactDraft = (draft: import('../draft').Draft) => {
  const viewer = draft.knowledge.viewer
  for (const [objectId, object] of Object.entries(draft.objects)) {
    redactObject(draft, objectId, object)
  }
  for (const player of draft.playerOrder) {
    draft.zoneOrder[player].library = []
    draft.zoneOrder[player].exile = draft.zoneOrder[player].exile.filter((id) => {
      const object = draft.objects[id]
      return object && !isHiddenForetold(object, viewer, draft.playerOrder)
    })
    if (player !== viewer) {
      draft.zoneOrder[player].hand = hiddenHandIds(draft, player, viewer)
    }
  }
}

export const unconfiguredHiddenInformation: Plugin = {
  id: HIDDEN_INFORMATION_ID,
  legal: ({ event }) => {
    if (event.type === 'custom' && event.name === RANDOM_CHOICE) {
      return 'random choices require an authoritative runtime'
    }
    if (hiddenEvent(event.type)) return 'hidden information requires a runtime profile'
  },
}

export const createAuthoritativeHiddenInformation = (
  random: () => number,
): Plugin => ({
  id: HIDDEN_INFORMATION_ID,
  legal: ({ state, event }) => {
    if (event.type === 'authoritativeSync') return 'the server cannot ingest replica state'
    if (event.type === 'custom' && event.name === RANDOM_CHOICE) {
      if (!event.seat || !state.players[event.seat]) return 'random choice needs a valid seat'
      if (!randomChoicePayload(event.payload)) return 'random choice payload is invalid'
      return
    }
    if (event.type !== 'shuffleLibrary' && event.type !== 'reveal') {
      return
    }
    if (!state.players[event.seat]) return 'player is not in the game'
    if (event.type === 'reveal') {
      if (event.objectIds.length === 0) return 'reveal needs at least one card'
      const unknown = event.objectIds.find((id) => !state.objects[id])
      if (unknown) return `cannot reveal unknown object ${unknown}`
      const foreign = event.objectIds.find(
        (id) => state.objects[id].owner !== event.seat,
      )
      if (foreign) {
        return `${event.seat} does not own ${state.objects[foreign].name}`
      }
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'custom' && event.name === RANDOM_CHOICE) {
      const payload = randomChoicePayload(event.payload)
      if (!payload || !event.seat) return
      const index = Math.min(
        payload.choices.length - 1,
        Math.floor(nextStateRandom(draft) * payload.choices.length),
      )
      draft.enqueue({
        type: 'custom',
        name: payload.resultName,
        seat: event.seat,
        payload: {
          ...payload.context,
          selected: payload.choices[index],
        },
      })
      return
    }

    if (event.type === 'reveal') {
      markKnownToAll(draft, event.objectIds)
      const names = event.objectIds
        .map((id) => state.objects[id]?.name)
        .filter(Boolean)
        .join(', ')
      draft.note(
        `${event.seat} reveals ${names}${event.source ? ` for ${event.source}` : ''}`,
      )
      return
    }

    if (event.type === 'shuffleLibrary') {
      const library = [...draft.zoneOrder[event.seat].library]
      for (let index = library.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1))
        const held = library[index]
        library[index] = library[swap]
        library[swap] = held
      }
      draft.zoneOrder[event.seat].library = library
      draft.note(`${event.seat} shuffles`)
      return
    }

  },
})

export const replicaHiddenInformation: Plugin = {
  id: HIDDEN_INFORMATION_ID,
  legal: ({ state, event }) => {
    if (event.type === 'custom' && event.name === RANDOM_CHOICE) {
      return 'replicas cannot resolve random choices'
    }
    if (event.type !== 'authoritativeSync') return
    const redactionError = replicaSnapshotError(event.snapshot)
    if (redactionError) return redactionError
    if (event.snapshot.knowledge.viewer !== state.knowledge.viewer) {
      return 'snapshot belongs to another viewer'
    }
  },
  apply: ({ event, draft }) => {
    if (event.type === 'authoritativeSync') {
      const snapshot = structuredClone(event.snapshot)
      draft.format = snapshot.format
      draft.knowledge = snapshot.knowledge
      draft.playerOrder = snapshot.playerOrder
      draft.castableZones = snapshot.castableZones
      draft.players = snapshot.players
      draft.objects = snapshot.objects
      draft.zoneOrder = snapshot.zoneOrder
      draft.zoneCounts = snapshot.zoneCounts
      draft.stack = snapshot.stack
      draft.delayedTriggers = snapshot.delayedTriggers
      draft.active = snapshot.active
      draft.priority = snapshot.priority
      draft.turn = snapshot.turn
      draft.step = snapshot.step
      draft.passedInRow = snapshot.passedInRow
      draft.rules = snapshot.rules
      draft.nextId = snapshot.nextId
      draft.nextTimestamp = snapshot.nextTimestamp
      draft.ended = snapshot.ended
      draft.prevented = snapshot.prevented
      draft.log = snapshot.log
    }
    redactDraft(draft)
  },
}
