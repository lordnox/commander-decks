import { addPools, emptyMana } from '../draft'
import { hasKeyword } from '../keywords'
import type { GameObject, GameState, ManaId, PlayerId, Plugin } from '../types'
import { payCost } from './spells'
import { hasForestOverlay } from './forestOverlay'
import { hasSwampOverlay } from './swampOverlay'

const MANA_IDS: ManaId[] = ['W', 'U', 'B', 'R', 'G', 'C']
const COLORS: ManaId[] = ['W', 'U', 'B', 'R', 'G']

type ManaSource = {
  oracleText: string
  tapProduces?: Partial<Record<ManaId, number>>
  exiledCards?: string[]
  controller?: PlayerId
  types?: string[]
  subtypes?: string[]
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

/**
 * The printed modes of a source's mana abilities. `Add {G}{U}` is one mode
 * worth two mana; `Add {W} or {U}` and `Add {B}, {G}, or {U}` are separate
 * one-mana modes. `Add {B} for each Swamp` is a paid ability, not a free tap.
 */
export const manaModes = (
  object: ManaSource,
  state?: Pick<GameState, 'objects' | 'rules'>,
): Partial<Record<ManaId, number>>[] => {
  const modes: Partial<Record<ManaId, number>>[] = []
  for (const match of object.oracleText.matchAll(
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
  const identityMana = /commander's color identity/i.test(object.oracleText)
  if (/one mana of any color/i.test(object.oracleText) && !identityMana) {
    for (const symbol of COLORS) modes.push({ [symbol]: 1 })
  }
  if (identityMana && state && object.controller) {
    for (const color of commanderIdentity(state, object.controller)) {
      modes.push({ [color]: 1 })
    }
  }
  if (/any of the exiled cards' colors/i.test(object.oracleText) && state) {
    const colors = new Set(
      (object.exiledCards ?? [])
        .flatMap((objectId) => state.objects[objectId]?.colors ?? [])
        .filter((color): color is ManaId => COLORS.includes(color as ManaId)),
    )
    for (const color of colors) modes.push({ [color]: 1 })
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
  if (object.controller !== event.seat) return `${event.seat} does not control ${object.name}`
  if (object.tapped) return `${object.name} is already tapped`
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
    object.types.includes('Creature')
    && object.summoningSickness
    && !hasKeyword(object, 'haste', state)
  ) {
    return `${object.name} has summoning sickness`
  }
}

const apply: Plugin['apply'] = ({ state, event, draft }) => {
  if (event.type === 'tapForMana') {
    const object = draft.object(event.objectId)
    if (!object) return
    const pool = poolForChoice(object, event.mana, state)
    if (!pool) return
    object.tapped = true
    const player = draft.players[event.seat]
    player.mana = addPools(player.mana, pool)
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
