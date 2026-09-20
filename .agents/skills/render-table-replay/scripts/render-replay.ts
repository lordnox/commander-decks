#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  CardDetails,
  CardFace,
  ReplayGame,
} from '../../../../site/src/replayTypes'

type Json = Record<string, any>

export const ROOT = resolve(import.meta.dir, '../../../..')
export const TABLE_GAMES = join(ROOT, 'table-games')
export const REPLAYS = join(ROOT, 'site/public/replays')

const sidecarSuffixes = [
  '.working.json',
  '.live.json',
  '.conduit.json',
  '.runner.json',
  '.kernel.json',
]
const ptPattern = /^[^/\s]+\/[^/\s]+$/
const turnSummaryPattern = /^\s*Turn\s+(\d+)\b/i
const schemas = new Set([1, 2])
const combatSteps = new Set([
  'attackers',
  'blockers',
  'first_strike_damage',
  'combat_damage',
])
const damageSteps = new Set(['first_strike_damage', 'combat_damage'])
const damageTypes = new Set(['combat', 'noncombat'])
const permanentTypePattern =
  /\b(Artifact|Battle|Creature|Enchantment|Land|Planeswalker)\b/

const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const pyString = (value: unknown) => {
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (value === null) return 'None'
  return String(value)
}

const pyRepr = (value: unknown) =>
  typeof value === 'string' ? `'${value}'` : pyString(value)

const normalizedName = (name: string) =>
  name.normalize('NFKD').toLocaleLowerCase().trim().replace(/\s+/g, ' ')

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8'))

const readJsonSync = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

const cachedFaces = (cache: Json): CardFace[] | undefined => {
  const faces = (Array.isArray(cache.card_faces) ? cache.card_faces : []).filter(
    (face: unknown) =>
      isJson(face) && isJson(face.image_uris) && face.image_uris.small,
  ) as Json[]
  if (faces.length < 2) return undefined
  return faces.map((face) => ({
    name: face.name || '',
    image_small: face.image_uris.small || '',
    image_normal: face.image_uris.normal || face.image_uris.small || '',
    type_line: face.type_line || '',
    mana_cost: face.mana_cost || '',
    oracle_text: face.oracle_text || '',
    stats:
      face.power !== undefined && face.power !== null
        ? `${face.power}/${face.toughness}`
        : String(face.defense || ''),
  }))
}

const backfillFaces = (catalog: Record<string, CardDetails>) => {
  const wanted = Object.entries(catalog)
    .filter(([name, entry]) => !entry.faces && name.includes(' // '))
    .map(([name]) => name)
  if (!wanted.length) return
  const index = readJsonSync(join(ROOT, 'cards/index.json'))
  if (!isJson(index) || !isJson(index.names)) return
  const aliases = new Map(
    Object.entries(index.names).map(([alias, oracleId]) => [
      normalizedName(alias),
      oracleId,
    ]),
  )
  for (const name of wanted) {
    const oracleId = aliases.get(normalizedName(name))
    if (typeof oracleId !== 'string') continue
    const cache = readJsonSync(join(ROOT, `cards/${oracleId}.json`))
    if (!isJson(cache)) continue
    const faces = cachedFaces(cache)
    if (faces) catalog[name].faces = faces
  }
}

const resolveName = (value: unknown, rows: Json[]) => {
  if (
    typeof value !== 'number' &&
    typeof value !== 'string' &&
    typeof value !== 'boolean'
  ) {
    return pyString(value)
  }
  const row =
    typeof value === 'number' && Number.isInteger(value) && value >= 0
      ? rows[value]
      : undefined
  if (
    isJson(row) &&
    (row.kind === 'card' || row.kind === 'player') &&
    row.name
  ) {
    return String(row.name)
  }
  return pyString(value)
}

const deckTokens = (deck: string) => {
  const data = readJsonSync(join(ROOT, deck, 'tokens.json'))
  return isJson(data) ? data : {}
}

const tokenPrinting = (
  name: string,
  data: Json,
  catalog: Record<string, CardDetails>,
): [string, Json] | undefined => {
  const entries = Object.entries(isJson(data.tokens) ? data.tokens : {}).filter(
    ([, entry]) =>
      isJson(entry) &&
      normalizedName(String(entry.name || '')) === normalizedName(name),
  ) as Array<[string, Json]>
  if (!entries.length) return undefined
  const sources = new Map<string, string[]>()
  for (const [card, tokenIds] of Object.entries(
    isJson(data.produced_by) ? data.produced_by : {},
  )) {
    for (const tokenId of Array.isArray(tokenIds) ? tokenIds : []) {
      if (
        typeof tokenId === 'string' &&
        entries.some(([entryId]) => entryId === tokenId)
      ) {
        sources.set(tokenId, [...(sources.get(tokenId) || []), card])
      }
    }
  }
  return entries.sort(([leftId], [rightId]) => {
    const rank = (tokenId: string): [number, string, string] => {
      const cards = [...(sources.get(tokenId) || [])].sort()
      const played = cards.filter((card) => card in catalog)
      return [played.length ? 0 : 1, (played[0] || cards[0] || ''), tokenId]
    }
    return rank(leftId).join('\0').localeCompare(rank(rightId).join('\0'))
  })[0]
}

const backfillTokens = (
  seats: Json[],
  events: Json[],
  catalog: Record<string, CardDetails>,
  tokens: Record<string, CardDetails>,
  rows: Json[],
) => {
  const decks = new Map(
    seats
      .filter((seat) => seat.deck)
      .map((seat) => [String(seat.id), String(seat.deck)]),
  )
  const files = new Map<string, Json>()
  const picks = new Map<string, string | undefined>()
  for (const event of events) {
    const players = isJson(event.state) && isJson(event.state.players)
      ? event.state.players
      : {}
    for (const [seatId, player] of Object.entries(players)) {
      const deck = decks.get(seatId)
      if (!isJson(player) || !deck) continue
      for (const entry of Array.isArray(player.battlefield)
        ? player.battlefield
        : []) {
        if (
          !isJson(entry) ||
          !entry.token ||
          entry.token_id ||
          !entry.name
        ) {
          continue
        }
        const name = resolveName(entry.name, rows)
        const key = `${seatId}\0${normalizedName(name)}`
        if (!picks.has(key)) {
          if (!files.has(deck)) files.set(deck, deckTokens(deck))
          const found = tokenPrinting(name, files.get(deck)!, catalog)
          picks.set(key, found?.[0])
          if (found && !(found[0] in tokens)) tokens[found[0]] = found[1]
        }
        const tokenId = picks.get(key)
        if (tokenId) entry.token_id = tokenId
      }
    }
  }
}

const referencedCards = (events: Json[], rows: Json[]) => {
  const names = new Set<string>()
  const tokenNames = new Set<string>()
  const tokenIds = new Set<string>()
  const add = (value: unknown) => names.add(resolveName(value, rows))
  for (const event of events) {
    for (const name of Array.isArray(event.cards) ? event.cards : []) add(name)
    const decision = isJson(event.decision) ? event.decision : {}
    for (const key of ['available', 'held']) {
      for (const name of Array.isArray(decision[key]) ? decision[key] : []) add(name)
    }
    const combat = isJson(event.combat) ? event.combat : {}
    for (const attacker of Array.isArray(combat.attackers) ? combat.attackers : []) {
      if (isJson(attacker) && attacker.card) add(attacker.card)
    }
    for (const name of Array.isArray(combat.unblocked) ? combat.unblocked : []) add(name)
    for (const block of Array.isArray(combat.blocks) ? combat.blocks : []) {
      if (!isJson(block)) continue
      if (block.attacker) add(block.attacker)
      for (const name of Array.isArray(block.blockers) ? block.blockers : []) add(name)
    }
    for (const entry of Array.isArray(event.damage) ? event.damage : []) {
      if (isJson(entry) && entry.source) add(entry.source)
    }
    const state = isJson(event.state) ? event.state : {}
    for (const item of Array.isArray(state.stack) ? state.stack : []) {
      if (isJson(item) && item.name) add(item.name)
    }
    const players = isJson(state.players) ? state.players : {}
    for (const player of Object.values(players)) {
      if (!isJson(player)) continue
      for (const zone of [
        'hand',
        'graveyard',
        'exile',
        'command',
        'revealed_top',
      ]) {
        for (const name of Array.isArray(player[zone]) ? player[zone] : []) add(name)
      }
      for (const entry of Array.isArray(player.battlefield)
        ? player.battlefield
        : []) {
        if (!isJson(entry) || !entry.name) continue
        add(entry.name)
        if (entry.token) {
          tokenNames.add(resolveName(entry.name, rows))
          if (typeof entry.token_id === 'string') tokenIds.add(entry.token_id)
        }
      }
    }
  }
  return { names, tokenNames, tokenIds }
}

const statePlayers = (event: Json) =>
  isJson(event.state) && isJson(event.state.players) ? event.state.players : {}

export const validateFaces = (
  events: Json[],
  catalog: Record<string, CardDetails>,
  tokens: Record<string, CardDetails>,
  rows: Json[],
) => {
  for (const event of events) {
    for (const player of Object.values(statePlayers(event))) {
      if (!isJson(player)) continue
      for (const entry of Array.isArray(player.battlefield)
        ? player.battlefield
        : []) {
        if (
          !isJson(entry) ||
          entry.face === undefined ||
          entry.face === null ||
          entry.face === ''
        ) {
          continue
        }
        const face = entry.face
        const name = resolveName(entry.name, rows)
        if (
          typeof face === 'boolean' ||
          (typeof face !== 'number' && typeof face !== 'string')
        ) {
          throw new Error(
            `event ${event.id}: ${name} face must be a face name or index`,
          )
        }
        const source =
          (typeof entry.token_id === 'string' ? tokens[entry.token_id] : undefined) ||
          catalog[name] ||
          {}
        const faces = source.faces || []
        if (!faces.length) continue
        if (typeof face === 'number') {
          if (!Number.isInteger(face) || face < 0 || face >= faces.length) {
            throw new Error(`event ${event.id}: ${name} has no face ${face}`)
          }
          continue
        }
        const known = new Set(faces.map((item) => normalizedName(item.name || '')))
        known.add('front')
        known.add('back')
        if (!known.has(normalizedName(face))) {
          throw new Error(`event ${event.id}: ${name} has no face ${pyRepr(face)}`)
        }
      }
    }
  }
}

const stackNames = (event: Json, rows: Json[]) =>
  (isJson(event.state) && Array.isArray(event.state.stack)
    ? event.state.stack
    : []
  )
    .filter((item: unknown) => isJson(item) && item.name)
    .map((item: Json) => resolveName(item.name, rows))

export const validateCastStacks = (events: Json[], rows: Json[]) => {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event.kind !== 'cast') continue
    const cards = Array.isArray(event.cards) ? event.cards : []
    if (!cards.length) throw new Error(`event ${event.id}: cast needs its spell in cards`)
    const spell = resolveName(cards[0], rows)
    if (!stackNames(event, rows).includes(spell)) {
      throw new Error(
        `event ${event.id}: cast of ${spell} must put it on state.stack`,
      )
    }
    let left = false
    for (const later of events.slice(index + 1)) {
      if (stackNames(later, rows).includes(spell)) continue
      const resolved = new Set(
        (Array.isArray(later.cards) ? later.cards : []).map((card) =>
          resolveName(card, rows),
        ),
      )
      if (!['move', 'resolve'].includes(later.kind) || !resolved.has(spell)) {
        throw new Error(
          `event ${later.id}: ${spell} left state.stack without its own resolve or move event`,
        )
      }
      left = true
      break
    }
    if (!left) {
      throw new Error(`event ${event.id}: cast of ${spell} never leaves state.stack`)
    }
  }
}

export const validateTriggerStacks = (events: Json[], rows: Json[]) => {
  for (const event of events) {
    if (event.kind !== 'trigger') continue
    const cards = Array.isArray(event.cards) ? event.cards : []
    if (!cards.length) {
      throw new Error(`event ${event.id}: trigger needs its source in cards`)
    }
    const source = resolveName(cards[0], rows)
    const stack =
      isJson(event.state) && Array.isArray(event.state.stack)
        ? event.state.stack
        : []
    const matching = stack.filter(
      (item: unknown) =>
        isJson(item) &&
        item.kind === 'trigger' &&
        resolveName(item.name, rows) === source,
    ) as Json[]
    if (!matching.length) {
      throw new Error(
        `event ${event.id}: ${source} trigger must appear on state.stack with kind trigger`,
      )
    }
    if (!matching.some((item) => String(item.text || '').trim())) {
      throw new Error(
        `event ${event.id}: ${source} trigger needs its ability text on state.stack`,
      )
    }
  }
}

export const validateTokenMetadata = (
  events: Json[],
  catalog: Record<string, CardDetails>,
  tokens: Record<string, CardDetails>,
  rows: Json[],
) => {
  const checked = new Set<string>()
  for (const event of events) {
    for (const player of Object.values(statePlayers(event))) {
      if (!isJson(player)) continue
      for (const entry of Array.isArray(player.battlefield)
        ? player.battlefield
        : []) {
        if (!isJson(entry) || !entry.token) continue
        const name = resolveName(entry.name, rows)
        const tokenId =
          typeof entry.token_id === 'string' ? entry.token_id : undefined
        const key = `${name}\0${tokenId || ''}`
        if (checked.has(key)) continue
        checked.add(key)
        const source = tokenId ? tokens[tokenId] : catalog[name]
        const typeLine = source?.type_line || ''
        if (!permanentTypePattern.test(typeLine)) {
          const reference = tokenId ? `token_id ${tokenId}` : 'catalog name'
          throw new Error(
            `event ${event.id}: ${name} token's ${reference} does not resolve to permanent type metadata`,
          )
        }
      }
    }
  }
}

const validateTurnDraws = (events: Json[]) => {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event.phase !== 'untap' || Number(event.turn || 0) < 1) continue
    const window = events.slice(index + 1)
    const found = window.findIndex((item) => item.phase === 'untap')
    const turnEvents = window
      .slice(0, found < 0 ? window.length : found)
      .filter(
        (item) =>
          item.seat === event.seat &&
          item.turn === event.turn &&
          item.phase !== 'upkeep',
      )
    const first = turnEvents[0] || {}
    if (first.phase !== 'draw' || first.kind !== 'draw') {
      throw new Error(
        `turn ${event.turn} ${event.seat}: untap is not immediately followed by a normal draw event`,
      )
    }
  }
}

const battlefieldEntry = (event: Json, name: string, rows: Json[]) => {
  const player = statePlayers(event)[String(event.seat)]
  if (!isJson(player)) return undefined
  const matches = (Array.isArray(player.battlefield) ? player.battlefield : []).filter(
    (entry: unknown) =>
      isJson(entry) && resolveName(entry.name, rows) === name,
  ) as Json[]
  return matches.length === 1 ? matches[0] : undefined
}

const isCombatDamage = (event: Json) => {
  if (isJson(event.combat) && damageSteps.has(event.combat.step)) return true
  return (Array.isArray(event.damage) ? event.damage : []).some(
    (entry: unknown) => isJson(entry) && entry.type === 'combat',
  )
}

const validateCombatShape = (event: Json, rows: Json[]) => {
  const eventId = event.id
  if (event.combat !== undefined && event.combat !== null) {
    if (!isJson(event.combat)) {
      throw new Error(`event ${eventId}: combat must be an object`)
    }
    const combat = event.combat
    if (combat.step !== undefined && !combatSteps.has(combat.step)) {
      throw new Error(
        `event ${eventId}: combat step ${pyRepr(combat.step)} is not one of ${[...combatSteps].sort().join(', ')}`,
      )
    }
    for (const attacker of Array.isArray(combat.attackers)
      ? combat.attackers
      : []) {
      if (!isJson(attacker) || !attacker.card) {
        throw new Error(`event ${eventId}: an attacker is missing its card`)
      }
      const name = resolveName(attacker.card, rows)
      if (!attacker.defender) {
        throw new Error(`event ${eventId}: ${name} attacks no defender`)
      }
      const entry = battlefieldEntry(event, name, rows)
      if (!entry || attacker.tapped === undefined || attacker.tapped === null) {
        continue
      }
      if (Boolean(entry.tapped) !== Boolean(attacker.tapped)) {
        throw new Error(
          `event ${eventId}: ${name} declares tapped=${pyString(Boolean(attacker.tapped))} but its snapshot says tapped=${pyString(Boolean(entry.tapped))}`,
        )
      }
    }
    for (const block of Array.isArray(combat.blocks) ? combat.blocks : []) {
      if (!isJson(block) || !block.attacker) {
        throw new Error(`event ${eventId}: a block names no attacker`)
      }
      if (!Array.isArray(block.blockers) || !block.blockers.length) {
        throw new Error(
          `event ${eventId}: the block on ${resolveName(block.attacker, rows)} names no blockers`,
        )
      }
    }
  }
  if (event.damage === undefined || event.damage === null) return
  if (!Array.isArray(event.damage) || !event.damage.length) {
    throw new Error(`event ${eventId}: damage must be a non-empty list`)
  }
  for (const entry of event.damage) {
    if (!isJson(entry)) {
      throw new Error(`event ${eventId}: each damage entry must be an object`)
    }
    if (!damageTypes.has(entry.type)) {
      throw new Error(
        `event ${eventId}: damage from ${resolveName(entry.source, rows)} needs type "combat" or "noncombat"`,
      )
    }
    if (!entry.source || !entry.target) {
      throw new Error(`event ${eventId}: a damage entry needs source and target`)
    }
    if (
      typeof entry.amount !== 'number' ||
      !Number.isInteger(entry.amount)
    ) {
      throw new Error(`event ${eventId}: a damage entry needs an integer amount`)
    }
  }
}

const playerCardNames = (player: Json, rows: Json[], zones: string[]) => {
  const names: string[] = []
  for (const zone of zones) {
    for (const item of Array.isArray(player[zone]) ? player[zone] : []) {
      names.push(resolveName(item, rows))
    }
  }
  for (const entry of Array.isArray(player.battlefield) ? player.battlefield : []) {
    if (isJson(entry) && entry.name) names.push(resolveName(entry.name, rows))
  }
  return names
}

const validateCommandersPresent = (
  seats: Json[],
  events: Json[],
  rows: Json[],
) => {
  const last = events.at(-1)!
  const players = statePlayers(last)
  for (const seat of seats) {
    const player = players[String(seat.id)]
    if (!isJson(player) || Number(player.life || 0) <= 0) continue
    for (const commander of Array.isArray(seat.commanders)
      ? seat.commanders
      : []) {
      const target = normalizedName(String(commander))
      const found = Object.values(players).some(
        (other) =>
          isJson(other) &&
          playerCardNames(
            other,
            rows,
            ['hand', 'graveyard', 'exile', 'command'],
          ).some((name) => normalizedName(name) === target),
      )
      if (!found) {
        throw new Error(
          `event ${last.id}: ${seat.id} is missing ${commander} from every zone`,
        )
      }
    }
  }
}

const oracleAllowsTappedEntry = (
  catalog: Record<string, CardDetails>,
  name: string,
) => {
  const entry = catalog[name] || {}
  const text = `${entry.oracle_text || ''} ${(entry.faces || []).map((face) => face.oracle_text || '').join(' ')}`.toLocaleLowerCase()
  return (
    text.includes('enters tapped') ||
    text.includes('enters the battlefield tapped')
  )
}

const namedBattlefield = (player: Json, name: string, rows: Json[]) => {
  const target = normalizedName(name)
  return (Array.isArray(player.battlefield) ? player.battlefield : []).filter(
    (entry: unknown) =>
      isJson(entry) &&
      normalizedName(resolveName(entry.name, rows)) === target,
  ) as Json[]
}

export const validateEnterUntapped = (
  events: Json[],
  catalog: Record<string, CardDetails>,
  rows: Json[],
) => {
  for (let index = 1; index < events.length; index += 1) {
    const event = events[index]
    if (!['cast', 'play_land'].includes(event.kind)) continue
    const previousPlayer = statePlayers(events[index - 1])[String(event.seat)]
    const currentPlayer = statePlayers(event)[String(event.seat)]
    const previous = isJson(previousPlayer) ? previousPlayer : {}
    const current = isJson(currentPlayer) ? currentPlayer : {}
    for (const card of Array.isArray(event.cards) ? event.cards : []) {
      const name = resolveName(card, rows)
      if (oracleAllowsTappedEntry(catalog, name)) continue
      const previousTapped = namedBattlefield(previous, name, rows).filter(
        (entry) => entry.tapped,
      ).length
      const currentTapped = namedBattlefield(current, name, rows).filter(
        (entry) => entry.tapped,
      ).length
      if (currentTapped > previousTapped) {
        throw new Error(
          `event ${event.id}: ${name} entered tapped, but its Oracle text does not let it enter tapped`,
        )
      }
    }
  }
}

const isLandName = (catalog: Record<string, CardDetails>, name: string) => {
  const entry = catalog[name] || {}
  return (
    (entry.type_line || '').includes('Land') ||
    (entry.faces || []).some((face) => (face.type_line || '').includes('Land'))
  )
}

export const validateOpenMana = (
  events: Json[],
  catalog: Record<string, CardDetails>,
  rows: Json[],
) => {
  for (const event of events) {
    const decision = isJson(event.decision) ? event.decision : {}
    if (!('open_mana' in decision) || !Number.isInteger(decision.open_mana)) {
      continue
    }
    const player = statePlayers(event)[String(event.seat)]
    if (!isJson(player)) continue
    const lands = (Array.isArray(player.battlefield) ? player.battlefield : []).filter(
      (entry: unknown) =>
        isJson(entry) &&
        !entry.tapped &&
        isLandName(catalog, resolveName(entry.name, rows)),
    ).length
    if (lands >= 3 && decision.open_mana + 2 < lands) {
      throw new Error(
        `event ${event.id}: decision.open_mana is ${decision.open_mana} but the snapshot has ${lands} untapped lands`,
      )
    }
  }
}

export const validateTurnLabels = (events: Json[]) => {
  for (const event of events) {
    if (event.phase !== 'untap') continue
    const match = turnSummaryPattern.exec(String(event.summary || ''))
    if (match && Number(match[1]) !== event.turn) {
      throw new Error(
        `event ${event.id}: untap summary says turn ${match[1]} but event.turn is ${event.turn}`,
      )
    }
  }
}

const publicCardNames = (state: Json, rows: Json[]) => {
  const names = new Set<string>()
  for (const item of Array.isArray(state.stack) ? state.stack : []) {
    if (isJson(item) && item.name) names.add(resolveName(item.name, rows))
  }
  const players = isJson(state.players) ? state.players : {}
  for (const player of Object.values(players)) {
    if (!isJson(player)) continue
    for (const name of playerCardNames(
      player,
      rows,
      ['graveyard', 'exile', 'command', 'revealed_top'],
    )) {
      names.add(name)
    }
  }
  return new Set([...names].map(normalizedName))
}

const hiddenHandNames = (state: Json, seat: unknown, rows: Json[]) => {
  const names = new Set<string>()
  const players = isJson(state.players) ? state.players : {}
  for (const [otherId, player] of Object.entries(players)) {
    if (otherId === seat || !isJson(player)) continue
    for (const card of Array.isArray(player.hand) ? player.hand : []) {
      names.add(resolveName(card, rows))
    }
  }
  return new Set([...names].map(normalizedName))
}

const mentionedCatalogNames = (
  originalText: string,
  catalog: Record<string, CardDetails>,
) => {
  const found: string[] = []
  let text = originalText
  for (const name of Object.keys(catalog).sort((left, right) => right.length - left.length)) {
    if (!name) continue
    const pattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    if (pattern.test(text)) {
      found.push(name)
      text = text.replace(new RegExp(pattern.source, 'gi'), ' ')
    }
  }
  return found
}

const planText = (event: Json) => {
  const plan = isJson(event.plan) ? event.plan : {}
  return [
    plan.summary || '',
    plan.details || '',
    Array.isArray(plan.steps) ? plan.steps.join(' ') : '',
  ].join(' ')
}

const validateHiddenReasons = (
  events: Json[],
  catalog: Record<string, CardDetails>,
  rows: Json[],
) => {
  for (const event of events) {
    const decision = isJson(event.decision) ? event.decision : {}
    const reason = [decision.reason || '', event.notes || '', planText(event)].join(' ')
    if (!reason.trim()) continue
    const state = isJson(event.state) ? event.state : {}
    const publicNames = publicCardNames(state, rows)
    const hidden = hiddenHandNames(state, event.seat, rows)
    const ownPlayer =
      isJson(state.players) && isJson(state.players[String(event.seat)])
        ? state.players[String(event.seat)]
        : {}
    const ownHand = new Set(
      (Array.isArray(ownPlayer.hand) ? ownPlayer.hand : []).map((card: unknown) =>
        normalizedName(resolveName(card, rows)),
      ),
    )
    for (const name of mentionedCatalogNames(reason, catalog)) {
      const key = normalizedName(name)
      if ((catalog[name]?.type_line || '').includes('Basic Land')) continue
      if (hidden.has(key) && !publicNames.has(key) && !ownHand.has(key)) {
        throw new Error(`event ${event.id}: ${event.seat} cited hidden card ${name}`)
      }
    }
  }
}

const cardNames = (items: unknown[], rows: Json[]) =>
  new Set(
    items
      .map((item) => resolveName(item, rows))
      .filter(Boolean)
      .map(normalizedName),
  )

const planAllowsUnknownName = (text: string, name: string) => {
  let start = 0
  const folded = text.toLocaleLowerCase()
  const target = name.toLocaleLowerCase()
  while (folded.indexOf(target, start) >= 0) {
    const index = folded.indexOf(target, start)
    const context = folded.slice(
      Math.max(0, index - 60),
      index + target.length + 40,
    )
    if (
      /\b(search|tutor|find|fetch|draw into|topdeck|play around|usual|win condition)\b|\bif (?:i |we )?draw\b|\bif .{0,30} is drawn\b|\bhope to draw\b/.test(
        context,
      )
    ) {
      return true
    }
    start = index + target.length
  }
  return false
}

const mentionsCardName = (text: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'i').test(text)
}

export const validatePlanDrawKnowledge = (
  events: Json[],
  catalog: Record<string, CardDetails>,
  rows: Json[],
) => {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    const plan = isJson(event.plan) ? event.plan : {}
    const text = planText(event)
    if (!text || !['turn', 'impact'].includes(plan.scope)) continue
    if (plan.scope === 'turn') {
      const draw = events
        .slice(index + 1)
        .find(
          (candidate) =>
            candidate.kind === 'draw' && candidate.seat === event.seat,
        )
      if (!draw) continue
      const drawn = (Array.isArray(draw.cards) ? draw.cards : [])
        .map((item) => resolveName(item, rows))
        .filter(Boolean)
      const state = isJson(event.state) ? event.state : {}
      const player =
        isJson(state.players) && isJson(state.players[String(event.seat)])
          ? state.players[String(event.seat)]
          : {}
      const known = publicCardNames(state, rows)
      for (const name of cardNames(
        [
          ...(Array.isArray(player.hand) ? player.hand : []),
          ...(Array.isArray(player.revealed_top) ? player.revealed_top : []),
        ],
        rows,
      )) {
        known.add(name)
      }
      for (const name of drawn) {
        if (
          mentionsCardName(text, name) &&
          !known.has(normalizedName(name)) &&
          !planAllowsUnknownName(text, name)
        ) {
          throw new Error(
            `event ${event.id}: turn plan knew unrevealed next draw ${name}`,
          )
        }
      }
    }
    if (plan.scope === 'impact' && index) {
      const draw = events[index - 1]
      if (
        draw.kind !== 'draw' ||
        draw.seat !== event.seat ||
        draw.turn !== event.turn
      ) {
        continue
      }
      const actual = new Set(
        (Array.isArray(draw.cards) ? draw.cards : []).map((item) =>
          resolveName(item, rows),
        ),
      )
      const claimed = mentionedCatalogNames(text, catalog).filter((name) =>
        text.toLocaleLowerCase().includes(`drew ${name}`.toLocaleLowerCase()),
      )
      const wrong = claimed.filter((name) => !actual.has(name)).sort()
      if (wrong.length) {
        throw new Error(
          `event ${event.id}: impact plan says it drew ${wrong.join(', ')}, but the preceding draw was ${[...actual].sort().join(', ') || 'unnamed'}`,
        )
      }
    }
  }
}

export const validatePlans = (
  events: Json[],
  seatIds: Set<string>,
  required: boolean,
) => {
  for (const event of events) {
    if (event.plan === undefined || event.plan === null) continue
    if (event.kind !== 'think') {
      throw new Error(`event ${event.id}: plan payload requires kind think`)
    }
    if (!seatIds.has(event.seat)) {
      throw new Error(`event ${event.id}: plan needs a seat`)
    }
    if (!isJson(event.plan)) {
      throw new Error(`event ${event.id}: plan must be an object`)
    }
    const plan = event.plan
    if (!['game', 'turn', 'impact'].includes(plan.scope)) {
      throw new Error(`event ${event.id}: plan scope must be game, turn, or impact`)
    }
    if (typeof plan.summary !== 'string' || !plan.summary.trim()) {
      throw new Error(`event ${event.id}: plan needs a summary`)
    }
    const expectedPhase = plan.scope === 'impact' ? 'impact' : 'planning'
    if (event.phase !== expectedPhase) {
      throw new Error(
        `event ${event.id}: ${plan.scope} plan must use phase ${expectedPhase}`,
      )
    }
    const statuses =
      plan.scope === 'impact' ? new Set(['kept', 'revised']) : new Set(['set'])
    if (!statuses.has(plan.status)) {
      throw new Error(
        `event ${event.id}: ${plan.scope} plan status must be ${[...statuses].sort().join(' or ')}`,
      )
    }
    if (
      plan.steps !== undefined &&
      (!Array.isArray(plan.steps) ||
        plan.steps.some(
          (step: unknown) => typeof step !== 'string' || !step.trim(),
        ))
    ) {
      throw new Error(`event ${event.id}: plan steps must be non-empty strings`)
    }
  }
  if (!required) return
  const firstTurn = events.findIndex((event) => Number(event.turn || 0) > 0)
  const pregame = events.slice(0, firstTurn < 0 ? events.length : firstTurn)
  const gamePlans = new Set(
    pregame
      .filter((event) => isJson(event.plan) && event.plan.scope === 'game')
      .map((event) => event.seat),
  )
  const missing = [...seatIds].filter((seat) => !gamePlans.has(seat)).sort()
  if (missing.length) {
    throw new Error(`planning: missing pregame plan for ${missing.join(', ')}`)
  }
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event.phase === 'untap' && Number(event.turn || 0) > 0) {
      const previous = events[index - 1] || {}
      if (
        previous.seat !== event.seat ||
        previous.turn !== event.turn ||
        !isJson(previous.plan) ||
        previous.plan.scope !== 'turn'
      ) {
        throw new Error(
          `event ${event.id}: untap needs an immediately preceding turn plan`,
        )
      }
    }
    if (event.kind === 'draw') {
      const following = events[index + 1] || {}
      if (
        following.seat !== event.seat ||
        following.turn !== event.turn ||
        !isJson(following.plan) ||
        following.plan.scope !== 'impact'
      ) {
        throw new Error(
          `event ${event.id}: draw needs an immediately following impact plan`,
        )
      }
    }
  }
}

const validateCombatFlow = (
  events: Json[],
  seatIds: Set<string>,
  rows: Json[],
) => {
  let attack: Json = {}
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event.kind === 'damage') {
      if (!event.damage) {
        throw new Error(`event ${event.id}: a damage event needs typed damage entries`)
      }
      if (
        isCombatDamage(event) &&
        !events
          .slice(0, index)
          .some(
            (item) =>
              item.kind === 'attack' && item.turn === event.turn,
          )
      ) {
        throw new Error(
          `event ${event.id}: combat damage without a declared attack`,
        )
      }
      continue
    }
    if (event.kind === 'block') {
      const blocks = isJson(event.combat) ? event.combat.blocks : undefined
      const possible =
        isJson(attack.combat) && isJson(attack.combat.possible_blockers)
          ? attack.combat.possible_blockers
          : {}
      const couldBlock = possible[String(event.seat)] ?? true
      const hadLegalBlock = Array.isArray(couldBlock)
        ? couldBlock.length > 0
        : Boolean(couldBlock)
      const decision = isJson(event.decision) ? event.decision : {}
      if (
        (!Array.isArray(blocks) || !blocks.length) &&
        hadLegalBlock &&
        !decision.reason
      ) {
        throw new Error(
          `event ${event.id}: declining to block needs decision.reason`,
        )
      }
      continue
    }
    if (event.kind !== 'attack') continue
    attack = event
    const attackers = isJson(event.combat) ? event.combat.attackers : undefined
    if (!Array.isArray(attackers) || !attackers.length) {
      throw new Error(`event ${event.id}: an attack needs combat.attackers`)
    }
    const defenders = new Set(
      attackers
        .filter(
          (attacker: unknown) =>
            isJson(attacker) && seatIds.has(attacker.defender),
        )
        .map((attacker: Json) => attacker.defender),
    )
    const answered = new Set<string>()
    for (const item of events.slice(index + 1)) {
      if (item.turn !== event.turn || item.kind === 'attack') break
      if (item.kind === 'block') answered.add(String(item.seat))
      if (item.kind === 'damage' && isCombatDamage(item)) break
    }
    const silent = [...defenders].filter((seat) => !answered.has(seat)).sort()
    if (silent.length) {
      throw new Error(`event ${event.id}: ${silent.join(', ')} never declared blockers`)
    }
  }
}

const validateTopLevelShape = (
  value: unknown,
): value is Json & {
  seats: Json[]
  events: Json[]
  catalog: Record<string, CardDetails>
} => {
  if (!isJson(value)) throw new Error('replay JSON must be an object')
  if (!schemas.has(value.schema)) {
    throw new Error('replay JSON must set schema to 1 or 2')
  }
  if (!Array.isArray(value.seats) || value.seats.length !== 4) {
    throw new Error('replay JSON needs exactly four seats')
  }
  if (!Array.isArray(value.events) || !value.events.length) {
    throw new Error('replay JSON needs a non-empty events list')
  }
  return true
}

export const publicGame = (game: unknown, options: { strict?: boolean } = {}): ReplayGame => {
  validateTopLevelShape(game)
  const strict = options.strict ?? false
  const cleaned = structuredClone(game) as Json & {
    seats: Json[]
    events: Json[]
    catalog: Record<string, CardDetails>
  }
  delete cleaned._libraries
  const seats = cleaned.seats
  const events = cleaned.events
  const expectedIds = events.map((_, index) => index)
  const actualIds = events.map((event) => isJson(event) ? event.id : undefined)
  if (
    actualIds.length !== expectedIds.length ||
    actualIds.some((id, index) => id !== expectedIds[index])
  ) {
    throw new Error('event IDs must be contiguous integers starting at zero')
  }
  for (const event of events) {
    if (!isJson(event)) throw new Error('event None is missing a state snapshot')
    const state = event.state
    if (!isJson(state) || !('players' in state)) {
      throw new Error(`event ${pyRepr(event.id)} is missing a state snapshot`)
    }
    if (state.turn !== event.turn) {
      throw new Error(`event ${event.id}: state turn does not match event`)
    }
    if (state.phase !== event.phase) {
      throw new Error(`event ${event.id}: state phase does not match event`)
    }
    if (!isJson(state.players)) {
      throw new Error(`event ${pyRepr(event.id)} is missing a state snapshot`)
    }
    for (const player of Object.values(state.players)) {
      if (!isJson(player)) continue
      if ('library' in player) {
        throw new Error('do not put remaining library cards in state snapshots')
      }
      const top = Array.isArray(player.revealed_top) ? player.revealed_top : []
      if (top.length > Number(player.library_count || 0)) {
        throw new Error(
          `event ${event.id}: revealed_top holds more cards than the library`,
        )
      }
      for (const entry of Array.isArray(player.battlefield)
        ? player.battlefield
        : []) {
        if (!isJson(entry) || entry.pt === undefined || entry.pt === null) continue
        if (!ptPattern.test(String(entry.pt))) {
          throw new Error(
            `event ${event.id}: ${entry.name ?? '?'} has pt ${pyRepr(entry.pt)}; use "power/toughness"`,
          )
        }
      }
    }
    if (state.deals !== undefined && !Array.isArray(state.deals)) {
      throw new Error(`event ${event.id}: state.deals must be a list`)
    }
  }
  const references = cleaned.references
  if (references !== undefined && references !== null) {
    if (!Array.isArray(references)) throw new Error('references must be a list')
    const seenSeats = new Set(seats.map((seat) => isJson(seat) ? seat.id : undefined))
    references.forEach((row, index) => {
      if (!isJson(row) || !row.kind) {
        throw new Error(`references[${index}] needs kind`)
      }
      if (row.kind === 'card' && !row.name) {
        throw new Error(`references[${index}] card needs a name`)
      }
      if (row.kind === 'player') {
        if (!row.name) throw new Error(`references[${index}] player needs a name`)
        if (!seenSeats.has(row.seat)) {
          throw new Error(`references[${index}] player seat is not a seat id`)
        }
      }
      if (row.kind === 'deal' && !row.terms) {
        throw new Error(`references[${index}] deal needs terms`)
      }
    })
  }
  validateTurnDraws(events)
  const rows = Array.isArray(references) ? references : []
  const seatIds = new Set(
    seats.filter(isJson).map((seat) => String(seat.id)),
  )
  validatePlans(events, seatIds, cleaned.planning === 1 && strict)
  for (const event of events) validateCombatShape(event, rows)
  if (cleaned.schema >= 2) {
    validateCombatFlow(events, seatIds, rows)
    const earlyCatalog = isJson(cleaned.catalog) ? cleaned.catalog : {}
    validateCommandersPresent(seats, events, rows)
    if (strict) {
      validateTurnLabels(events)
      validateCastStacks(events, rows)
      validateTriggerStacks(events, rows)
      validateEnterUntapped(events, earlyCatalog, rows)
      validateOpenMana(events, earlyCatalog, rows)
      validateHiddenReasons(events, earlyCatalog, rows)
      if (cleaned.planning === 1) {
        validatePlanDrawKnowledge(events, earlyCatalog, rows)
      }
    }
  }
  if (!isJson(cleaned.catalog)) {
    throw new Error('replay JSON needs a card catalog')
  }
  const catalog = cleaned.catalog as Record<string, CardDetails>
  const tokens = isJson(cleaned.tokens)
    ? { ...cleaned.tokens } as Record<string, CardDetails>
    : {}
  backfillTokens(seats, events, catalog, tokens, rows)
  const { names, tokenNames, tokenIds } = referencedCards(events, rows)
  const missing = [...names]
    .filter((name) => !(name in catalog) && !tokenNames.has(name))
    .sort()
  if (missing.length) {
    throw new Error(`catalog is missing referenced cards: ${missing.join(', ')}`)
  }
  cleaned.catalog = Object.fromEntries(
    Object.entries(catalog)
      .filter(([name]) => names.has(name))
      .map(([name, entry]) => [name, isJson(entry) ? { ...entry } : entry]),
  )
  backfillFaces(cleaned.catalog)
  const missingTokens = [...tokenIds]
    .filter((tokenId) => !(tokenId in tokens))
    .sort()
  if (missingTokens.length) {
    throw new Error(
      `token catalog is missing referenced IDs: ${missingTokens.join(', ')}`,
    )
  }
  cleaned.tokens = Object.fromEntries(
    Object.entries(tokens).filter(([tokenId]) => tokenIds.has(tokenId)),
  )
  if (strict) {
    validateTokenMetadata(events, cleaned.catalog, cleaned.tokens, rows)
  }
  validateFaces(events, cleaned.catalog, cleaned.tokens, rows)
  return cleaned as ReplayGame
}

export const replayPaths = async (explicit: string[]) => {
  if (explicit.length) {
    return explicit.map((path) => {
      const candidate = isAbsolute(path) ? path : join(ROOT, path)
      if (!existsSync(candidate)) throw new Error(`replay not found: ${path}`)
      return resolve(candidate)
    })
  }
  const glob = new Bun.Glob('*.json')
  const paths: string[] = []
  for await (const name of glob.scan({ cwd: TABLE_GAMES, onlyFiles: true })) {
    if (!sidecarSuffixes.some((suffix) => name.endsWith(suffix))) {
      paths.push(join(TABLE_GAMES, name))
    }
  }
  return paths.sort()
}

export const renderFile = async (
  log: string,
  out?: string,
  options: { strict?: boolean } = {},
) => {
  const game = await readJson(log)
  const payload = JSON.stringify(publicGame(game, options))
  const target =
    out || join(REPLAYS, `${basename(log, '.json')}.json`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, payload, 'utf8')
  const fromRoot = relative(ROOT, target)
  return fromRoot.startsWith('..') || isAbsolute(fromRoot) ? target : fromRoot
}

type Options = {
  logs: string[]
  out?: string
  strict: boolean
}

const usage = `usage: render-replay.ts [-h] [--out OUT] [--strict] [logs ...]

Validate replay JSON and write site/public/replays/<slug>.json for the React
player. With no paths, rebuild every finished table-games/*.json file.

positional arguments:
  logs         Replay JSON paths. Default: table-games/*.json except
               *.working.json.

options:
  -h, --help   show this help message and exit
  --out OUT    JSON path. Default site/public/replays/<slug>.json; only valid
               for a single replay.
  --strict     Also reject illegal ETB taps, impossible open_mana, and hidden
               cards named in another seat's reason. Required for a new
               simulate-table recording.`

const parseArgs = (args: string[]) => {
  const options: Options = { logs: [], strict: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--strict') options.strict = true
    else if (arg === '--out') {
      index += 1
      if (index >= args.length) throw new Error('argument --out: expected one argument')
      options.out = args[index]
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage)
      process.exit(0)
    } else if (arg.startsWith('-')) {
      throw new Error(`unrecognized arguments: ${arg}`)
    } else options.logs.push(arg)
  }
  return options
}

export const main = async (args = Bun.argv.slice(2)) => {
  let options: Options
  try {
    options = parseArgs(args)
  } catch (error) {
    console.error(`ERROR: ${(error as Error).message}`)
    return 1
  }
  if (options.out && options.logs.length !== 1) {
    console.error('ERROR: --out requires exactly one replay path')
    return 1
  }
  let paths: string[]
  try {
    paths = await replayPaths(options.logs)
  } catch (error) {
    console.error(`ERROR: ${(error as Error).message}`)
    return 1
  }
  if (!paths.length) {
    console.error('ERROR: no replay JSON found under table-games/')
    return 1
  }
  let failed = 0
  for (const log of paths) {
    try {
      console.log(
        await renderFile(
          log,
          options.out
            ? isAbsolute(options.out)
              ? options.out
              : join(process.cwd(), options.out)
            : undefined,
          { strict: options.strict },
        ),
      )
    } catch (error) {
      console.error(`ERROR: ${log}: ${(error as Error).message}`)
      failed += 1
    }
  }
  return failed ? 1 : 0
}

if (import.meta.main) process.exit(await main())
