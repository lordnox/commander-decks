import type Draft from '../draft'
import type { GameObject } from '../types'

export type LinkedExileReturn = 'battlefield' | 'hand'

export const linkExileSelected = (
  draft: Draft,
  source: GameObject,
  objectIds: string[],
) => {
  const linked = [...(source.exiledCards ?? [])]
  for (const objectId of objectIds) {
    const card = draft.object(objectId)
    if (!card || card.zone !== 'battlefield') continue
    card.exiledWith = source.id
    linked.push(card.id)
    draft.enqueue({ type: 'move', objectId: card.id, to: 'exile' })
  }
  source.exiledCards = linked
  if (objectIds.length > 0) {
    draft.note(`${source.name} exiles ${objectIds.length} card(s) linked to it`)
  }
}

export const releaseLinkedExile = (
  draft: Draft,
  source: GameObject,
  returnTo: LinkedExileReturn,
) => {
  const ids = source.exiledCards ?? []
  if (ids.length === 0) return
  source.exiledCards = []
  for (const objectId of ids) {
    const card = draft.object(objectId)
    if (!card || card.exiledWith !== source.id) continue
    delete card.exiledWith
    if (returnTo === 'hand') {
      draft.enqueue({ type: 'move', objectId: card.id, to: 'hand' })
      continue
    }
    draft.enqueue({
      type: 'move', objectId: card.id,
      to: 'battlefield',
      controller: card.owner,
    })
  }
  draft.note(`${source.name} releases its linked exiled card(s)`)
}
