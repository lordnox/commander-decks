import type Draft from '../draft'
import { INSTRUCTIONS_RESUME } from '../rules/selectCards'
import {
  openOptionSelection,
  PENDING_OPTION_SELECTION,
  pendingOptionSelection,
} from '../rules/selectOptions'
import { isSameObject, objectIdentity } from '../objectIdentity'
import type { GameObject, GameState, ObjectIdentity, PlayerId, Plugin, StackItem } from '../types'
import type { CardInstruction, VoteOptions } from './effectDefinitions'
import type { InstructionHandler } from './instructionHandlers/types'
import { CHOOSE_VOTES } from './secretCouncil'
import { matchesTargetFilter } from './targetedResolve'
import { tallyVotes } from './voteResult'

export const PENDING_VOTE = 'kernel.pendingVote'

/** Stands in for another seat's vote while a secret vote is still open. */
const HIDDEN_VOTE = '*'

export type VoteOption = { id: string; label: string }

type PendingVote = {
  id: string
  sourceId: string
  source: string
  owner: PlayerId
  prompt: string
  secret: boolean
  options: VoteOption[]
  /** Turn order starting with the controller. */
  voters: PlayerId[]
  /** Option id per voter who has voted. */
  votes: Record<PlayerId, string>
  ballots?: Record<PlayerId, string[]>
  voteCounts?: Record<PlayerId, number>
  deciders?: Record<PlayerId, PlayerId>
  optionObjects?: ObjectIdentity[]
  /** Seat that decides every vote ("you choose how each player votes"). */
  chooser?: PlayerId
  outcome: CardInstruction[]
  item?: StackItem
  canonical?: {
    stackId: string
    bindResult: string
    bindWinners?: string
    bindObjects?: string
  }
}

const isPendingVote = (value: unknown): value is PendingVote =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingVote).id === 'string'
  && Array.isArray((value as PendingVote).voters)
  && Array.isArray((value as PendingVote).options)

export const pendingVote = (state: Pick<GameState, 'playerOrder' | 'players'>) => {
  for (const seat of state.playerOrder) {
    const value = state.players[seat].data[PENDING_VOTE]
    if (isPendingVote(value)) return value
  }
}

const currentVoter = (pending: PendingVote) =>
  pending.voters.find((seat) => (pending.ballots?.[seat]?.length ?? (pending.votes[seat] === undefined ? 0 : 1)) < (pending.voteCounts?.[seat] ?? 1))

const voteOptions = (
  draft: Draft,
  source: GameObject,
  spec: VoteOptions,
): VoteOption[] => {
  if (spec.kind === 'named') return spec.options
  if (spec.kind === 'players') {
    return draft.playerOrder
      .filter((seat) => !draft.players[seat].lost)
      .map((seat) => ({ id: seat, label: seat }))
  }
  const options = Object.values(draft.objects)
    .filter((object) =>
      matchesTargetFilter(draft, object, spec.filter, source.controller, undefined, source.id))
    .map((object) => ({ id: object.id, label: object.name }))
  // The picker answers by label, so two permanents with one name must differ.
  return options.map((option) =>
    options.filter(({ label }) => label === option.label).length > 1
      ? { ...option, label: `${option.label} [${option.id}]` }
      : option)
}

const orderedFrom = (draft: Draft, start: PlayerId) => {
  const living = draft.playerOrder.filter((seat) => !draft.players[seat].lost)
  const index = Math.max(0, living.indexOf(start))
  return [...living.slice(index), ...living.slice(0, index)]
}

const finishVote = (draft: Draft, pending: PendingVote) => {
  delete draft.players[pending.owner].data[PENDING_VOTE]
  const result = tallyVotes(pending.votes, pending.options.map((option) => option.id), pending.ballots)
  const label = (id: string) => pending.options.find((option) => option.id === id)?.label ?? id
  draft.note(`${pending.source} votes: ${
    Object.entries(result.ballots ?? Object.fromEntries(Object.entries(result.votes).map(([seat, option]) => [seat, [option]])))
      .map(([seat, ids]) => `${seat} for ${ids.map(label).join(', ')}`)
      .join(', ') || 'none'
  }`)
  if (pending.canonical && draft.resolution?.kind === 'canonicalSpell'
    && draft.resolution.stackId === pending.canonical.stackId) {
    const frame = draft.resolution
    frame.voteResults = { ...frame.voteResults, [pending.canonical.bindResult]: result }
    const bindObjects = (binding: string, ids: string[]) => {
      frame.choices = { ...frame.choices, [binding]: ids.flatMap(objectId => {
        const object = draft.objects[objectId]
        const pin = pending.optionObjects?.find(candidate => candidate.objectId === objectId)
        return object && (!pin || isSameObject(object, pin)) ? [{ kind: 'object' as const, ...objectIdentity(object) }] : []
      }) }
    }
    if (pending.canonical.bindWinners) bindObjects(pending.canonical.bindWinners, result.winners)
    if (pending.canonical.bindObjects) bindObjects(pending.canonical.bindObjects, Object.keys(result.tallies).filter(id => result.tallies[id]! > 0))
    draft.priority = null
  } else {
    if (pending.outcome.length > 0) {
      const item: StackItem = pending.item ?? {
        id: pending.id,
        kind: 'ability',
        objectId: pending.sourceId,
        controller: pending.owner,
        name: pending.source,
        targets: [],
      }
      draft.enqueue({
        type: 'custom',
        name: INSTRUCTIONS_RESUME,
        payload: {
          sourceId: pending.sourceId,
          remaining: pending.outcome,
          item: { ...item, payload: { ...item.payload, vote: result } },
        },
      })
    }
    draft.priority = draft.active
  }
  draft.enqueue({
    type: 'votesFinished',
    sourceId: pending.sourceId,
    owner: pending.owner,
    result,
  })
}

/** Ask whoever decides the next vote, or reveal the result once all are in. */
const askNextVoter = (draft: Draft, pending: PendingVote) => {
  const voter = currentVoter(pending)
  if (!voter || pending.options.length === 0) {
    finishVote(draft, pending)
    return
  }
  const seat = pending.deciders?.[voter] ?? pending.chooser ?? voter
  openOptionSelection(draft, {
    seat,
    sourceId: pending.sourceId,
    source: pending.source,
    prompt: seat === voter ? pending.prompt : `${pending.prompt} Vote for ${voter}.`,
    options: pending.options,
    action: { kind: 'vote', voteId: pending.id, voter },
  })
}

export const disambiguateVoteOptions = (options: VoteOption[]): VoteOption[] =>
  options.map((option) =>
    options.filter(({ label }) => label === option.label).length > 1
      ? { ...option, label: `${option.label} [${option.id}]` }
      : option)

export const beginVote = (
  draft: Draft,
  args: {
    source: { id: string; name: string; controller: PlayerId }
    item?: StackItem
    prompt: string
    options: VoteOption[]
    secret?: boolean
    outcome?: CardInstruction[]
    canonical?: PendingVote['canonical']
    optionObjects?: ObjectIdentity[]
  },
) => {
  const owner = args.source.controller
  const pending: PendingVote = {
    id: draft.allocId('vote'),
    sourceId: args.source.id,
    source: args.source.name,
    owner,
    prompt: args.prompt,
    secret: args.secret === true,
    options: args.options,
    voters: orderedFrom(draft, owner),
    votes: {},
    outcome: args.outcome ?? [],
    ...(args.item ? { item: args.item } : {}),
    ...(args.canonical ? { canonical: args.canonical } : {}),
    ...(args.optionObjects ? { optionObjects: structuredClone(args.optionObjects) } : {}),
  }
  const chooser = draft.playerOrder.find((seat) =>
    !draft.players[seat].lost && draft.players[seat].data[CHOOSE_VOTES] === true)
  if (chooser) pending.chooser = chooser
  const modifiers = (draft.voteModifiers ?? []).filter(modifier => modifier.expiresTurn === undefined || modifier.expiresTurn >= draft.turn)
  if (modifiers.length > 0) {
    pending.deciders = {}
    pending.voteCounts = {}
    for (const voter of pending.voters) {
      const relevant = modifiers.filter(modifier => modifier.players.includes(voter))
      const decider = relevant.findLast(modifier => modifier.controller && !draft.players[modifier.controller]?.lost)?.controller
      if (decider) pending.deciders[voter] = decider
      pending.voteCounts[voter] = 1 + relevant.reduce((sum, modifier) => sum + (modifier.additional ?? 0), 0)
    }
    pending.ballots = {}
  }
  draft.players[owner].data[PENDING_VOTE] = pending
  askNextVoter(draft, pending)
}

export const voteInstruction: InstructionHandler<'vote'> = (
  { draft, source, item },
  instruction,
) => {
  beginVote(draft, {
    source,
    ...(item ? { item } : {}),
    prompt: instruction.prompt,
    options: voteOptions(draft, source, instruction.options),
    secret: instruction.secret,
    outcome: instruction.outcome,
  })
}

/** Drop the open vote question so the next voter can be asked afresh. */
const clearVoteSelection = (draft: Draft, voteId: string) => {
  for (const seat of draft.playerOrder) {
    const selection = pendingOptionSelection(draft, seat)
    if (selection?.action.kind === 'vote' && selection.action.voteId === voteId) {
      delete draft.players[seat].data[PENDING_OPTION_SELECTION]
    }
  }
}

export const vote: Plugin = {
  id: 'vote',
  apply: ({ state, event, draft }) => {
    if ((event.type === 'advanceStep' || (event.type === 'custom' && event.name === 'advanceStep')) && draft.step === 'cleanup') {
      const modifiers = (draft.voteModifiers ?? []).filter(modifier => modifier.expiresTurn === undefined || modifier.expiresTurn > draft.turn)
      if (modifiers.length > 0) draft.voteModifiers = modifiers
      else delete draft.voteModifiers
    }
    if (event.type === 'concede') {
      const pending = pendingVote(draft)
      if (!pending?.voters.includes(event.seat)) return
      pending.voters = pending.voters.filter((seat) => seat !== event.seat)
      delete pending.votes[event.seat]
      if (pending.ballots) delete pending.ballots[event.seat]
      for (const [voter, decider] of Object.entries(pending.deciders ?? {})) if (decider === event.seat) delete pending.deciders![voter]
      if (pending.chooser === event.seat) delete pending.chooser
      clearVoteSelection(draft, pending.id)
      askNextVoter(draft, pending)
      return
    }
    if (event.type !== 'selectOption') return
    const action = pendingOptionSelection(state, event.seat)?.action
    const pending = pendingVote(draft)
    if (action?.kind !== 'vote' || pending?.id !== action.voteId) return
    pending.votes[action.voter] ??= event.optionId
    if (pending.ballots) pending.ballots[action.voter] = [...(pending.ballots[action.voter] ?? []), event.optionId]
    askNextVoter(draft, pending)
  },
}

/**
 * A secret vote is revealed only when it finishes. Until then a seat sees its
 * own vote, plus every vote it casts as the chooser; a spectator sees none.
 */
export const redactSecretVotes = (
  players: Record<PlayerId, { data: Record<string, unknown> }>,
  viewer: PlayerId | null,
) => {
  for (const player of Object.values(players)) {
    const pending = player.data[PENDING_VOTE]
    if (!isPendingVote(pending) || !pending.secret) continue
    player.data[PENDING_VOTE] = {
      ...pending,
      ...(pending.ballots ? { ballots: Object.fromEntries(Object.entries(pending.ballots).map(([voter, ballots]) => [voter, viewer !== null && (voter === viewer || pending.chooser === viewer || pending.deciders?.[voter] === viewer) ? ballots : ballots.map(() => HIDDEN_VOTE)])) } : {}),
      votes: Object.fromEntries(Object.entries(pending.votes).map(([voter, optionId]) => [
        voter,
        viewer !== null && (voter === viewer || pending.chooser === viewer || pending.deciders?.[voter] === viewer)
          ? optionId
          : HIDDEN_VOTE,
      ])),
    }
  }
}
