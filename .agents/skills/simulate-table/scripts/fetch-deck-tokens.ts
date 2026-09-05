#!/usr/bin/env bun

import { writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import {
  ROOT,
  cardFaces,
  chooseDeck,
  discoverDecks,
  loadManifest,
  readJson,
  type Deck,
} from "./deal-table.ts"

type Json = Record<string, any>

type TokenManifest = {
  schema: 1
  deck: string
  extras: string[]
  produced_by: Record<string, string[]>
  tokens: Record<string, Json>
}

type Options = {
  deckQueries: string[]
  refresh: boolean
  repo: string
}

const USER_AGENT = "commander-decks/1.0"
const COLLECTION_URL = "https://api.scryfall.com/cards/collection"
let lastRequestAt = 0

const sleep = (milliseconds: number) =>
  new Promise((done) => setTimeout(done, milliseconds))

const parseArgs = (args: string[]) => {
  const options: Options = {
    deckQueries: [],
    refresh: false,
    repo: ROOT,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = () => {
      const next = args[index + 1]
      if (!next) throw new Error(`${arg} needs a value`)
      index += 1
      return next
    }
    if (arg === "--refresh") options.refresh = true
    else if (arg === "--repo") options.repo = resolve(value())
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  bun run deck:tokens -- "Misty Critters"
  bun run deck:tokens

Read exact token relationships from the deck's cached Scryfall cards, fetch
the related token printings, and write decks/<deck>/tokens.json. A missing or
ambiguous deck name opens a numbered selection in an interactive terminal.

Options:
  --refresh     Fetch every token again
  --repo PATH   Repository root`)
      process.exit(0)
    } else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`)
    else options.deckQueries.push(arg)
  }
  return options
}

const fetchCollection = async (ids: string[], retry = true): Promise<Json[]> => {
  if (!ids.length) return []
  const wait = 100 - (Date.now() - lastRequestAt)
  if (wait > 0) await sleep(wait)
  const response = await fetch(COLLECTION_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ identifiers: ids.map((id) => ({ id })) }),
  })
  lastRequestAt = Date.now()
  if (response.status === 429 && retry) {
    const retryAfter = Number(response.headers.get("retry-after") ?? 1)
    await sleep(Math.max(1000, retryAfter * 1000))
    return fetchCollection(ids, false)
  }
  const payload = await response.json() as Json
  if (!response.ok || payload.object === "error") {
    throw new Error(payload.details || `Scryfall returned HTTP ${response.status}`)
  }
  if (payload.not_found?.length) {
    const missing = payload.not_found.map((item: Json) => item.id).join(", ")
    throw new Error(`Scryfall did not find token printing(s): ${missing}`)
  }
  return payload.data ?? []
}

const tokenEntry = (card: Json) => {
  const faces = cardFaces(card)
  return {
    id: card.id,
    name: card.name,
    type_line: card.type_line ?? "",
    oracle_text: card.oracle_text ?? "",
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    colors: card.colors ?? [],
    scryfall_uri: card.scryfall_uri ?? "",
    image_small: card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small ?? "",
    image_normal: card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? "",
    ...(faces ? { faces } : {}),
  }
}

const existingManifest = async (path: string): Promise<TokenManifest | undefined> => {
  try {
    const value = await readJson(path)
    return value.schema === 1 ? value : undefined
  } catch {
    return undefined
  }
}

const tokenRelationships = async (deck: Deck, repo: string) => {
  const { entries } = await loadManifest(deck.path)
  const producedBy: Record<string, string[]> = {}
  const extras: Record<string, Json> = {}

  for (const entry of entries) {
    if (typeof entry.cache !== "string") continue
    const card = await readJson(join(repo, entry.cache))
    const categories = entry.categories ?? []
    const outsideDeck = categories.some((category: string) => category.includes("{noDeck}"))
    const tokenExtra = categories.some((category: string) =>
      category.startsWith("Tokens & Extras"),
    )
    if (outsideDeck) {
      if (tokenExtra && card.layout === "token") extras[card.id] = tokenEntry(card)
      continue
    }
    const ids = (card.all_parts ?? [])
      .filter((part: Json) => part.component === "token" && typeof part.id === "string")
      .map((part: Json) => part.id as string)
    if (ids.length) producedBy[entry.name] = [...new Set(ids)]
  }
  return { extras, producedBy }
}

const fetchDeckTokens = async (deck: Deck, refresh: boolean, repo: string) => {
  const path = join(deck.path, "tokens.json")
  const previous = await existingManifest(path)
  const { extras, producedBy } = await tokenRelationships(deck, repo)
  const required = [
    ...new Set([...Object.values(producedBy).flat(), ...Object.keys(extras)]),
  ]
  const tokens: Record<string, Json> = refresh ? { ...extras } : {
    ...(previous?.tokens ?? {}),
    ...extras,
  }
  const missing = required.filter((id) => !tokens[id])

  for (let index = 0; index < missing.length; index += 75) {
    if (index) await sleep(100)
    const cards = await fetchCollection(missing.slice(index, index + 75))
    for (const card of cards) tokens[card.id] = tokenEntry(card)
  }

  const manifest: TokenManifest = {
    schema: 1,
    deck: deck.relativePath,
    extras: Object.keys(extras).sort(),
    produced_by: Object.fromEntries(
      Object.entries(producedBy).sort(([left], [right]) => left.localeCompare(right)),
    ),
    tokens: Object.fromEntries(
      required.sort().map((id) => {
        if (!tokens[id]) throw new Error(`missing fetched token ${id}`)
        return [id, tokens[id]]
      }),
    ),
  }
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
  return {
    fetched: missing.length,
    producers: Object.keys(producedBy).length,
    reused: required.length - missing.length,
    tokens: required.length,
  }
}

const main = async () => {
  const options = parseArgs(Bun.argv.slice(2))
  const available = await discoverDecks(options.repo)
  const queries: Array<string | undefined> = options.deckQueries.length
    ? options.deckQueries
    : [undefined]
  const selected: Deck[] = []

  for (const query of queries) {
    const deck = await chooseDeck(
      available.filter((candidate) => !selected.includes(candidate)),
      query,
    )
    selected.push(deck)
  }

  for (const deck of selected) {
    const result = await fetchDeckTokens(deck, options.refresh, options.repo)
    console.log(
      `${deck.title}: ${result.tokens} token printing(s) from ${result.producers} card(s); ` +
        `${result.fetched} fetched, ${result.reused} reused → ` +
        `${join(deck.relativePath, "tokens.json")}`,
    )
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  })
}
