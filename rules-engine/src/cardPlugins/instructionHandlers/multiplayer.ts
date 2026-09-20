import { apnapSeats } from '../../turnOrder'
import { copyTokenTemplate, createToken } from '../effects'
import { askEachPlayerDiscard, askEachPlayerSacrifice } from './helpers'
import type { InstructionHandler, InstructionHandlers } from './types'

const addManaToEachPlayer: InstructionHandler<'addManaToEachPlayer'> = (
  { draft },
  instruction,
) => {
  for (const seat of apnapSeats(draft)) {
    draft.enqueue({ type: 'addMana', seat, mana: instruction.mana })
  }
}

const secretCouncil: InstructionHandler<'secretCouncil'> = ({ draft, source }) => {
  draft.enqueue({
    type: 'custom',
    name: 'secretCouncil.begin',
    seat: source.controller,
    payload: { sourceId: source.id, source: source.name },
  })
}

const chooseVotesThisTurn: InstructionHandler<'chooseVotesThisTurn'> = ({ draft, source }) => {
  draft.players[source.controller].data['secretCouncil.chooseVotes'] = true
}

const discardHandsThenDrawGreatest: InstructionHandler<'discardHandsThenDrawGreatest'> = (
  { draft },
) => {
  const seats = apnapSeats(draft)
  const count = Math.max(0, ...seats.map((seat) => draft.zoneOrder[seat].hand.length))
  for (const seat of seats) {
    for (const objectId of draft.zoneOrder[seat].hand) {
      draft.enqueue({ type: 'discard', seat, objectId })
    }
    draft.enqueue({ type: 'draw', seat, count })
  }
}

const extraLandPlays: InstructionHandler<'extraLandPlays'> = (
  { draft, source },
  instruction,
) => {
  draft.enqueue({
    type: 'custom',
    name: 'additionalLandPlay.grant',
    seat: source.controller,
    payload: { count: instruction.count },
  })
}

const eachPlayerDiscard: InstructionHandler<'eachPlayerDiscard'> = (
  { draft, source },
  instruction,
) => {
  askEachPlayerDiscard(draft, source, instruction.count)
}

const eachPlayerSacrifice: InstructionHandler<'eachPlayerSacrifice'> = (
  { draft, source },
  instruction,
) => {
  askEachPlayerSacrifice(draft, source, instruction.type)
}

const eachPlayerLoseLife: InstructionHandler<'eachPlayerLoseLife'> = (
  { draft, source },
  instruction,
) => {
  for (const seat of apnapSeats(draft)) {
    draft.enqueue({
      type: 'loseLife',
      seat,
      amount: instruction.amount,
      source: source.id,
    })
  }
}

const opponentsLoseLife: InstructionHandler<'opponentsLoseLife'> = (
  { draft, source },
  instruction,
) => {
  for (const seat of apnapSeats(draft)) {
    if (seat === source.controller || draft.players[seat].lost) continue
    draft.enqueue({
      type: 'loseLife',
      seat,
      amount: instruction.amount,
      source: source.id,
    })
  }
}

const eachPlayerDraw: InstructionHandler<'eachPlayerDraw'> = (
  { draft },
  instruction,
) => {
  for (const seat of apnapSeats(draft)) {
    draft.enqueue({ type: 'draw', seat, count: instruction.count })
  }
}

const copyTargetForEachOtherPlayer: InstructionHandler<'copyTargetForEachOtherPlayer'> = (
  { draft, item },
) => {
  const target = item?.targets[0]
  const copied = target?.kind === 'object' ? draft.object(target.objectId) : undefined
  if (!copied) return
  for (const seat of draft.playerOrder) {
    if (seat === copied.controller || draft.players[seat].lost) continue
    createToken(draft, seat, copyTokenTemplate(copied))
  }
}

const createTreasures: InstructionHandler<'createTreasures'> = (
  { draft, source, item },
  instruction,
) => {
  const seat = instruction.who === 'you'
    ? source.controller
    : item?.targets[0]?.kind === 'object'
      ? draft.object(item.targets[0].objectId)?.controller
      : item?.targets[0]?.kind === 'player'
        ? item.targets[0].player
        : undefined
  if (!seat) return
  for (let index = 0; index < instruction.count; index += 1) {
    createToken(draft, seat, {
      name: 'Treasure',
      types: ['Artifact'],
      subtypes: ['Treasure'],
      oracleText: '{T}, Sacrifice this token: Add one mana of any color.',
    })
  }
}

export const multiplayerHandlers = {
  addManaToEachPlayer,
  secretCouncil,
  chooseVotesThisTurn,
  discardHandsThenDrawGreatest,
  extraLandPlays,
  eachPlayerDiscard,
  eachPlayerSacrifice,
  eachPlayerLoseLife,
  opponentsLoseLife,
  eachPlayerDraw,
  copyTargetForEachOtherPlayer,
  createTreasures,
} satisfies Partial<InstructionHandlers>
