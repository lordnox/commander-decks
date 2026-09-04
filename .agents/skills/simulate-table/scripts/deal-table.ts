#!/usr/bin/env bun

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, join, relative, resolve } from "node:path"
import { createInterface } from "node:readline/promises"

type Json = Record<string, any>

export type Deck = {
  path: string
  relativePath: string
  title: string
  commanders: string[]
  plan: string
}

type Candidate = {
  mulligans: number
  hand: string[]
  library: string[]
}

type Seat = Deck & {
  id: string
  color: string
  entries: Json[]
  candidates: Candidate[]
  tokenSources: Record<string, string[]>
  tokens: Record<string, Json>
}

type Options = {
  apply: boolean
  bottom: string[]
  deckQueries: string[]
  format: "markdown" | "json"
  list: boolean
  mulligans: string
  out?: string
  repo: string
  seed: number
  turns: number
}

export const ROOT = resolve(import.meta.dir, "../../../..")
export const SEAT_IDS = ["p1", "p2", "p3", "p4"]
const SEAT_COLORS = ["#c45c26", "#2f6f64", "#4a5d9e", "#8a3d6b"]
const MULLIGAN_MAX = 2

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

export const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8"))

const readPrimer = async (deckPath: string) => {
  try {
    return await readFile(join(deckPath, "README.md"), "utf8")
  } catch {
    return ""
  }
}

const titleFromPrimer = (primer: string, fallback: string) => {
  const first = primer.split(/\r?\n/, 1)[0] ?? ""
  return first.match(/—\s+(.+)$/)?.[1]?.trim() || fallback
}

const planFromPrimer = (primer: string) => {
  const line = primer.split(/\r?\n/).find((entry) => entry.startsWith("**Primary plan:**"))
  return (line ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace("Primary plan:", "")
    .trim()
}

const isLibraryCard = (entry: Json) =>
  !(entry.categories ?? []).some(
    (category: string) => category === "Commander{top}" || category.includes("{noDeck}"),
  )

export const loadManifest = async (deckPath: string) => {
  const manifestPath = join(deckPath, "cards.json")
  const manifest = await readJson(manifestPath).catch(() => {
    throw new Error(`missing resolved manifest: ${manifestPath}`)
  })
  const library: string[] = []
  const commanders: string[] = []
  const entries: Json[] = []

  for (const entry of manifest.cards ?? []) {
    const { name, quantity, categories = [] } = entry
    if (typeof name !== "string" || !Number.isInteger(quantity) || quantity < 1) {
      throw new Error(`invalid manifest entry in ${manifestPath}`)
    }
    entries.push(entry)
    if (categories.includes("Commander{top}")) {
      commanders.push(...Array(quantity).fill(name))
    } else if (isLibraryCard(entry)) {
      library.push(...Array(quantity).fill(name))
    }
  }

  if (![98, 99].includes(library.length)) {
    throw new Error(`${deckPath}: expected a 98- or 99-card library, found ${library.length}`)
  }
  if (![1, 2].includes(commanders.length)) {
    throw new Error(`${deckPath}: expected one or two commanders, found ${commanders.length}`)
  }
  if (library.length + commanders.length !== 100) {
    throw new Error(`${deckPath}: expected 100 total cards`)
  }

  return { library, commanders, entries }
}

export const discoverDecks = async (repo: string) => {
  const decksPath = join(repo, "decks")
  const entries = await readdir(decksPath, { withFileTypes: true })
  const decks: Deck[] = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const path = join(decksPath, entry.name)
    try {
      const primer = await readPrimer(path)
      const { commanders } = await loadManifest(path)
      decks.push({
        path,
        relativePath: relative(repo, path),
        title: titleFromPrimer(primer, entry.name),
        commanders,
        plan: planFromPrimer(primer),
      })
    } catch {
      // Unresolved deck workspaces are intentionally not selectable.
    }
  }

  return decks
}

const deckLabel = (deck: Deck) =>
  `${deck.title} — ${deck.commanders.join(" + ")} (${basename(deck.path)})`

const matchesDeck = (deck: Deck, query: string) => {
  const needle = normalize(query)
  const fields = [
    deck.title,
    deck.commanders.join(" "),
    basename(deck.path).replace(/^[^_]+_/, ""),
    deck.relativePath,
  ].map(normalize)
  const exact = fields.some((field) => field === needle)
  const partial = fields.some((field) => field.includes(needle))
  return { exact, partial }
}

export const chooseDeck = async (decks: Deck[], query?: string) => {
  const matches = query
    ? decks.filter((deck) => matchesDeck(deck, query).partial)
    : decks
  const exact = query
    ? matches.filter((deck) => matchesDeck(deck, query).exact)
    : []

  if (exact.length === 1) return exact[0]
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) throw new Error(`no resolved deck matches "${query}"`)
  if (!process.stdin.isTTY) {
    throw new Error(
      `${query ? `deck "${query}" is ambiguous` : "a deck selection is required"}:\n` +
        matches.map((deck, index) => `  ${index + 1}. ${deckLabel(deck)}`).join("\n"),
    )
  }

  const input = createInterface({ input: process.stdin, output: process.stderr })
  try {
    process.stderr.write(
      `\n${query ? `Choose a deck for "${query}"` : "Choose a deck"}:\n` +
        matches.map((deck, index) => `  ${index + 1}. ${deckLabel(deck)}`).join("\n") +
        "\n",
    )
    while (true) {
      const answer = await input.question(`Selection [1-${matches.length}]: `)
      const index = Number(answer) - 1
      if (Number.isInteger(index) && matches[index]) return matches[index]
      process.stderr.write("Enter one of the listed numbers.\n")
    }
  } finally {
    input.close()
  }
}

const parseArgs = (args: string[]): Options => {
  const options: Options = {
    apply: false,
    bottom: [],
    deckQueries: [],
    format: "markdown",
    list: false,
    mulligans: "0,0,0,0",
    repo: ROOT,
    seed: 1729,
    turns: 12,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = () => {
      const next = args[index + 1]
      if (!next) throw new Error(`${arg} needs a value`)
      index += 1
      return next
    }
    if (arg === "--apply") options.apply = true
    else if (arg === "--bottom") options.bottom.push(value())
    else if (arg === "--format") options.format = value() as Options["format"]
    else if (arg === "--list") options.list = true
    else if (arg === "--mulligans") options.mulligans = value()
    else if (arg === "--out") options.out = value()
    else if (arg === "--repo") options.repo = resolve(value())
    else if (arg === "--seed") options.seed = Number(value())
    else if (arg === "--turns") options.turns = Number(value())
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  bun run table:deal -- "Deck one" "Deck two" "Deck three" "Deck four" [options]
  bun run table:deal

Deck names may be brew titles, commanders, or folder slugs. Missing or
ambiguous names open a numbered selection when run interactively.

Options:
  --list                    List resolved decks
  --seed NUMBER             Shuffle seed (default: 1729)
  --turns NUMBER            Play through this turn (default: 12)
  --format markdown|json    Preview format (default: markdown)
  --apply                   Write opening game state
  --mulligans 0,1,0,0      Kept candidate per seat
  --bottom p2=Card,Card     London bottoms; repeat per seat
  --out PATH                Write output to a file
  --repo PATH               Repository root`)
      process.exit(0)
    } else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`)
    else options.deckQueries.push(arg)
  }

  if (!Number.isInteger(options.seed) || options.seed < 0) {
    throw new Error("--seed must be a non-negative integer")
  }
  if (!["markdown", "json"].includes(options.format)) {
    throw new Error("--format must be markdown or json")
  }
  if (options.deckQueries.length > 4) throw new Error("pass at most four deck names")
  if (!Number.isInteger(options.turns) || options.turns < 1) {
    throw new Error("--turns must be a positive integer")
  }
  return options
}

export const seededRandom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export const shuffle = (cards: string[], random: () => number) => {
  const shuffled = [...cards]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const card = shuffled[index]
    shuffled[index] = shuffled[swap]
    shuffled[swap] = card
  }
  return shuffled
}

const dealCandidates = (library: string[], random: () => number) =>
  Array.from({ length: MULLIGAN_MAX + 1 }, (_, mulligans) => {
    const shuffled = shuffle(library, random)
    return {
      mulligans,
      hand: shuffled.slice(0, 7),
      library: shuffled.slice(7),
    }
  })

const imageUris = (cache: Json) => {
  if (cache.image_uris?.small) return cache.image_uris
  return cache.card_faces?.find((face: Json) => face.image_uris?.small)?.image_uris ?? {}
}

const joinedFaces = (cache: Json, field: string) =>
  (cache.card_faces ?? []).map((face: Json) => face[field] || "").filter(Boolean).join(" // ")

const statLine = (cache: Json) => {
  if (cache.power != null) return `${cache.power}/${cache.toughness}`
  return (cache.card_faces ?? [])
    .filter((face: Json) => face.power != null)
    .map((face: Json) => `${face.power}/${face.toughness}`)
    .join(" // ")
}

const catalogEntry = async (entry: Json, repo: string) => {
  const card = entry.card ?? {}
  const cache = typeof entry.cache === "string"
    ? await readJson(join(repo, entry.cache)).catch(() => ({}))
    : {}
  const uris = imageUris(cache)
  return {
    scryfall_uri: cache.scryfall_uri || entry.scryfall_uri || "",
    image_small: uris.small || "",
    image_normal: uris.normal || uris.small || "",
    type_line: cache.type_line || card.type_line || joinedFaces(cache, "type_line"),
    mana_cost: cache.mana_cost || card.mana_cost || joinedFaces(cache, "mana_cost"),
    oracle_text: cache.oracle_text || card.oracle_text || joinedFaces(cache, "oracle_text"),
    stats: statLine(cache),
  }
}

const buildCatalog = async (seats: Seat[], repo: string) => {
  const entries = new Map<string, Json>()
  for (const seat of seats) {
    for (const entry of seat.entries) {
      if (typeof entry.name === "string" && !entries.has(entry.name)) {
        entries.set(entry.name, entry)
      }
    }
  }
  return Object.fromEntries(
    await Promise.all(
      [...entries].map(async ([name, entry]) => [name, await catalogEntry(entry, repo)]),
    ),
  )
}

const loadTokens = async (deckPath: string) => {
  try {
    const manifest = await readJson(join(deckPath, "tokens.json"))
    if (manifest.schema !== 1) throw new Error("unsupported token schema")
    return {
      tokenSources: manifest.produced_by ?? {},
      tokens: manifest.tokens ?? {},
    }
  } catch {
    return { tokenSources: {}, tokens: {} }
  }
}

const tableTokens = (seats: Seat[]) => ({
  token_sources: Object.fromEntries(
    seats.map((seat) => [seat.id, seat.tokenSources]),
  ),
  tokens: Object.assign({}, ...seats.map((seat) => seat.tokens)),
})

const loadSeats = async (decks: Deck[], seed: number) => {
  const random = seededRandom(seed)
  return Promise.all(
    decks.map(async (deck, index): Promise<Seat> => {
      const { library, entries } = await loadManifest(deck.path)
      const tokenData = await loadTokens(deck.path)
      return {
        ...deck,
        ...tokenData,
        id: SEAT_IDS[index],
        color: SEAT_COLORS[index],
        entries,
        candidates: dealCandidates(library, random),
      }
    }),
  )
}

const renderMarkdown = (seats: Seat[], seed: number) => {
  const lines = [
    `# Table deal — seed ${seed}`,
    "",
    `Turn order: ${seats.map((seat) => `${seat.id} ${seat.title}`).join(" → ")}`,
  ]
  for (const seat of seats) {
    lines.push("", `## ${seat.id} — ${seat.title}`, `Commander: ${seat.commanders.join(", ")}`)
    for (const candidate of seat.candidates) {
      const label = candidate.mulligans === 0 ? "keep seven" : `mulligan ${candidate.mulligans}`
      lines.push("", `### ${label}`, `- Hand: ${candidate.hand.join(", ")}`)
    }
  }
  return `${lines.join("\n")}\n`
}

const publicSeat = (seat: Seat, candidates = false) => ({
  id: seat.id,
  name: seat.title,
  deck: seat.relativePath,
  commanders: seat.commanders,
  plan: seat.plan,
  color: seat.color,
  ...(candidates
    ? {
        candidates: seat.candidates.map(({ mulligans, hand, library }) => ({
          mulligans,
          hand,
          library_count: library.length,
        })),
      }
    : {}),
})

const previewPayload = async (seats: Seat[], options: Options) => ({
  seed: options.seed,
  seats: seats.map((seat) => publicSeat(seat, true)),
  catalog: await buildCatalog(seats, options.repo),
  ...tableTokens(seats),
  _libraries: Object.fromEntries(
    seats.flatMap((seat) =>
      seat.candidates.map((candidate) => [
        `${seat.id}:${candidate.mulligans}`,
        { hand: candidate.hand, library: candidate.library },
      ]),
    ),
  ),
})

const parseBottoms = (values: string[]) => {
  const bottoms = Object.fromEntries(SEAT_IDS.map((seat) => [seat, [] as string[]]))
  for (const value of values) {
    const split = value.indexOf("=")
    if (split < 0) throw new Error(`bottom must be seat=Card,Card: ${value}`)
    const seat = value.slice(0, split).trim()
    if (!(seat in bottoms)) throw new Error(`unknown seat in --bottom: ${seat}`)
    bottoms[seat] = value
      .slice(split + 1)
      .split(",")
      .map((card) => card.trim())
      .filter(Boolean)
  }
  return bottoms
}

const applyLondon = (candidate: Candidate, bottom: string[]) => {
  if (bottom.length !== candidate.mulligans) {
    throw new Error(
      `mulligan ${candidate.mulligans} needs ${candidate.mulligans} bottom card(s)`,
    )
  }
  const hand = [...candidate.hand]
  const library = [...candidate.library]
  for (const card of bottom) {
    const index = hand.indexOf(card)
    if (index < 0) throw new Error(`cannot bottom "${card}"; hand is ${hand.join(", ")}`)
    hand.splice(index, 1)
    library.push(card)
  }
  return { hand, library }
}

const emptyPlayer = (
  commanders: string[],
  hand: string[],
  libraryCount: number,
  seatId: string,
) => ({
  life: 40,
  poison: 0,
  commander_damage: Object.fromEntries(
    SEAT_IDS.filter((seat) => seat !== seatId).map((seat) => [seat, 0]),
  ),
  commander_tax: 0,
  library_count: libraryCount,
  hand,
  battlefield: [],
  graveyard: [],
  exile: [],
  command: commanders,
  revealed_top: [],
})

const applyGame = async (seats: Seat[], options: Options) => {
  const counts = options.mulligans.split(",").map((part) => Number(part.trim()))
  if (
    counts.length !== 4 ||
    counts.some((count) => !Number.isInteger(count) || count < 0 || count > MULLIGAN_MAX)
  ) {
    throw new Error("--mulligans must be four integers from 0 to 2")
  }
  const bottoms = parseBottoms(options.bottom)
  const players: Json = {}
  const libraries: Json = {}
  const publicSeats: Json[] = []
  const keeps: Json[] = []

  seats.forEach((seat, index) => {
    const mulligans = counts[index]
    const candidate = seat.candidates.find((item) => item.mulligans === mulligans)!
    const kept = applyLondon(candidate, bottoms[seat.id])
    players[seat.id] = emptyPlayer(
      seat.commanders,
      kept.hand,
      kept.library.length,
      seat.id,
    )
    libraries[seat.id] = kept.library
    publicSeats.push({ ...publicSeat(seat), mulligans })
    keeps.push({
      turn: 0,
      phase: "setup",
      seat: seat.id,
      kind: mulligans === 0 ? "keep" : "mulligan",
      summary:
        mulligans === 0
          ? `${seat.title} keeps 7`
          : `${seat.title} mulligans ${mulligans}, bottoms ${bottoms[seat.id].join(", ")}`,
      cards: kept.hand,
      notes: "",
    })
  })

  const openingState = {
    active: "p1",
    turn: 0,
    phase: "setup",
    stack: [],
    players,
  }
  const events = [
    {
      turn: 0,
      phase: "setup",
      seat: null,
      kind: "setup",
      summary: "Four players keep. Turn-one draw is on.",
      cards: [],
      notes: "",
    },
    ...keeps,
  ].map((event, id) => ({
    id,
    ...event,
    state: structuredClone(openingState),
  }))

  return {
    schema: 1,
    seed: options.seed,
    starting_life: 40,
    headline: "In progress",
    horizon: { throughTurn: options.turns },
    result: {
      winner: null,
      ended: "truncated",
      turn: 0,
      summary: `Opening keeps only; play through turn ${options.turns} and overwrite this file.`,
    },
    seats: publicSeats,
    catalog: await buildCatalog(seats, options.repo),
    ...tableTokens(seats),
    events,
    _libraries: libraries,
  }
}

const main = async () => {
  const options = parseArgs(Bun.argv.slice(2))
  const available = await discoverDecks(options.repo)
  if (options.list) {
    console.log(available.map(deckLabel).join("\n"))
    return
  }

  const selected: Deck[] = []
  for (let index = 0; index < 4; index += 1) {
    const remaining = available.filter((deck) => !selected.includes(deck))
    selected.push(await chooseDeck(remaining, options.deckQueries[index]))
  }

  const seats = await loadSeats(selected, options.seed)
  let text: string
  if (options.apply) {
    text = JSON.stringify(await applyGame(seats, options), null, 2)
  } else if (options.format === "json") {
    text = JSON.stringify(await previewPayload(seats, options), null, 2)
  } else {
    text = renderMarkdown(seats, options.seed)
  }

  if (options.out) {
    const out = resolve(options.out)
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, text)
  } else {
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`)
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  })
}
