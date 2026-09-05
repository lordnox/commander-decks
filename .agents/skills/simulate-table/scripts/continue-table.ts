#!/usr/bin/env bun

import { mkdir, readdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { createInterface } from "node:readline/promises"
import {
  ROOT,
  SEAT_IDS,
  loadManifest,
  readJson,
  seededRandom,
  shuffle,
} from "./deal-table.ts"

type Json = Record<string, any>

type Options = {
  force: boolean
  inPlace: boolean
  out?: string
  replay?: string
  repo: string
  turns: number
}

/** Continuing writes scratch, so a committed replay is never clobbered by default. */
const workingPath = (input: string) =>
  input.endsWith(".working.json") ? input : input.replace(/\.json$/, ".working.json")

const recordedPath = (input: string) => input.replace(/\.working\.json$/, ".json")

const publicCards = (player: Json) => {
  const names: string[] = []
  for (const zone of ["hand", "graveyard", "exile"]) {
    names.push(...(player[zone] ?? []))
  }
  for (const entry of player.battlefield ?? []) {
    if (!entry?.name || entry.token || entry.commander) continue
    names.push(entry.name)
  }
  return names
}

const takeFrom = (pool: string[], name: string) => {
  const index = pool.indexOf(name)
  if (index < 0) return false
  pool.splice(index, 1)
  return true
}

const reconstructLibrary = async (
  seat: Json,
  player: Json,
  seed: number,
  eventId: number,
  repo: string,
) => {
  const deckPath = join(repo, seat.deck)
  const { library } = await loadManifest(deckPath)
  const remaining = [...library]
  for (const name of publicCards(player)) {
    if (!takeFrom(remaining, name)) {
      throw new Error(
        `${seat.id}: public card "${name}" is not in the remaining library`,
      )
    }
  }
  if (remaining.length < player.library_count) {
    throw new Error(
      `${seat.id}: reconstructed library has ${remaining.length} cards, snapshot has ${player.library_count}`,
    )
  }
  const overflow = remaining.length - player.library_count
  const revealed = [...(player.revealed_top ?? [])]
  for (const name of revealed) {
    if (!takeFrom(remaining, name)) {
      throw new Error(`${seat.id}: revealed top "${name}" is missing from the library`)
    }
  }
  const random = seededRandom((seed ^ ((eventId + 1) * 0x9e3779b9)) >>> 0)
  const rest = shuffle(remaining, random).slice(0, player.library_count - revealed.length)
  return { library: [...revealed, ...rest], overflow }
}

const librariesFromGame = async (game: Json, repo: string) => {
  const last = game.events.at(-1)
  const stored = game._libraries ?? {}
  const libraries: Record<string, string[]> = {}
  const rebuilt: string[] = []
  const overflow: Record<string, number> = {}

  for (const seat of game.seats) {
    const player = last.state.players[seat.id]
    const existing = stored[seat.id]
    if (Array.isArray(existing) && existing.length === player.library_count) {
      libraries[seat.id] = existing
      continue
    }
    const restored = await reconstructLibrary(
      seat,
      player,
      game.seed ?? 1729,
      last.id,
      repo,
    )
    libraries[seat.id] = restored.library
    rebuilt.push(seat.id)
    if (restored.overflow) overflow[seat.id] = restored.overflow
  }
  return { libraries, rebuilt, overflow }
}

const parseArgs = (args: string[]): Options => {
  const options: Options = {
    force: false,
    inPlace: false,
    repo: ROOT,
    turns: 0,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = () => {
      const next = args[index + 1]
      if (!next) throw new Error(`${arg} needs a value`)
      index += 1
      return next
    }
    if (arg === "--force") options.force = true
    else if (arg === "--in-place") options.inPlace = true
    else if (arg === "--out") options.out = value()
    else if (arg === "--repo") options.repo = resolve(value())
    else if (arg === "--turns") options.turns = Number(value())
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  bun run table:continue -- table-games/<slug>.json --turns 3 [options]
  bun run table:continue -- --turns 3

Resume a recorded table from its last snapshot. --turns is extra full turns
after the current turn number. The agent still plays the Magic; this command
only restores hidden libraries and sets the new horizon.

Output goes to <slug>.working.json so the recorded replay stays untouched.

Options:
  --turns NUMBER   Extra turns to play (required)
  --out PATH       Write somewhere else
  --in-place       Overwrite the input replay instead of a working copy
  --force          Continue even if the log already has a winner
  --repo PATH      Repository root`)
      process.exit(0)
    } else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`)
    else if (options.replay) throw new Error("pass a single replay JSON")
    else options.replay = arg
  }

  if (!Number.isInteger(options.turns) || options.turns < 1) {
    throw new Error("--turns must be a positive integer")
  }
  if (options.inPlace && options.out) {
    throw new Error("pass either --in-place or --out, not both")
  }
  return options
}

const listReplays = async (repo: string) => {
  const dir = join(repo, "table-games")
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()
  return names.map((name) => join(dir, name))
}

const chooseReplay = async (repo: string, query?: string) => {
  const replays = await listReplays(repo)
  if (query) {
    const resolved = resolve(query)
    const match = replays.find((path) => path === resolved || path.endsWith(query))
    if (match) return match
    return resolved
  }
  if (replays.length === 1) return replays[0]
  if (!process.stdin.isTTY) {
    throw new Error(
      "pass a replay JSON, or run interactively:\n" +
        replays.map((path, index) => `  ${index + 1}. ${path.slice(repo.length + 1)}`).join("\n"),
    )
  }
  const input = createInterface({ input: process.stdin, output: process.stderr })
  try {
    process.stderr.write(
      "\nChoose a replay:\n" +
        replays.map((path, index) => `  ${index + 1}. ${path.slice(repo.length + 1)}`).join("\n") +
        "\n",
    )
    while (true) {
      const answer = await input.question(`Selection [1-${replays.length}]: `)
      const index = Number(answer) - 1
      if (Number.isInteger(index) && replays[index]) return replays[index]
      process.stderr.write("Enter one of the listed numbers.\n")
    }
  } finally {
    input.close()
  }
}

const brief = (game: Json, rebuilt: string[], overflow: Record<string, number>) => {
  const last = game.events.at(-1)
  const lines = [
    `# Continue — seed ${game.seed}`,
    "",
    `Current: turn ${last.turn} ${last.phase}${last.seat ? ` ${last.seat}` : ""} · event ${last.id + 1}/${game.events.length}`,
    `Horizon: play through turn ${game.horizon.throughTurn}`,
    last.summary ? `Last event: ${last.summary}` : "",
    rebuilt.length
      ? `Rebuilt hidden libraries for ${rebuilt.join(", ")} from public zones; remaining order is seeded, not the original.`
      : "Hidden libraries restored from the replay file.",
  ]
  for (const [seat, count] of Object.entries(overflow)) {
    lines.push(`${seat} had ${count} extra leftover card(s) not in public zones; they were shuffled out to match library_count.`)
  }
  for (const seat of game.seats) {
    const player = last.state.players[seat.id]
    const library = game._libraries[seat.id] ?? []
    const status = player.life <= 0 ? "eliminated" : `${player.life} life`
    const top = library[0] ? `, top ${library[0]}` : ""
    lines.push(
      `${seat.id} ${seat.name}: ${status}, library ${player.library_count}${top}`,
    )
  }
  return `${lines.filter(Boolean).join("\n")}\n`
}

const main = async () => {
  const options = parseArgs(Bun.argv.slice(2))
  const replayPath = await chooseReplay(options.repo, options.replay)
  const game = await readJson(replayPath)
  if (game.schema !== 1 && game.schema !== 2) {
    throw new Error("replay JSON must set schema to 1 or 2")
  }
  if (!Array.isArray(game.seats) || game.seats.length !== 4) {
    throw new Error("replay JSON needs exactly four seats")
  }
  if (!Array.isArray(game.events) || !game.events.length) {
    throw new Error("replay JSON needs a non-empty events list")
  }

  const last = game.events.at(-1)
  if (game.result?.ended === "win" && !options.force) {
    throw new Error(
      `this game already ended in a win on turn ${game.result.turn}; pass --force to continue anyway`,
    )
  }

  const currentTurn = Math.max(last.turn ?? 0, game.result?.turn ?? 0)
  const throughTurn = currentTurn + options.turns
  const { libraries, rebuilt, overflow } = await librariesFromGame(game, options.repo)

  // headline and result describe the recorded game until the extra turns exist.
  game.horizon = {
    extraTurns: options.turns,
    throughTurn,
    fromTurn: currentTurn,
  }
  game._libraries = libraries

  const target = options.out ?? (options.inPlace ? replayPath : workingPath(replayPath))
  const out = resolve(target)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, `${JSON.stringify(game)}\n`)

  const show = (path: string) =>
    path.startsWith(`${options.repo}/`) ? path.slice(options.repo.length + 1) : path
  process.stdout.write(brief(game, rebuilt, overflow))
  process.stdout.write(
    [
      "",
      `Wrote ${show(out)} (scratch: holds hidden libraries).`,
      "This command does not play Magic. Next:",
      `  1. Ask the agent to play ${
        options.turns === 1
          ? `turn ${throughTurn}`
          : `turns ${currentTurn + 1}–${throughTurn}`
      } in that file.`,
      `  2. It appends the events, strips _libraries, and writes ${show(recordedPath(replayPath))}.`,
      "  3. Render with render-table-replay when you want the HTML.",
      "",
    ].join("\n"),
  )
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  })
}
