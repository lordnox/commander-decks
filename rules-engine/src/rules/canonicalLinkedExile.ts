import { isSameObject, objectIdentity } from '../objectIdentity'
import type Draft from '../draft'
import type { GameObject, GameState, LinkedExileSet, ObjectIdentity } from '../types'

const sameSource = (left: ObjectIdentity, right: ObjectIdentity) =>
  left.objectId === right.objectId && left.incarnation === right.incarnation && left.zone === right.zone

export const linkedExileCards = (state: Pick<GameState, 'objects' | 'linkedExileSets'>, source: GameObject) => {
  const ref = objectIdentity(source)
  return (state.linkedExileSets ?? [])
    .filter(set => sameSource(set.source, ref))
    .flatMap(set => set.cards)
    .flatMap(card => {
      const current = state.objects[card.objectId]
      return current?.zone === 'exile' && isSameObject(current, card) ? [current] : []
    })
}

/** Called after the final move commits, so redirects/prevention never create false links. */
export const commitExileLink = (draft: Draft, link: Omit<LinkedExileSet, 'cards'>, card: GameObject) => {
  const sets = draft.linkedExileSets ??= []
  let set = sets.find(entry => sameSource(entry.source, link.source)
    && entry.untilSourceLeaves === link.untilSourceLeaves && entry.returnTo === link.returnTo)
  if (!set) {
    set = { ...structuredClone(link), cards: [] }
    sets.push(set)
  }
  const ref = objectIdentity(card)
  if (!set.cards.some(entry => sameSource(entry, ref))) set.cards.push(ref)
  // Keep legacy inspectors compatible; canonical readers always use pinned identities.
  card.exiledWith = link.source.objectId
  const source = draft.objects[link.source.objectId]
  if (source) {
    source.exiledCards = [...new Set([...(source.exiledCards ?? []), card.id])]
    if (link.untilSourceLeaves) source.returnLinkedExile = link.returnTo ?? 'battlefield'
  }
}

export const releaseCanonicalLinkedExile = (
  draft: Draft,
  source: ObjectIdentity,
  returnTo?: 'battlefield' | 'hand',
  onlyUntilLeaves = false,
) => {
  const matching = (draft.linkedExileSets ?? []).filter(set => sameSource(set.source, source)
    && (!onlyUntilLeaves || set.untilSourceLeaves))
  if (!matching.length) return
  draft.linkedExileSets = draft.linkedExileSets!.filter(set => !matching.includes(set))
  const holder = draft.objects[source.objectId]
  const ids = new Set(matching.flatMap(set => set.cards.map(card => card.objectId)))
  if (holder) {
    holder.exiledCards = (holder.exiledCards ?? []).filter(id => !ids.has(id))
    if (onlyUntilLeaves) delete holder.returnLinkedExile
  }
  for (const set of matching) {
    for (const ref of set.cards) {
      const card = draft.objects[ref.objectId]
      if (!isSameObject(card, ref) || card.zone !== 'exile') continue
      delete card.exiledWith
      const to = returnTo ?? set.returnTo ?? 'battlefield'
      draft.enqueue({ type: 'move', objectId: card.id, to, ...(to === 'battlefield' ? { controller: card.owner } : {}) })
    }
  }
}
