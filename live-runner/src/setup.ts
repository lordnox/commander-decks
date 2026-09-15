import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { replayActions } from './actions'
import { ensureHostKeys } from './host'
import { createLobby } from './lobby'
import { isOpeningFrame } from './opening'
import {
  inboxLabel,
  pagesLiveUrl,
  SEAT_IDS,
  type SeatId,
} from './protocol'
import {
  loadSession,
  logPath,
  pidAlive,
  readPid,
  replayPath,
  repoRoot,
  saveSession,
  type HostSession,
} from './session'

const PAGES = 'https://lordnox.github.io/commander-decks/live/'

type ReplaySeat = {
  id: SeatId
  name: string
  deck: string
}

type Replay = {
  seats?: ReplaySeat[]
  events?: Array<{
    kind?: string
    seat?: string
    state?: {
      active?: SeatId
      phase?: string
    }
  }>
}

export const parseSetupArgs = (argv: string[]) => {
  const value = (name: string) => {
    const index = argv.indexOf(name)
    return index < 0 ? undefined : argv[index + 1]
  }
  return {
    slug: value('--slug'),
    you: value('--you') as SeatId | undefined,
    noAgent: argv.includes('--no-agent'),
  }
}

export const loadReplaySeats = (slug: string, root: string) => {
  const path = replayPath(slug, root)
  if (!existsSync(path)) {
    throw new Error(`Deal the table first: missing ${path}`)
  }
  const replay = JSON.parse(readFileSync(path, 'utf8')) as Replay
  if (
    replay.seats?.length !== 4
    || replay.seats.some(
      (seat, index) =>
        seat.id !== SEAT_IDS[index]
        || !seat.name
        || !seat.deck,
    )
  ) {
    throw new Error(`${path} must contain four ordered, named deck seats`)
  }
  return {
    replay,
    seats: replay.seats,
  }
}

export const createPlaySession = (
  slug: string,
  root: string,
  origin: string,
  bins: HostSession['bins'],
  replay: Replay,
  seats: ReplaySeat[],
  agent: boolean,
  you: SeatId,
) => {
  const state = createLobby(slug)
  state.phase = 'play'
  state.human = you
  state.occupants = Object.fromEntries(
    seats.map((seat) => [
      seat.id,
      { name: seat.name, deck: seat.deck },
    ]),
  )
  state.active = replay.events?.at(-1)?.state?.active ?? 'p1'
  state.firstPlayer = 'p1'
  if (isOpeningFrame(replay, you)) {
    const name = state.occupants[you]?.name ?? you
    state.opening = { seat: you }
    state.active = you
    state.waiting = `${name}: keep or mulligan.`
    state.judge = 'Opening hands are dealt.'
    state.actions = { [you]: ['keep', 'mulligan'] }
  } else {
    state.waiting = `${state.occupants[state.active]?.name ?? state.active}: send a turn plan.`
    state.judge = 'The dealt table is ready.'
    state.actions = replayActions(root, slug, state)
  }

  return {
    role: 'host',
    slug,
    origin,
    bins,
    lastGen: Object.fromEntries(SEAT_IDS.map((seat) => [`${seat}-inbox`, 0])),
    phase: state.phase,
    occupants: state.occupants,
    firstPlayer: state.firstPlayer,
    lobby: state,
    agent,
  } satisfies HostSession
}

export const liveLinks = (
  origin: string,
  bins: HostSession['bins'],
  you: SeatId,
) => ({
  private: pagesLiveUrl(
    PAGES,
    {
      read: bins[you].read,
      mailbox: bins[inboxLabel(you)].write,
    },
    origin,
  ),
  public: pagesLiveUrl(PAGES, { read: bins.host.read }, origin),
})

const startRunner = async (
  slug: string,
  root: string,
  agent: boolean,
  resume: boolean,
) => {
  const command = resume ? 'resume' : 'host'
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL('./cli.ts', import.meta.url)),
      command,
      '--slug',
      slug,
      ...(agent ? ['--agent'] : []),
    ],
    {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [code, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(error.trim() || output.trim())
}

export const main = async (argv = process.argv.slice(2)) => {
  const { slug, you = 'p1', noAgent } = parseSetupArgs(argv)
  if (!slug || !SEAT_IDS.includes(you)) {
    console.error(
      'Usage: bun run table:live:setup -- --slug <dealt-replay-slug> '
      + '[--you p1|p2|p3|p4] [--no-agent]',
    )
    return 1
  }

  const root = repoRoot()
  const { replay, seats } = loadReplaySeats(slug, root)
  const saved = loadSession(slug, root)
  const keys = await ensureHostKeys(slug, root)
  const agent = !noAgent
  const runningPid = readPid(slug, root)

  if (!saved) {
    saveSession(
        createPlaySession(slug, root, keys.origin, keys.bins, replay, seats, agent, you),
      root,
    )
  } else if (saved.role !== 'host') {
    throw new Error(`${slug} belongs to a seat runner, not a table host`)
  }

  if (!runningPid || !pidAlive(runningPid)) {
    await startRunner(slug, root, agent, Boolean(saved))
  }

  const links = liveLinks(keys.origin, keys.bins, you)
  console.log(`Live table: ${slug}`)
  console.log(`You: ${you} — ${seats.find((seat) => seat.id === you)?.name}`)
  console.log(`Open: ${links.private}`)
  console.log(`Public: ${links.public}`)
  console.log(`Log: ${logPath(slug, root)}`)
  console.log(`Resume: bun run table:run resume --slug ${slug} --agent`)
  console.log(`Stop: bun run table:run stop --slug ${slug}`)
  return 0
}

if (import.meta.main) {
  void main().then((code) => {
    if (code) process.exit(code)
  })
}
