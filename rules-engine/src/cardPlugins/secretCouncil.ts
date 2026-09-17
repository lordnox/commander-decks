import type { Plugin } from '../types'
import {
  DIALOG_CHOSEN,
  pendingDialogFor,
  setPendingDialog,
} from '../pendingDialog'

export const SECRET_COUNCIL = 'secretCouncil.pending'
export const CHOOSE_VOTES = 'secretCouncil.chooseVotes'

type PendingCouncil = {
  sourceId: string
  source: string
  voters: string[]
  votes: Record<string, string>
}

const isPending = (value: unknown): value is PendingCouncil =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingCouncil).sourceId === 'string'
  && Array.isArray((value as PendingCouncil).voters)

const pendingCouncil = (state: { playerOrder: string[]; players: Record<string, { data: Record<string, unknown> }> }) => {
  for (const seat of state.playerOrder) {
    const pending = state.players[seat]?.data[SECRET_COUNCIL]
    if (isPending(pending)) return { seat, pending }
  }
}

const askVote = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  pending: PendingCouncil,
  seat: string,
) => {
  setPendingDialog(draft, {
    sourceId: pending.sourceId,
    source: pending.source,
    seat,
    kind: 'secret-vote',
    prompt: `Secretly vote for a player (${pending.source}).`,
    waiting: 'is voting in secret.',
    judge: `Waiting for a secret council vote.`,
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['skip', 'target'],
    options: draft.playerOrder.filter((player) => !draft.players[player].lost),
    sequence: draft.allocTs(),
    requirements: { target: { min: 1, max: 1 } },
  })
}

const finish = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  owner: string,
  pending: PendingCouncil,
) => {
  const tallies: Record<string, number> = {}
  for (const seat of draft.playerOrder) tallies[seat] = 0
  for (const voted of Object.values(pending.votes)) {
    if (tallies[voted] !== undefined) tallies[voted] += 1
  }
  draft.note(`${pending.source} reveals the secret council`)
  for (const seat of draft.playerOrder) {
    const count = tallies[seat] ?? 0
    if (count > 0) draft.enqueue({ type: 'draw', seat, count })
    if (count === 0 && !draft.players[seat].lost) {
      setPendingDialog(draft, {
        sourceId: pending.sourceId,
        source: pending.source,
        seat,
        kind: 'put-permanents',
        prompt: 'You received no votes. You may put a permanent card from your hand onto the battlefield.',
        waiting: 'is choosing a free permanent.',
        judge: `Waiting for zero-vote dumps from ${pending.source}.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['hand', 'battlefield'],
        permanent: true,
        optional: true,
        sequence: draft.allocTs(),
        requirements: { battlefield: { max: 1 } },
      })
    }
  }
  delete draft.players[owner].data[SECRET_COUNCIL]
}

export const secretCouncil: Plugin = {
  id: 'secretCouncil',
  legal: ({ state, event }) => {
    if (event.type !== 'passPriority') return
    const pending = pendingCouncil(state)
    if (pending) return `${pending.pending.voters[0] ?? pending.seat} is voting secretly`
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'custom' && event.name === 'secretCouncil.begin' && event.seat) {
      const sourceId = String(event.payload?.sourceId ?? '')
      const source = String(event.payload?.source ?? '')
      const chooser = draft.playerOrder.find((seat) =>
        draft.players[seat].data[CHOOSE_VOTES] === true)
      const voters = draft.playerOrder.filter((seat) => !draft.players[seat].lost)
      const pending: PendingCouncil = {
        sourceId,
        source,
        voters: [...voters],
        votes: {},
      }
      draft.players[event.seat].data[SECRET_COUNCIL] = pending
      askVote(draft, pending, chooser ?? voters[0])
      return
    }

    if (event.type === 'custom' && event.name === 'advanceStep' && draft.step === 'cleanup') {
      for (const player of Object.values(draft.players)) {
        delete player.data[CHOOSE_VOTES]
      }
      return
    }

    if (event.type !== 'custom' || event.name !== DIALOG_CHOSEN || !event.seat) return
    const dialog = pendingDialogFor(state, event.seat)
    if (dialog?.kind !== 'secret-vote') return
    const found = pendingCouncil(draft)
    if (!found) return
    const { seat: owner, pending } = found
    const targets = Array.isArray(event.payload?.targets)
      ? event.payload.targets.filter((id): id is string => typeof id === 'string')
      : Array.isArray(event.payload?.objectIds)
        ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
        : []
    const voted = targets[0]
    if (!voted || !draft.players[voted] || draft.players[voted].lost) return
    const chooser = draft.players[event.seat].data[CHOOSE_VOTES] === true
    if (chooser) {
      const remaining = pending.voters.filter((seat) => pending.votes[seat] === undefined)
      const current = remaining[0]
      if (current) pending.votes[current] = voted
    } else {
      pending.votes[event.seat] = voted
    }
    const next = pending.voters.find((seat) => pending.votes[seat] === undefined)
    if (!next) {
      finish(draft, owner, pending)
      return
    }
    if (chooser) {
      askVote(draft, pending, event.seat)
      return
    }
    askVote(draft, pending, next)
  },
}

export const redactSecretCouncil = (
  players: Record<string, { data: Record<string, unknown> }>,
  viewer: string | null,
) => {
  for (const [seat, player] of Object.entries(players)) {
    const pending = player.data[SECRET_COUNCIL]
    if (!isPending(pending)) continue
    if (viewer === null || viewer === seat) continue
    player.data[SECRET_COUNCIL] = {
      ...pending,
      votes: Object.fromEntries(
        Object.entries(pending.votes).filter(([voter]) => voter === viewer),
      ),
    }
  }
}
