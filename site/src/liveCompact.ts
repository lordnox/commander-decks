import type { BattlefieldCard, CardDetails, CombatAttacker, ReplayCombat } from './replayTypes'
import type { LiveSeat, LiveSnapshot } from './liveCodec'

export type DeckCard = {
  n: string
  id?: string
  a?: string[]
}

export type DeckIndex = {
  cards: DeckCard[]
}

export type LiveWireV2 = {
  v: 2
  y?: number
  h: string
  w?: string
  k?: string
  t: number
  p: number
  a: number
  d?: string[]
  n: string[]
  c?: string[]
  x?: string[]
  g?: Record<string, CardDetails>
  o?: Array<[string, CardDetails]>
  z: unknown[]
  s?: unknown[]
  m?: Record<string, unknown>
}

export const SEAT_IDS = ['p1', 'p2', 'p3', 'p4'] as const
export const SEAT_COLORS = ['#c45c26', '#2f6f64', '#4a5d9e', '#8a3d6b']
export const STRIDE = 128
export const EXTRA_DECK = 4
export const TOKEN_DECK = 5
export const PHASES = [
  'setup',
  'planning',
  'untap',
  'upkeep',
  'draw',
  'impact',
  'main1',
  'combat',
  'main2',
  'end',
  'priority',
] as const
export const COMBAT_STEPS = [
  'attackers',
  'blockers',
  'first_strike_damage',
  'combat_damage',
] as const
export const DEFAULT_WAITING = 'Would this line work? Confirm or replace it.'
const FLAG_TAPPED = 1
const FLAG_TOKEN = 2
const FLAG_COMMANDER = 4
const HIDDEN = 0
const ABSENT = 0

const normalize = (name: string) => name.toLowerCase().split(/\s+/).join(' ')

const deckSlug = (path?: string) => {
  if (!path) return ''
  const parts = path.split('/').filter(Boolean)
  return parts.at(-1) ?? ''
}

const asName = (value: unknown): string | null => {
  if (typeof value === 'string' && value) return value
  if (value && typeof value === 'object' && 'name' in value) {
    const name = (value as { name?: unknown }).name
    if (typeof name === 'string' && name) return name
  }
  return null
}

const cardNames = (card: DeckCard) => [card.n, ...(card.a ?? [])].filter(Boolean)

const aliasesFor = (cards: DeckCard[]) => {
  const lookup = new Map<string, number>()
  cards.forEach((card, index) => {
    cardNames(card).forEach((name) => {
      const key = normalize(name)
      if (!lookup.has(key)) lookup.set(key, index)
    })
  })
  return lookup
}

export const catalogFromIndexes = (
  slugs: string[],
  indexes: Record<string, DeckIndex>,
  extras?: Record<string, CardDetails>,
) => {
  const catalog: Record<string, CardDetails> = {}
  slugs.forEach((slug) => {
    indexes[slug]?.cards.forEach((card) => {
      const details = card.id ? { id: card.id.toLowerCase() } : {}
      cardNames(card).forEach((name) => {
        if (!(name in catalog)) catalog[name] = { ...details }
      })
    })
  })
  return extras ? { ...catalog, ...extras } : catalog
}

const createTable = (slugs: string[], indexes: Record<string, DeckIndex>) => {
  const lists = slugs.map((slug) => indexes[slug]?.cards ?? [])
  const lookups = lists.map(aliasesFor)
  const extras: string[] = []
  const tokens: Array<[string, CardDetails]> = []

  const cardRef = (value: unknown, prefer: number) => {
    const name = asName(value)
    if (!name) return value
    const key = normalize(name)
    const order = [prefer, ...slugs.map((_, index) => index).filter((index) => index !== prefer)]
    for (const deck of order) {
      const slot = lookups[deck]?.get(key)
      if (slot !== undefined) return deck * STRIDE + slot
    }
    if (!extras.includes(name)) extras.push(name)
    return EXTRA_DECK * STRIDE + extras.indexOf(name)
  }

  const tokenRef = (tokenId: string, details: CardDetails) => {
    const existing = tokens.findIndex(([key]) => key === tokenId)
    if (existing >= 0) return TOKEN_DECK * STRIDE + existing
    tokens.push([tokenId, details])
    return TOKEN_DECK * STRIDE + tokens.length - 1
  }

  return { lists, extras, tokens, cardRef, tokenRef }
}

const packFlags = (entry: BattlefieldCard) => {
  let flags = 0
  if (entry.tapped) flags |= FLAG_TAPPED
  if (entry.token) flags |= FLAG_TOKEN
  if (entry.commander) flags |= FLAG_COMMANDER
  return flags
}

const packExtra = (entry: BattlefieldCard) => {
  const extra: Record<string, unknown> = {}
  if (entry.pt) extra.p = entry.pt
  if (entry.note) extra.n = entry.note
  if (entry.counters && Object.keys(entry.counters).length > 0) extra.c = entry.counters
  if (entry.face !== undefined && entry.face !== '' && entry.face !== 'front') {
    extra.f = entry.face
  }
  return Object.keys(extra).length > 0 ? extra : null
}

const packBattlefield = (
  entries: BattlefieldCard[],
  table: ReturnType<typeof createTable>,
  prefer: number,
) =>
  entries.map((entry) => {
    const ref = entry.token
      ? table.tokenRef(
          typeof entry.token_id === 'string' && entry.token_id
            ? entry.token_id
            : asName(entry) ?? 'token',
          { name: asName(entry) ?? undefined } as CardDetails,
        )
      : table.cardRef(entry, prefer)
    const flags = packFlags(entry)
    const extra = packExtra(entry)
    if (!flags && !extra) return ref
    if (!extra) return [ref, flags]
    return [ref, flags, extra]
  })

const packStack = (
  stack: LiveSnapshot['stack'],
  table: ReturnType<typeof createTable>,
) =>
  stack.map((item) => {
    const ref = table.cardRef(item.name, 0)
    const controller = item.controller
      ? SEAT_IDS.indexOf(item.controller as (typeof SEAT_IDS)[number])
      : -1
    if (controller < 0 && !item.text) return ref
    if (!item.text) return [ref, controller]
    return [ref, controller, item.text]
  })

const packCombat = (combat: ReplayCombat, table: ReturnType<typeof createTable>) => {
  const out: Record<string, unknown> = {}
  if (combat.step) {
    const step = COMBAT_STEPS.indexOf(combat.step)
    if (step >= 0) out.s = step
  }
  const attackers = (combat.attackers ?? []).map((attacker) => {
    const defender = SEAT_IDS.includes(attacker.defender as (typeof SEAT_IDS)[number])
      ? SEAT_IDS.indexOf(attacker.defender as (typeof SEAT_IDS)[number])
      : table.cardRef(attacker.defender, 0)
    const row: unknown[] = [table.cardRef(attacker.card, 0), defender]
    const flags = attacker.tapped ? FLAG_TAPPED : 0
    const extra: Record<string, unknown> = {}
    if (attacker.pt) extra.p = attacker.pt
    if (attacker.keywords) extra.k = attacker.keywords
    if (flags) row.push(flags)
    if (Object.keys(extra).length > 0) {
      if (!flags) row.push(0)
      row.push(extra)
    }
    return row
  })
  if (attackers.length > 0) out.a = attackers
  const blocks = (combat.blocks ?? []).map((block) => [
    table.cardRef(block.attacker, 0),
    block.blockers.map((blocker) => table.cardRef(blocker, 0)),
  ])
  if (blocks.length > 0) out.b = blocks
  const possible = Object.entries(combat.possible_blockers ?? {}).map(([attacker, blockers]) => [
    table.cardRef(attacker, 0),
    blockers.map((blocker) => table.cardRef(blocker, 0)),
  ])
  if (possible.length > 0) out.p = possible
  if (combat.unblocked?.length) {
    out.u = combat.unblocked.map((name) => table.cardRef(name, 0))
  }
  return out
}

const seatsOf = (snapshot: LiveSnapshot) => {
  const list = Array.isArray(snapshot.seats)
    ? snapshot.seats
    : SEAT_IDS.map((id) => (snapshot.seats as Record<string, LiveSeat>)[id]).filter(Boolean)
  const byId = new Map(list.map((seat) => [seat.id, seat]))
  return SEAT_IDS.map((id) => byId.get(id)).filter(Boolean) as LiveSeat[]
}

export const slugsFromSnapshot = (snapshot: LiveSnapshot) => {
  if (snapshot.decks?.length) return snapshot.decks
  return seatsOf(snapshot).map((seat) => deckSlug(seat.deck))
}

export const compactLiveWire = (snapshot: LiveSnapshot): LiveWireV2 => {
  const seats = seatsOf(snapshot)
  const slugs = slugsFromSnapshot(snapshot)
  const table = createTable(slugs, snapshot.deckIndexes ?? {})
  const packedSeats = seats.map((seat, index) => {
    const damage = SEAT_IDS.map((id) => seat.commander_damage?.[id] ?? 0)
    return [
      [
        seat.life,
        seat.poison ?? 0,
        seat.commander_tax ?? 0,
        seat.library_count,
        seat.hand_count,
      ],
      damage,
      seat.commanders.map((name) => table.cardRef(name, index)),
      seat.hand === undefined ? HIDDEN : seat.hand.map((name) => table.cardRef(name, index)),
      packBattlefield(seat.battlefield ?? [], table, index),
      (seat.graveyard ?? []).map((name) => table.cardRef(name, index)),
      (seat.exile ?? []).map((name) => table.cardRef(name, index)),
      (seat.command ?? []).map((name) => table.cardRef(name, index)),
      seat.revealed_top === undefined
        ? ABSENT
        : seat.revealed_top.map((name) => table.cardRef(name, index)),
    ]
  })

  const you = snapshot.you ? SEAT_IDS.indexOf(snapshot.you as (typeof SEAT_IDS)[number]) : -1
  const wire: LiveWireV2 = {
    v: 2,
    h: snapshot.headline,
    t: snapshot.turn,
    p: Math.max(0, PHASES.indexOf(snapshot.phase as (typeof PHASES)[number])),
    a: Math.max(0, SEAT_IDS.indexOf(snapshot.active as (typeof SEAT_IDS)[number])),
    n: seats.map((seat, index) => seat.name || SEAT_IDS[index]),
    z: packedSeats,
  }
  if (you >= 0) wire.y = you
  if (snapshot.waiting && snapshot.waiting !== DEFAULT_WAITING) wire.w = snapshot.waiting
  if (snapshot.talk) wire.k = snapshot.talk
  if (slugs.some(Boolean)) wire.d = slugs
  const colors = seats.map((seat, index) => seat.color || SEAT_COLORS[index])
  if (colors.some((color, index) => color !== SEAT_COLORS[index])) wire.c = colors
  const stack = packStack(snapshot.stack ?? [], table)
  if (stack.length > 0) wire.s = stack
  if (snapshot.combat) {
    const combat = packCombat(snapshot.combat, table)
    if (Object.keys(combat).length > 0) wire.m = combat
  }
  if (table.extras.length > 0) {
    wire.x = table.extras
    const extraCatalog: Record<string, CardDetails> = {}
    table.extras.forEach((name) => {
      if (snapshot.catalog[name]) extraCatalog[name] = snapshot.catalog[name]
    })
    if (Object.keys(extraCatalog).length > 0) wire.g = extraCatalog
  }
  if (table.tokens.length > 0) {
    wire.o = table.tokens.map(([key, fallback]) => [
      key,
      snapshot.tokens?.[key] ?? fallback,
    ])
  }
  return wire
}

const lookupRef = (
  ref: unknown,
  lists: DeckCard[][],
  extras: string[],
  tokens: Array<[string, CardDetails]>,
) => {
  if (typeof ref !== 'number') return ref
  const deck = Math.floor(ref / STRIDE)
  const slot = ref % STRIDE
  if (deck < lists.length && lists[deck][slot]) return lists[deck][slot].n
  if (deck === EXTRA_DECK && extras[slot] !== undefined) return extras[slot]
  if (deck === TOKEN_DECK && tokens[slot]) {
    return (tokens[slot][1] as { name?: string }).name || tokens[slot][0]
  }
  return ref
}

const unpackCards = (
  values: unknown,
  lists: DeckCard[][],
  extras: string[],
  tokens: Array<[string, CardDetails]>,
) => {
  if (values === HIDDEN || values === ABSENT || !Array.isArray(values)) return []
  return values.map((value) => lookupRef(value, lists, extras, tokens) as string | number)
}

const unpackBattlefield = (
  values: unknown,
  lists: DeckCard[][],
  extras: string[],
  tokens: Array<[string, CardDetails]>,
) => {
  if (!Array.isArray(values)) return []
  return values.flatMap((item) => {
    let ref: unknown
    let flags = 0
    let extra: Record<string, unknown> = {}
    if (typeof item === 'number') ref = item
    else if (Array.isArray(item) && item.length > 0) {
      ref = item[0]
      flags = typeof item[1] === 'number' ? item[1] : 0
      extra = item[2] && typeof item[2] === 'object' ? item[2] as Record<string, unknown> : {}
    } else return []
    const deck = typeof ref === 'number' ? Math.floor(ref / STRIDE) : -1
    const entry: BattlefieldCard = {
      name: lookupRef(ref, lists, extras, tokens) as string | number,
    }
    if (flags & FLAG_TAPPED) entry.tapped = true
    if (flags & FLAG_TOKEN || deck === TOKEN_DECK) {
      entry.token = true
      if (typeof ref === 'number' && deck === TOKEN_DECK) {
        entry.token_id = tokens[ref % STRIDE]?.[0]
      }
    }
    if (flags & FLAG_COMMANDER) entry.commander = true
    if (typeof extra.p === 'string') entry.pt = extra.p
    if (typeof extra.n === 'string') entry.note = extra.n
    if (extra.c && typeof extra.c === 'object') {
      entry.counters = extra.c as Record<string, number>
    }
    if (extra.f !== undefined) entry.face = extra.f as string | number
    return [entry]
  })
}

export const expandLiveWire = (
  wire: LiveWireV2,
  indexes: Record<string, DeckIndex> = {},
): LiveSnapshot => {
  const slugs = [...(wire.d ?? ['', '', '', ''])]
  while (slugs.length < 4) slugs.push('')
  const lists = slugs.slice(0, 4).map((slug) => indexes[slug]?.cards ?? [])
  const extras = wire.x ?? []
  const tokens = wire.o ?? []
  const names = wire.n ?? []
  const colors = wire.c ?? SEAT_COLORS
  const seats = (wire.z ?? []).map((packed, index) => {
    const row = Array.isArray(packed) ? packed : []
    const stats = Array.isArray(row[0]) ? row[0] as number[] : [40, 0, 0, 0, 0]
    const damage = Array.isArray(row[1]) ? row[1] as number[] : [0, 0, 0, 0]
    const handValue = row[3]
    const revealed = row[8]
    const seat: LiveSeat = {
      id: SEAT_IDS[index],
      name: names[index] || SEAT_IDS[index],
      commanders: unpackCards(row[2], lists, extras, tokens) as string[],
      color: colors[index] || SEAT_COLORS[index],
      life: stats[0] ?? 40,
      poison: stats[1] ?? 0,
      commander_tax: stats[2] ?? 0,
      library_count: stats[3] ?? 0,
      hand_count: stats[4] ?? 0,
      commander_damage: Object.fromEntries(
        SEAT_IDS.map((id, other) => [id, damage[other] ?? 0]).filter((_, other) => other !== index),
      ),
      battlefield: unpackBattlefield(row[4], lists, extras, tokens),
      graveyard: unpackCards(row[5], lists, extras, tokens),
      exile: unpackCards(row[6], lists, extras, tokens),
      command: unpackCards(row[7], lists, extras, tokens),
    }
    const slug = slugs[index]
    if (slug) seat.deck = `decks/${slug}`
    if (handValue !== HIDDEN) seat.hand = unpackCards(handValue, lists, extras, tokens)
    if (revealed !== ABSENT) {
      seat.revealed_top = unpackCards(revealed, lists, extras, tokens)
    }
    return seat
  })

  const snapshot: LiveSnapshot = {
    v: 1,
    you: typeof wire.y === 'number' ? SEAT_IDS[wire.y] : null,
    headline: wire.h,
    waiting: wire.w || DEFAULT_WAITING,
    talk: wire.k || '',
    turn: wire.t,
    phase: PHASES[wire.p] ?? 'main1',
    active: SEAT_IDS[wire.a] ?? 'p1',
    stack: (wire.s ?? []).map((item) => {
      if (typeof item === 'number') return { name: lookupRef(item, lists, extras, tokens) as string | number }
      if (!Array.isArray(item)) return { name: String(item) }
      const packed: { name: string | number, controller?: string, text?: string } = {
        name: lookupRef(item[0], lists, extras, tokens) as string | number,
      }
      if (typeof item[1] === 'number' && item[1] >= 0 && item[1] < 4) {
        packed.controller = SEAT_IDS[item[1]]
      }
      if (item[2]) packed.text = String(item[2])
      return packed
    }),
    seats,
    catalog: catalogFromIndexes(slugs, indexes, wire.g),
    decks: slugs.filter(Boolean),
    deckIndexes: indexes,
  }
  if (wire.m) {
    const combat: ReplayCombat = {}
    const step = wire.m.s
    if (typeof step === 'number') combat.step = COMBAT_STEPS[step]
    if (Array.isArray(wire.m.a)) {
      combat.attackers = wire.m.a.map((row) => {
        const item = row as unknown[]
        const defenderRaw = item[1]
        const defender = typeof defenderRaw === 'number' && defenderRaw >= 0 && defenderRaw < 4
          ? SEAT_IDS[defenderRaw]
          : lookupRef(defenderRaw, lists, extras, tokens)
        const attacker: CombatAttacker = {
          card: lookupRef(item[0], lists, extras, tokens) as string | number,
          defender: defender as string | number,
        }
        const flags = typeof item[2] === 'number' ? item[2] : 0
        const extra = (typeof item[2] === 'object' ? item[2] : item[3]) as Record<string, unknown> | undefined
        if (flags & FLAG_TAPPED) attacker.tapped = true
        if (typeof extra?.p === 'string') attacker.pt = extra.p
        if (Array.isArray(extra?.k)) attacker.keywords = extra.k as string[]
        return attacker
      })
    }
    if (Array.isArray(wire.m.b)) {
      combat.blocks = wire.m.b.map((row) => {
        const item = row as unknown[]
        return {
          attacker: lookupRef(item[0], lists, extras, tokens) as string | number,
          blockers: ((item[1] as unknown[]) ?? []).map(
            (blocker) => lookupRef(blocker, lists, extras, tokens) as string | number,
          ),
        }
      })
    }
    if (Array.isArray(wire.m.p)) {
      combat.possible_blockers = Object.fromEntries(
        wire.m.p.map((row) => {
          const item = row as unknown[]
          return [
            String(lookupRef(item[0], lists, extras, tokens)),
            ((item[1] as unknown[]) ?? []).map(
              (blocker) => lookupRef(blocker, lists, extras, tokens) as string | number,
            ),
          ]
        }),
      )
    }
    if (Array.isArray(wire.m.u)) {
      combat.unblocked = wire.m.u.map(
        (name) => lookupRef(name, lists, extras, tokens) as string | number,
      )
    }
    snapshot.combat = combat
  }
  if (tokens.length > 0) {
    snapshot.tokens = Object.fromEntries(tokens)
  }
  return snapshot
}

export const fetchDeckIndex = async (slug: string, base: string) => {
  const response = await fetch(`${base}decks/${encodeURIComponent(slug)}.json`)
  if (!response.ok) {
    throw new Error(`Could not load deck ${slug}`)
  }
  return response.json() as Promise<DeckIndex>
}

export const loadDeckIndexes = async (slugs: string[], base: string) => {
  const unique = [...new Set(slugs.filter(Boolean))]
  const entries = await Promise.all(
    unique.map(async (slug) => [slug, await fetchDeckIndex(slug, base)] as const),
  )
  return Object.fromEntries(entries) as Record<string, DeckIndex>
}
