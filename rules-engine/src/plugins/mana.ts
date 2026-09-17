import { addPools, emptyMana } from '../draft'
import { hasKeyword } from '../keywords'
import type { GameState, ManaId, Plugin } from '../types'
import { payCost } from './spells'

const MANA_IDS: ManaId[] = ['W', 'U', 'B', 'R', 'G', 'C']

type ManaSource = {
  oracleText: string
  tapProduces?: Partial<Record<ManaId, number>>
  exiledCards?: string[]
}

/**
 * The printed modes of a source's mana abilities. `Add {G}{U}` is one mode
 * worth two mana; `Add {W} or {U}` and `Add {B}, {G}, or {U}` are separate
 * one-mana modes.
 */
export const manaModes = (
  object: ManaSource,
  state?: Pick<GameState, 'objects'>,
): Partial<Record<ManaId, number>>[] => {
  const modes: Partial<Record<ManaId, number>>[] = []
  for (const match of object.oracleText.matchAll(/Add ((?:\{[WUBRGC]\}(?:,? or |, )?)+)/gi)) {
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
  if (/one mana of any color/i.test(object.oracleText)) {
    for (const symbol of MANA_IDS.slice(0, 5)) modes.push({ [symbol]: 1 })
  }
  if (/any of the exiled cards' colors/i.test(object.oracleText) && state) {
    const colors = new Set(
      (object.exiledCards ?? [])
        .flatMap((objectId) => state.objects[objectId]?.colors ?? [])
        .filter((color): color is ManaId => MANA_IDS.slice(0, 5).includes(color as ManaId)),
    )
    for (const color of colors) modes.push({ [color]: 1 })
  }
  if (modes.length === 0 && object.tapProduces) modes.push(object.tapProduces)
  return modes
}

export const poolForChoice = (
  object: ManaSource,
  mana?: ManaId,
  state?: Pick<GameState, 'objects'>,
) => {
  const modes = manaModes(object, state)
  if (!mana) return modes.length === 1 ? modes[0] : object.tapProduces
  return modes.find((mode) => mode[mana] && Object.keys(mode).length === 1)
    ?? modes.find((mode) => mode[mana])
}

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
    return /one mana of any color/i.test(object.oracleText)
      ? `${object.name} needs a mana color`
      : `${object.name} has no mana ability`
  }
  if (
    object.types.includes('Creature')
    && object.summoningSickness
    && !hasKeyword(object, 'haste')
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
