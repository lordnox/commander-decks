import type { GameEvent, Plugin } from '../types'
import { enteringObjectId } from './entersTapped'
import { syncRevealedLibraryTop } from './libraryTopKnowledge'

const shouldSync = (event: GameEvent) =>
  event.type === 'shuffleLibrary'
  || event.type === 'draw'
  || event.type === 'move'
  || Boolean(enteringObjectId(event))

export const courserOfKruphix: Plugin = {
  id: 'courserOfKruphix',
  apply: ({ event, draft }) => {
    if (!shouldSync(event)) return
    syncRevealedLibraryTop(draft)
  },
}
