import { appendSnapshot, getLatest, originFromEnv } from './conduit'
import { logLine } from './log'
import { parseInvite } from './protocol'
import { saveSession, type SeatSession } from './session'
import { watchSnapshots } from './watch'

export const runSeat = async (options: {
  slug: string
  invite: string
  name: string
  deck: string
  root?: string
  logFile?: string
  skipJoin?: boolean
}) => {
  const parsed = parseInvite(options.invite)
  if (!parsed.mailbox) {
    throw new Error('seat invite needs read|mailbox')
  }
  const origin = originFromEnv()
  if (!options.skipJoin) {
    await appendSnapshot(
      origin,
      parsed.mailbox,
      JSON.stringify({ type: 'join', name: options.name, deck: options.deck }),
    )
    logLine(options.logFile, `join posted as ${options.name}`)
  }

  const session: SeatSession = {
    role: 'seat',
    slug: options.slug,
    origin,
    read: parsed.read,
    mailbox: parsed.mailbox,
    lastGen: 0,
    pid: process.pid,
  }
  const latest = await getLatest(origin, parsed.read)
  if (latest.body) session.lastGen = latest.generation
  saveSession(session, options.root)

  const watcher = watchSnapshots(
    origin,
    parsed.read,
    (generation) => {
      session.lastGen = generation
      saveSession(session, options.root)
    },
    { from: session.lastGen },
  )
  logLine(options.logFile, 'listen')
  process.on('SIGTERM', () => {
    watcher.close()
    process.exit(0)
  })
  return { stop: () => watcher.close(), session }
}
