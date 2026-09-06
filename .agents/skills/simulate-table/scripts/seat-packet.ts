import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type Json = Record<string, any>

const privateEventKinds = new Set(['keep', 'mulligan'])

const clone = <T>(value: T): T => structuredClone(value)

const seatName = (game: Json, seatId: string) =>
  game.seats.find((seat: Json) => seat.id === seatId)?.name ?? seatId

const sanitizePlayers = (players: Json, actingSeat: string) =>
  Object.fromEntries(
    Object.entries(players).map(([seatId, value]) => {
      const player = clone(value as Json)
      if (seatId !== actingSeat) {
        player.hand_count = player.hand_count ?? player.hand?.length ?? 0
        delete player.hand
        delete player.revealed_top
      }
      return [seatId, player]
    }),
  )

const sanitizeState = (state: Json, actingSeat: string) => {
  const sanitized = clone(state)
  sanitized.players = sanitizePlayers(sanitized.players ?? {}, actingSeat)
  return sanitized
}

const sanitizeEvent = (game: Json, event: Json, actingSeat: string) => {
  if (event.kind === 'think' && event.seat !== actingSeat) return null

  const sanitized = clone(event)
  delete sanitized.state

  if (event.seat !== actingSeat && event.kind === 'draw') {
    sanitized.summary = `${seatName(game, event.seat)} draws a card.`
    sanitized.cards = []
  }

  if (event.seat !== actingSeat && privateEventKinds.has(event.kind)) {
    sanitized.summary = `${seatName(game, event.seat)} ${event.kind}s.`
    sanitized.cards = []
    delete sanitized.decision
  }

  return sanitized
}

export const buildSeatPacket = (game: Json, actingSeat: string) => {
  if (!game.seats?.some((seat: Json) => seat.id === actingSeat)) {
    throw new Error(`unknown seat ${actingSeat}`)
  }
  if (!game.events?.length) throw new Error('replay has no events')

  const last = game.events.at(-1)
  const history = game.events
    .map((event: Json) => sanitizeEvent(game, event, actingSeat))
    .filter(Boolean)
  const plans = Object.fromEntries(
    ['game', 'turn', 'impact'].flatMap((scope) => {
      const event = [...game.events]
        .reverse()
        .find(
          (candidate: Json) =>
            candidate.seat === actingSeat && candidate.plan?.scope === scope,
        )
      return event ? [[scope, clone(event.plan)]] : []
    }),
  )

  return {
    schema: 1,
    seed: game.seed,
    seat: clone(game.seats.find((candidate: Json) => candidate.id === actingSeat)),
    current: {
      event: last.id,
      turn: last.turn,
      phase: last.phase,
      active: last.state?.active,
    },
    state: sanitizeState(last.state ?? {}, actingSeat),
    plans,
    history,
    catalog: clone(game.catalog ?? {}),
    references: clone(game.references ?? []),
    tokens: clone(game.tokens ?? {}),
  }
}

const parseArgs = (args: string[]) => {
  let replay = ''
  let seat = ''
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--seat') {
      seat = args[index + 1] ?? ''
      index += 1
    } else if (!replay) {
      replay = args[index]
    } else {
      throw new Error(`unexpected argument ${args[index]}`)
    }
  }
  if (!replay || !seat) {
    throw new Error('usage: table:packet <replay.json> --seat p1')
  }
  return { replay, seat }
}

const main = async () => {
  const { replay, seat } = parseArgs(Bun.argv.slice(2))
  const game = JSON.parse(await readFile(resolve(replay), 'utf8'))
  process.stdout.write(`${JSON.stringify(buildSeatPacket(game, seat), null, 2)}\n`)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`ERROR: ${message}\n`)
    process.exitCode = 1
  })
}
