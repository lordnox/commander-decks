import { isSameObject, objectIdentity } from '../objectIdentity'
import type Draft from '../draft'
import type { GameObject, GameState, LinkedExileSet, ObjectIdentity, PlayerId } from '../types'

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
    && entry.untilSourceLeaves === link.untilSourceLeaves && entry.returnTo === link.returnTo
    && entry.untilOpponentMonarch?.player === link.untilOpponentMonarch?.player
    && entry.untilOpponentMonarch?.since === link.untilOpponentMonarch?.since)
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

const releaseSets = (draft: Draft, matching: LinkedExileSet[], returnTo?: 'battlefield' | 'hand', onlyUntilLeaves = false) => {
  if (!matching.length) return
  draft.linkedExileSets = draft.linkedExileSets!.filter(set => !matching.includes(set))
  const holder = draft.objects[matching[0].source.objectId]
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


export const releaseCanonicalLinkedExile = (
  draft: Draft,
  source: ObjectIdentity,
  returnTo?: 'battlefield' | 'hand',
  onlyUntilLeaves = false,
) => releaseSets(draft, (draft.linkedExileSets ?? []).filter(set => sameSource(set.source, source)
  && (!onlyUntilLeaves || set.untilSourceLeaves)), returnTo, onlyUntilLeaves)

const opponentOf = (state: Pick<GameState, 'opponents'>, seat: PlayerId, of: PlayerId) =>
  state.opponents?.[of]?.includes(seat) ?? seat !== of

export const opponentBecameMonarchSince = (state: GameState, duration: { player: PlayerId; since: number }) =>
  Object.entries(state.monarchAcquiredAt ?? {}).some(([seat, revision]) =>
    revision > duration.since && opponentOf(state, seat, duration.player))

export const releaseOpponentMonarchExile = (draft: Draft, monarch: PlayerId) => {
  const sets = (draft.linkedExileSets ?? []).filter(set =>
    set.untilOpponentMonarch && opponentOf(draft, monarch, set.untilOpponentMonarch.player))
  // Each set has its own source; releasing separately also maintains legacy inspector fields.
  for (const set of sets) releaseSets(draft, [set])
}
