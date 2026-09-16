import { addPools, emptyMana } from '../draft'
import type { ManaId, Plugin } from '../types'
import { payCost } from './spells'

const MANA_IDS: ManaId[] = ['W', 'U', 'B', 'R', 'G', 'C']

const chosenPool = (
  object: { oracleText: string; tapProduces?: Partial<Record<ManaId, number>> },
  mana?: ManaId,
) => {
  if (!mana) return object.tapProduces
  if (/one mana of any color/i.test(object.oracleText) && mana !== 'C') {
    return { [mana]: 1 }
  }
  const symbols = [...object.oracleText.matchAll(/Add[^.\n]*\{([WUBRGC])\}/gi)]
    .map((match) => match[1].toUpperCase() as ManaId)
  if (symbols.includes(mana)) return { [mana]: 1 }
}

const legal: Plugin['legal'] = ({ state, event }) => {
  if (event.type !== 'tapForMana') return
  const object = state.objects[event.objectId]
  if (!object) return 'no such object'
  if (object.zone !== 'battlefield') return `${object.name} is not on the battlefield`
  if (object.controller !== event.seat) return `${event.seat} does not control ${object.name}`
  if (object.tapped) return `${object.name} is already tapped`
  if (!chosenPool(object, event.mana)) {
    if (event.mana && MANA_IDS.includes(event.mana)) {
      return `${object.name} cannot produce ${event.mana}`
    }
    return /one mana of any color/i.test(object.oracleText)
      ? `${object.name} needs a mana color`
      : `${object.name} has no mana ability`
  }
  if (object.types.includes('Creature') && object.summoningSickness) {
    return `${object.name} has summoning sickness`
  }
}

const apply: Plugin['apply'] = ({ event, draft }) => {
  if (event.type === 'tapForMana') {
    const object = draft.object(event.objectId)
    if (!object) return
    const pool = chosenPool(object, event.mana)
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
