export type HeaderTone = 'act' | 'pending' | 'waiting' | 'history'

export type LiveHeader = {
  identity: string
  state: string
  status: { label: string; tone: HeaderTone }
}

/**
 * The header answers three questions in order: which seat am I, whose turn is
 * it, and does the table owe me an action. Deck names of the other three seats
 * are context, not headline, so they stay out of this text.
 */
export const liveHeader = ({
  youName,
  youSeat,
  activeName,
  activeSeat,
  turn,
  phaseLabel,
  yourAction,
  actionPending,
  viewingPast,
}: {
  youName?: string | null
  youSeat?: string | null
  activeName?: string | null
  activeSeat?: string | null
  turn: number
  phaseLabel: string
  yourAction: boolean
  actionPending: boolean
  viewingPast: boolean
}): LiveHeader => {
  const seated = Boolean(youSeat)
  const yours = seated && youSeat === activeSeat
  const identity = seated
    ? `You are ${youName ?? youSeat}`
    : 'Spectating this table'

  const whose = yours
    ? 'your turn'
    : activeName
      ? `${activeName}'s turn`
      : 'turn order pending'
  const state = `Turn ${turn} · ${phaseLabel} · ${whose}`

  const status: LiveHeader['status'] = viewingPast
    ? { label: 'Reviewing history', tone: 'history' }
    : actionPending
      ? { label: 'Sent, waiting for the host', tone: 'pending' }
      : yourAction
        ? { label: 'Your move', tone: 'act' }
        : !seated
          ? { label: 'Watching', tone: 'waiting' }
          : { label: `Waiting on ${yours ? 'the host' : activeName ?? 'the table'}`, tone: 'waiting' }

  return { identity, state, status }
}
