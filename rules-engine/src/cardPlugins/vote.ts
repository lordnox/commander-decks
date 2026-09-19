import type { GameObject, GameState, PlayerId, Plugin } from '../types'
import type Draft from '../draft'
import { effectsOf } from './cardRules'
import { CHOOSE_VOTES } from './secretCouncil'
import { validTarget } from './targetedResolve'

export const PENDING_VOTE = 'kernel.pendingVote'

type VoteEffect = Extract<ReturnType<typeof effectsOf>[number], { op: 'vote' }>

export type PendingVote = {
  sourceId: string
  source: string
  owner: PlayerId
  voters: PlayerId[]
  votes: Record<PlayerId, string>
  effect: VoteEffect
}

const isPendingVote = (value: unknown): value is PendingVote =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingVote).sourceId === 'string'
  && Array.isArray((value as PendingVote).voters)
  && Boolean((value as PendingVote).effect)

export const pendingVote = (state: GameState | Draft) => {
  for (const seat of state.playerOrder) {
    const value = state.players[seat].data[PENDING_VOTE]
    if (isPendingVote(value)) return value
  }
}

export const currentVoter = (pending: PendingVote) =>
  pending.voters.find((seat) => pending.votes[seat] === undefined)

export const votingSeat = (state: GameState | Draft, pending: PendingVote) =>
  state.playerOrder.find((seat) =>
    !state.players[seat].lost && state.players[seat].data[CHOOSE_VOTES] === true)
  ?? currentVoter(pending)

export const voteCandidates = (
  state: GameState | Draft,
  pending: PendingVote,
  seat = currentVoter(pending),
) => {
  if (!seat) return []
  return Object.values(state.objects).filter((object): object is GameObject =>
    validTarget(state as GameState, object, pending.effect.filter, seat))
}

const orderedFrom = (state: GameState, start: PlayerId) => {
  const living = state.playerOrder.filter((seat) => !state.players[seat].lost)
  const index = Math.max(0, living.indexOf(start))
  return [...living.slice(index), ...living.slice(0, index)]
}

const finishVote = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  pending: PendingVote,
) => {
  const tallies = new Map<string, number>()
  for (const objectId of Object.values(pending.votes)) {
    if (!objectId) continue
    tallies.set(objectId, (tallies.get(objectId) ?? 0) + 1)
  }
  const most = Math.max(0, ...tallies.values())
  if (pending.effect.outcome === 'exile-most' && most > 0) {
    for (const [objectId, count] of tallies) {
      if (count === most && draft.objects[objectId]?.zone === 'battlefield') {
        draft.enqueue({ type: 'move', objectId, to: 'exile' })
      }
    }
  }
  delete draft.players[pending.owner].data[PENDING_VOTE]
  draft.note(`${pending.source} resolves its vote`)
}

const skipUnableVoters = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  pending: PendingVote,
) => {
  let seat = currentVoter(pending)
  while (seat && voteCandidates(draft, pending, seat).length === 0) {
    pending.votes[seat] = ''
    seat = currentVoter(pending)
  }
  if (!seat) finishVote(draft, pending)
  else draft.priority = seat
}

export const vote: Plugin = {
  id: 'vote',
  legal: ({ state, event }) => {
    const pending = pendingVote(state)
    if (event.type === 'passPriority' && pending) {
      return `${votingSeat(state, pending) ?? pending.owner} is voting for ${pending.source}`
    }
    if (event.type !== 'vote') return
    if (!pending) return 'no vote is open'
    const voter = currentVoter(pending)
    if (
      votingSeat(state, pending) !== event.seat
      || pending.sourceId !== event.sourceId
      || event.choice.kind !== 'object'
    ) {
      return 'that vote is not open'
    }
    const objectId = event.choice.objectId
    if (!voter || !voteCandidates(state, pending, voter).some(
      (object) => object.id === objectId,
    )) {
      return 'illegal vote'
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'concede') {
      const pending = pendingVote(draft)
      if (pending && currentVoter(pending) === event.seat) {
        pending.votes[event.seat] = ''
        skipUnableVoters(draft, pending)
      }
      return
    }
    if (event.type === 'resolveTop') {
      const item = state.stack[0]
      const source = item ? state.objects[item.objectId] : undefined
      const effect = source
        ? effectsOf(source).find((candidate): candidate is VoteEffect => candidate.op === 'vote')
        : undefined
      if (!item || !source || !effect) return
      const pending: PendingVote = {
        sourceId: source.id,
        source: source.name,
        owner: item.controller,
        voters: orderedFrom(state, item.controller),
        votes: {},
        effect,
      }
      draft.players[item.controller].data[PENDING_VOTE] = pending
      skipUnableVoters(draft, pending)
      return
    }
    if (event.type !== 'vote') return
    const pending = pendingVote(draft)
    if (!pending || event.choice.kind !== 'object') return
    const voter = currentVoter(pending)
    if (!voter) return
    pending.votes[voter] = event.choice.objectId
    draft.players[pending.owner].data[PENDING_VOTE] = pending
    skipUnableVoters(draft, pending)
  },
}
