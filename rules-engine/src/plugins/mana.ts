import { addPools, emptyMana } from '../draft'
import { hasKeyword } from '../keywords'
import type { CardEffect } from '../cardPlugins/effects'
import type { GameObject, GameState, ManaId, PlayerId, Plugin } from '../types'
import { payCost } from './spells'
import { hasForestOverlay } from './forestOverlay'
import { hasSwampOverlay } from './swampOverlay'
import { effectsOf } from '../cardPlugins/cardRules'
import { romanNumber } from './saga'

const MANA_IDS: ManaId[] = ['W', 'U', 'B', 'R', 'G', 'C']
const COLORS: ManaId[] = ['W', 'U', 'B', 'R', 'G']
const BASIC_LAND_MANA: Record<string, ManaId> = {
  Plains: 'W',
  Island: 'U',
  Swamp: 'B',
  Mountain: 'R',
  Forest: 'G',
}

type ManaSource = {
  id?: string
  oracleText: string
  tapProduces?: Partial<Record<ManaId, number>>
  exiledCards?: string[]
  controller?: PlayerId
  types?: string[]
  subtypes?: string[]
  effects?: CardEffect[]
  chosenType?: string
  counters?: Record<string, number>
}

const commanderIdentity = (state: Pick<GameState, 'objects'>, seat: PlayerId) => {
  const colors = new Set<ManaId>()
  for (const object of Object.values(state.objects)) {
    if (object.owner !== seat) continue
    if (!object.tags.includes('commander') && object.zone !== 'command') continue
    for (const color of object.colors) {
      if (COLORS.includes(color as ManaId)) colors.add(color as ManaId)
    }
  }
  return [...colors]
}

const ABILITY_WORD = String.raw`(?:[A-Z][^\n—]* — )?`
const FREE_TAP_LINE = new RegExp(String.raw`^\(?${ABILITY_WORD}\{T\}(?:, Pay 1 life)?:`, 'i')
const SACRIFICE_SELF_LINE = new RegExp(
  String.raw`^\(?${ABILITY_WORD}(?:\{T\}, )?Sacrifice this \w+:`,
  'i',
)

/**
 * Saga chapters that grant `"{T}: Add {C}."` (Urza's Saga) count as that
 * ability once the Saga has at least that many lore counters; a grant from a
 * chapter lasts as long as the Saga stays on the battlefield.
 */
const grantedTapLines = ({ oracleText, counters }: Pick<ManaSource, 'oracleText' | 'counters'>) =>
  oracleText.split('\n').flatMap((line) => {
    const grant = /^([IVXLC]+(?:,\s*[IVXLC]+)*)\s+[—-].* gains "(\{T\}: Add [^"]*)"/u.exec(line)
    const reached = grant?.[1].split(',').some((chapter) =>
      (counters?.lore ?? 0) >= romanNumber(chapter.trim()))
    return grant && reached ? [grant[2]] : []
  })

const manaLines = (object: Pick<ManaSource, 'oracleText' | 'counters'>) => {
  const lines = object.oracleText.split('\n')
  return {
    free: [...lines, ...grantedTapLines(object)].filter((line) => FREE_TAP_LINE.test(line)),
    sacrifice: lines.filter((line) => SACRIFICE_SELF_LINE.test(line)),
  }
}

/**
 * Oracle lines a bare `tapForMana` may use: `{T}` and life costs, and a
 * sacrifice of the source itself (Treasure, Lotus Petal). A line with any
 * other cost (`{1}, {T}: Add {G}{U}`, `{T}, Mill a card: Add {C}`, `Sacrifice a
 * creature: Add {C}{C}`) is an activated mana ability and is not a mode.
 * Sacrifice lines count only when the source has no free line, and not when an
 * explicit mana-ability effect already covers them.
 */
const tapManaText = (object: Pick<ManaSource, 'oracleText' | 'effects' | 'counters'>) => {
  const { free, sacrifice } = manaLines(object)
  const explicitSacrifice = object.effects?.some((effect) =>
    effect.op === 'activate' && effect.manaAbility && effect.costs.sacrifice)
  return (free.length > 0 ? free : explicitSacrifice ? [] : sacrifice).join('\n')
}

/** Whether tapping this source for mana sacrifices it, as a Treasure does. */
export const sacrificesForMana = (
  object: Pick<ManaSource, 'oracleText' | 'effects' | 'counters'>,
) =>
  manaLines(object).free.length === 0 && tapManaText(object) !== ''

/** A sacrifice-only ability with no `{T}` (Basal Thrull) needs no untapped, unsick source. */
export const manaRequiresTap = (object: Pick<ManaSource, 'oracleText' | 'counters'>) => {
  const { free, sacrifice } = manaLines(object)
  return free.length > 0 || sacrifice.length === 0 || sacrifice.some((line) => line.includes('{T}'))
}

/**
 * The printed modes of a source's free mana abilities. `Add {G}{U}` is one mode
 * worth two mana; `Add {W} or {U}` and `Add {B}, {G}, or {U}` are separate
 * one-mana modes. `Add {B} for each Swamp` is a paid ability, not a free tap.
 */
export const manaModes = (
  object: ManaSource,
  state?: Pick<GameState, 'objects' | 'rules'>,
  visited = new Set<string>(),
): Partial<Record<ManaId, number>>[] => {
  const nextVisited = new Set(visited)
  if (object.id) nextVisited.add(object.id)
  const modes: Partial<Record<ManaId, number>>[] = []
  const freeText = tapManaText(object)
  for (const match of freeText.matchAll(
    /Add ((?:\{[WUBRGC]\}(?:,? or |, )?)+)(?! for each)/gi,
  )) {
    const clause = match[1]
    const symbols = [...clause.matchAll(/\{([WUBRGC])\}/g)]
      .map((symbol) => symbol[1].toUpperCase() as ManaId)
    if (/ or |,/.test(clause)) {
      for (const symbol of symbols) modes.push({ [symbol]: 1 })
      continue
    }
    const pool: Partial<Record<ManaId, number>> = {}
    for (const symbol of symbols) pool[symbol] = (pool[symbol] ?? 0) + 1
    if (symbols.length > 0) modes.push(pool)
  }
  const identityMana = /commander's color identity/i.test(freeText)
  const hasDynamicCapability = object.effects?.some(
    (effect) => effect.op === 'manaCapability' || effect.op === 'restrictedMana',
  )
  if (
    /one mana of any color/i.test(freeText)
    && !identityMana
    && !hasDynamicCapability
  ) {
    for (const symbol of COLORS) modes.push({ [symbol]: 1 })
  }
  if (identityMana && state && object.controller) {
    for (const color of commanderIdentity(state, object.controller)) {
      modes.push({ [color]: 1 })
    }
  }
  if (/any of the exiled cards' colors/i.test(freeText) && state) {
    const colors = new Set(
      (object.exiledCards ?? [])
        .flatMap((objectId) => state.objects[objectId]?.colors ?? [])
        .filter((color): color is ManaId => COLORS.includes(color as ManaId)),
    )
    for (const color of colors) modes.push({ [color]: 1 })
  }
  if (state && object.controller) {
    for (const capability of object.effects ?? []) {
      if (capability.op === 'restrictedMana') {
        for (const symbol of COLORS) modes.push({ [symbol]: 1 })
        continue
      }
      if (capability.op !== 'manaCapability') continue
      const referenced = Object.values(state.objects).filter((candidate) =>
        candidate.zone === 'battlefield'
        && candidate.types.includes('Land')
        && !nextVisited.has(candidate.id)
        && (
          capability.from === 'controlledLands'
            ? candidate.controller === object.controller
            : candidate.controller !== object.controller
        ))
      const symbols = new Set<ManaId>()
      for (const candidate of referenced) {
        for (const mode of manaModes(candidate, state, nextVisited)) {
          for (const symbol of MANA_IDS) {
            if ((mode[symbol] ?? 0) > 0) symbols.add(symbol)
          }
        }
      }
      for (const symbol of symbols) {
        if (capability.from === 'opponentsLands' && symbol === 'C') continue
        modes.push({ [symbol]: 1 })
      }
    }
  }
  if (
    state
    && hasSwampOverlay(state)
    && object.types?.includes('Land')
    && !object.subtypes?.includes('Swamp')
    && !modes.some((mode) => mode.B === 1 && Object.keys(mode).length === 1)
  ) {
    modes.push({ B: 1 })
  }
  if (
    state
    && hasForestOverlay(state)
    && object.types?.includes('Land')
    && !object.subtypes?.includes('Forest')
    && !modes.some((mode) => mode.G === 1 && Object.keys(mode).length === 1)
  ) {
    modes.push({ G: 1 })
  }
  // CR 305.6: a land with a basic land type has that type's mana ability even
  // when its text does not print it (Dryad Arbor).
  if (modes.length === 0 && object.types?.includes('Land')) {
    for (const subtype of object.subtypes ?? []) {
      if (BASIC_LAND_MANA[subtype]) modes.push({ [BASIC_LAND_MANA[subtype]]: 1 })
    }
  }
  if (modes.length === 0 && object.tapProduces) modes.push(object.tapProduces)
  return modes
}

export const poolForChoice = (
  object: ManaSource,
  mana?: ManaId,
  state?: Pick<GameState, 'objects' | 'rules'>,
) => {
  const modes = manaModes(object, state)
  if (!mana) return modes.length === 1 ? modes[0] : object.tapProduces
  return modes.find((mode) => mode[mana] && Object.keys(mode).length === 1)
    ?? modes.find((mode) => mode[mana])
}

const poolHasColor = (pool: Partial<Record<ManaId, number>>) =>
  COLORS.some((color) => (pool[color] ?? 0) > 0)

const legal: Plugin['legal'] = ({ state, event }) => {
  if (event.type !== 'tapForMana') return
  const object = state.objects[event.objectId]
  if (!object) return 'no such object'
  if (object.zone !== 'battlefield') return `${object.name} is not on the battlefield`
  if (object.phasedOut) return `${object.name} is phased out`
  if (object.controller !== event.seat) return `${event.seat} does not control ${object.name}`
  const requiresTap = manaRequiresTap(object)
  if (requiresTap && object.tapped) return `${object.name} is already tapped`
  if (!poolForChoice(object, event.mana, state)) {
    if (event.mana && MANA_IDS.includes(event.mana)) {
      return `${object.name} cannot produce ${event.mana}`
    }
    if (/commander's color identity/i.test(object.oracleText)) {
      return `${object.name} needs a mana color in your commander's identity`
    }
    return /one mana of any color/i.test(object.oracleText)
      ? `${object.name} needs a mana color`
      : `${object.name} has no mana ability`
  }
  if (
    requiresTap
    && object.types.includes('Creature')
    && object.summoningSickness
    && !hasKeyword(object, 'haste', state)
  ) {
    return `${object.name} has summoning sickness`
  }
  if (/\{T\}, Pay 1 life:/i.test(object.oracleText) && state.players[event.seat].life < 1) {
    return `${event.seat} cannot pay 1 life`
  }
}

const apply: Plugin['apply'] = ({ state, event, draft }) => {
  if (event.type === 'tapForMana') {
    const object = draft.object(event.objectId)
    if (!object) return
    const pool = poolForChoice(object, event.mana, state)
    if (!pool) return
    object.tapped = true
    if (sacrificesForMana(object)) draft.enqueue({ type: 'sacrifice', objectId: object.id })
    const player = draft.players[event.seat]
    const restriction = effectsOf(object).find((effect) => effect.op === 'restrictedMana')
    const restrictedSymbol = event.mana && event.mana !== 'C' && restriction
      ? event.mana
      : undefined
    if (restrictedSymbol) {
      player.restrictedMana = [
        ...(player.restrictedMana ?? []),
        {
          mana: restrictedSymbol,
          sourceId: object.id,
          ...(object.chosenType ? { creatureType: object.chosenType } : {}),
          ...(restriction?.uncounterable ? { uncounterable: true } : {}),
        },
      ]
    } else {
      player.mana = addPools(player.mana, pool)
    }
    draft.note(`${event.seat} taps ${object.name} for mana`)
    if (
      /this land deals 1 damage to you/i.test(object.oracleText)
      && poolHasColor(pool)
    ) {
      draft.enqueue({
        type: 'dealDamage',
        sourceId: object.id,
        target: { kind: 'player', player: event.seat },
        amount: 1,
      })
    }
    if (/\{T\}, Pay 1 life:/i.test(object.oracleText)) {
      draft.enqueue({
        type: 'payLife',
        seat: event.seat,
        amount: 1,
        source: object.name,
      })
    }
    return
  }
  if (event.type === 'addMana') {
    const player = draft.players[event.seat]
    player.mana = addPools(player.mana, event.mana)
    draft.note(`${event.seat} adds mana`)
    return
  }
  if (event.type === 'payMana') {
    const paid = payCost(draft.players[event.seat].mana, event.cost)
    if (!paid) return
    draft.players[event.seat].mana = paid
    draft.note(`${event.seat} pays ${event.cost}`)
    return
  }
  if (event.type === 'emptyManaPools') {
    for (const player of Object.values(draft.players)) player.mana = emptyMana()
    draft.note('mana pools empty')
  }
}

const legalMana: Plugin['legal'] = (ctx) => {
  const error = legal(ctx)
  if (error) return error
  const { state, event } = ctx
  if (event.type !== 'payMana') return
  if (!payCost(state.players[event.seat].mana, event.cost)) {
    return `${event.seat} cannot pay ${event.cost}`
  }
}

export const mana: Plugin = { id: 'mana', legal: legalMana, apply }

export const hasUntaxedTapMana = (object: Pick<GameObject, 'oracleText'>) =>
  /(?:^|\n)\{T\}: Add (?!\{[WUBRGC]\} for each)/im.test(object.oracleText)
