import type { Plugin } from '../types'

export const HIDDEN_INFORMATION_ID = 'hiddenInformation'

const hiddenEvent = (type: string) =>
  type === 'draw' || type === 'shuffleLibrary' || type === 'authoritativeSync'

export const replicaSnapshotError = (snapshot: import('../types').GameState) => {
  if (snapshot.knowledge.mode !== 'replica') return 'client snapshots must be replicas'
  const viewer = snapshot.knowledge.viewer
  for (const object of Object.values(snapshot.objects)) {
    if (object.zone === 'library') return 'client snapshot exposes a library object'
    if (object.zone === 'hand' && object.owner !== viewer) {
      return 'client snapshot exposes another player’s hand'
    }
  }
  for (const player of snapshot.playerOrder) {
    if (snapshot.zoneOrder[player].library.length > 0) {
      return 'client snapshot exposes library order'
    }
    if (player !== viewer && snapshot.zoneOrder[player].hand.length > 0) {
      return 'client snapshot exposes another player’s hand order'
    }
  }
  return undefined
}

const redactDraft = (draft: import('../draft').Draft) => {
  const viewer = draft.knowledge.viewer
  for (const [objectId, object] of Object.entries(draft.objects)) {
    if (object.zone === 'library' || (object.zone === 'hand' && object.owner !== viewer)) {
      delete draft.objects[objectId]
    }
  }
  for (const player of draft.playerOrder) {
    draft.zoneOrder[player].library = []
    if (player !== viewer) draft.zoneOrder[player].hand = []
  }
}

export const unconfiguredHiddenInformation: Plugin = {
  id: HIDDEN_INFORMATION_ID,
  legal: ({ event }) => {
    if (hiddenEvent(event.type)) return 'hidden information requires a runtime profile'
  },
}

export const createAuthoritativeHiddenInformation = (
  random: () => number,
): Plugin => ({
  id: HIDDEN_INFORMATION_ID,
  legal: ({ state, event }) => {
    if (event.type === 'authoritativeSync') return 'the server cannot ingest replica state'
    if (event.type !== 'draw' && event.type !== 'shuffleLibrary') return
    if (!state.players[event.seat]) return 'player is not in the game'
    if (event.type === 'draw') {
      const count = event.count ?? 1
      if (!Number.isInteger(count) || count < 1) return 'draw count must be a positive integer'
    }
  },
  apply: ({ event, draft }) => {
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

    if (event.type === 'draw') {
      const count = event.count ?? 1
      for (let index = 0; index < count; index += 1) {
        const objectId = draft.zoneOrder[event.seat].library[0]
        if (!objectId) {
          draft.players[event.seat].lost = true
          draft.note(`${event.seat} draws from an empty library`)
          return
        }
        const object = draft.move(objectId, 'hand')
        if (object) draft.note(`${event.seat} draws a card`)
      }
    }
  },
})

export const replicaHiddenInformation: Plugin = {
  id: HIDDEN_INFORMATION_ID,
  legal: ({ state, event }) => {
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
