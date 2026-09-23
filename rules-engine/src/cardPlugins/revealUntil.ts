import type Draft from '../draft'
import type { GameObject, PlayerId } from '../types'
import type { RevealUntilNonMatch, TargetFilter } from './effectDefinitions'
import { validTarget } from './targetedResolve'

export type RevealUntilParams = {
  count: number | 'opponentCount'
  match: TargetFilter
  destination: 'hand' | 'battlefield'
  nonMatch: RevealUntilNonMatch
}

const resolveCount = (draft: Draft, controller: PlayerId, count: number | 'opponentCount') => {
  if (count !== 'opponentCount') return count
  return draft.playerOrder.filter((seat) =>
    seat !== controller && !draft.players[seat]?.lost).length
}

const libraryMatches = (
  draft: Draft,
  objectId: string,
  controller: PlayerId,
  match: TargetFilter,
) => {
  const object = draft.object(objectId)
  return Boolean(object && validTarget(draft, object, match, controller))
}

export const runRevealUntil = (
  draft: Draft,
  source: GameObject,
  params: RevealUntilParams,
) => {
  const controller = source.controller
  const needed = resolveCount(draft, controller, params.count)
  const library = draft.zoneOrder[controller].library
  const revealed: string[] = []
  let matchCount = 0

  for (const objectId of library) {
    revealed.push(objectId)
    if (libraryMatches(draft, objectId, controller, params.match)) {
      matchCount += 1
      if (matchCount >= needed) break
    }
  }

  if (revealed.length === 0) return

  draft.enqueue({
    type: 'reveal',
    seat: controller,
    objectIds: revealed,
    source: source.name,
  })

  for (const objectId of revealed) {
    const object = draft.object(objectId)
    if (!object) continue
    if (libraryMatches(draft, objectId, controller, params.match)) {
      draft.enqueue({ type: 'move', objectId, to: params.destination })
      continue
    }
    if (params.nonMatch === 'mill') {
      draft.enqueue({ type: 'move', objectId, to: 'graveyard' })
    } else {
      draft.enqueue({ type: 'move', objectId, to: 'library', position: 'bottom' })
    }
  }

  if (params.nonMatch === 'shuffle') {
    draft.enqueue({ type: 'shuffleLibrary', seat: controller })
  }
}
