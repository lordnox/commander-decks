import type {
  BattlefieldCard,
  CardDetails,
  CardFace,
  ReplayGame,
} from './replayTypes'

const permanentType = /Creature|Artifact|Enchantment|Land|Planeswalker|Battle/
const notePT = /(?:^|[\s;,(])([-+]?[\dX*]+)\/([-+]?[\dX*]+)(?=$|[\s;,)])/
const printedPT = /^([-+]?[\dX*]+)\/([-+]?[\dX*]+)$/
const creatureNote = /\b(crew|crewed|animat|becomes? a creature|is a creature)\b/i

export const resolveName = (game: ReplayGame, value: string | number) => {
  if (typeof value === 'string') return value
  const reference = game.references?.[value]
  return reference?.name ?? String(value)
}

export const withCardUrls = (name: string, details: CardDetails) => {
  const id = details.id
  const imageRoot = id
    ? `https://cards.scryfall.io`
    : ''
  const imagePath = id
    ? `front/${id[0]}/${id[1]}/${id}.jpg`
    : ''

  return {
    ...details,
    scryfall_uri:
      details.scryfall_uri ||
      `https://scryfall.com/search?q=${encodeURIComponent(`!"${name}"`)}`,
    image_small:
      details.image_small ||
      (id ? `${imageRoot}/small/${imagePath}` : undefined),
    image_normal:
      details.image_normal ||
      (id ? `${imageRoot}/normal/${imagePath}` : undefined),
  }
}

const selectedFace = (
  details: CardDetails,
  entry?: BattlefieldCard,
): CardFace | undefined => {
  const faces = details.faces ?? []
  if (!entry || faces.length === 0) return faces[0]

  if (typeof entry.face === 'number') return faces[entry.face] ?? faces[0]
  if (typeof entry.face === 'string') {
    if (entry.face.toLowerCase() === 'front') return faces[0]
    if (entry.face.toLowerCase() === 'back') return faces[1] ?? faces[0]
    return (
      faces.find(
        (face) => face.name.toLowerCase() === entry.face?.toString().toLowerCase(),
      ) ?? faces[0]
    )
  }

  if (entry.note?.toLowerCase().includes('transformed')) return faces[1] ?? faces[0]
  const onlyPermanent = faces.filter((face) => permanentType.test(face.type_line))
  if (onlyPermanent.length === 1) return onlyPermanent[0]
  return faces[0]
}

export const cardInfo = (
  game: ReplayGame,
  value: string | number,
  entry?: BattlefieldCard,
) => {
  const name = resolveName(game, value)
  const details =
    (entry?.token_id && game.tokens?.[entry.token_id]) || game.catalog[name] || {}
  const face = selectedFace(details, entry)
  const selected = face ? { ...details, ...face } : details
  return {
    name: face?.name || name,
    details: withCardUrls(face?.name || name, selected),
  }
}

/**
 * A printed body is not enough: a Vehicle needs crew, and a Spacecraft needs
 * enough charge counters to reach its station threshold.
 */
export const creatureInPlay = (
  details: CardDetails,
  entry?: BattlefieldCard,
) => {
  if (/\bCreature\b/.test(details.type_line ?? '')) return true
  if (creatureNote.test(entry?.note ?? '')) return true
  const station = /artifact creature at (\d+)\+/i.exec(details.oracle_text ?? '')
  if (!station) return false
  return (entry?.counters?.charge ?? 0) >= Number(station[1])
}

/** A permanent that taps or sacrifices itself for mana sits with the lands. */
const manaAbility = /(?:^|\n)[^\n]*:\s*Add\b/
const bodyLater = /\b(Vehicle|Spacecraft|Station)\b/
const sideboard = /\b(Planeswalker|Battle)\b/

export type BattlefieldRow =
  | 'creatures'
  | 'permanents'
  | 'planeswalkers'
  | 'mana'
  | 'other'

/**
 * Where a permanent belongs on the board. A Vehicle or Spacecraft lines up with
 * the creatures it is about to join, a Signet lines up with the lands it stands
 * in for, and anything unusual (an emblem, a Dungeon, a card with no Oracle
 * data) falls through to its own row rather than being forced into one.
 */
export const battlefieldRow = (
  details: CardDetails,
  entry?: BattlefieldCard,
): BattlefieldRow => {
  const type = details.type_line ?? ''
  if (creatureInPlay(details, entry) || bodyLater.test(type)) return 'creatures'
  if (sideboard.test(type)) return 'planeswalkers'
  if (/\bLand\b/.test(type)) return 'mana'
  if (manaAbility.test(details.oracle_text ?? '')) return 'mana'
  if (/\b(Artifact|Enchantment)\b/.test(type)) return 'permanents'
  return 'other'
}

/**
 * The body to print in the card corner: a recorded `pt`, the body a token's
 * note states, or the printed values shifted by `+1/+1` and `-1/-1` counters.
 */
export const currentStats = (details: CardDetails, entry?: BattlefieldCard) => {
  if (entry?.pt) return entry.pt

  const noted = notePT.exec(entry?.note ?? '')
  const printed = printedPT.exec(details.stats ?? '')
  const body = printed ? [printed[1], printed[2]] : noted && [noted[1], noted[2]]
  if (!body) return ''
  if (!noted && entry && !creatureInPlay(details, entry)) return ''

  const plus = entry?.counters?.['+1/+1'] ?? 0
  const minus = entry?.counters?.['-1/-1'] ?? 0
  const change = plus - minus
  const shifted = (value: string) =>
    /^-?\d+$/.test(value) ? String(Number(value) + change) : value
  return `${shifted(body[0])}/${shifted(body[1])}`
}
