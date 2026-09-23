import { isPermanentType } from '../../definitions'
import { DIALOG_CHOSEN, setPendingDialog } from '../../pendingDialog'
import { pickRandomChoices, RANDOM_CHOICE } from '../../plugins/hiddenInformation'
import { openCardSelection } from '../../rules/selectCards'
import { apnapSeats } from '../../turnOrder'
import {
  millLibrary,
  RANDOM_EXILE_COPY_CARD_CHOSEN,
  returnOwnedLands,
} from '../effects'
import { runRevealUntil } from '../revealUntil'
import type { InstructionHandler, InstructionHandlers } from './types'

const selfMill: InstructionHandler<'selfMill'> = ({ draft, source }, instruction) => {
  millLibrary(draft, source.controller, instruction.count)
}

const bounceSelf: InstructionHandler<'bounceSelf'> = ({ draft, source }) => {
  draft.enqueue({ type: 'move', objectId: source.id, to: 'hand' })
}

const sacrificeSelf: InstructionHandler<'sacrificeSelf'> = ({ draft, source }) => {
  draft.enqueue({ type: 'sacrifice', objectId: source.id })
}

const revealUntil: InstructionHandler<'revealUntil'> = ({ draft, source }, instruction) => {
  runRevealUntil(draft, source, instruction)
}

const revealUntilBasicLand: InstructionHandler<'revealUntilBasicLand'> = ({ draft, source }) => {
  runRevealUntil(draft, source, {
    count: 1,
    match: { type: 'Land', supertype: 'Basic' },
    destination: 'hand',
    nonMatch: 'mill',
  })
}

const revealMatchingToHand: InstructionHandler<'revealMatchingToHand'> = (
  { draft, source },
  instruction,
) => {
  const ids = draft.zoneOrder[source.controller].library.slice(0, instruction.count)
  if (ids.length === 0) return
  draft.enqueue({
    type: 'reveal',
    seat: source.controller,
    objectIds: ids,
    source: source.name,
  })
  const matching = ids.filter((objectId) =>
    draft.object(objectId)?.types.includes(instruction.type))
  const rest = pickRandomChoices(
    draft,
    ids.filter((objectId) => !matching.includes(objectId)),
    ids.length,
  )
  for (const objectId of matching) {
    draft.enqueue({ type: 'move', objectId, to: 'hand' })
  }
  for (const objectId of rest) {
    draft.enqueue({ type: 'move', objectId, to: 'library', position: 'bottom' })
  }
}

const lockOrUnlockDoor: InstructionHandler<'lockOrUnlockDoor'> = ({ draft, source, item }) => {
  const target = item?.targets[0]
  const door = item?.door
  if (target?.kind !== 'object' || (door !== 'left' && door !== 'right')) return
  const object = draft.object(target.objectId)
  if (!object?.roomDoors || object.controller !== source.controller) return
  if (object.unlockedDoors?.includes(door)) {
    draft.enqueue({
      type: 'lockDoor',
      seat: source.controller,
      objectId: object.id,
      door,
    })
    return
  }
  draft.enqueue({
    type: 'unlockDoor',
    seat: source.controller,
    objectId: object.id,
    door,
    withoutCost: true,
  })
}

const sacrificePermanentsThenDraw: InstructionHandler<'sacrificePermanentsThenDraw'> = (
  { draft, source },
  instruction,
) => {
  const candidates = Object.values(draft.objects)
    .filter((object) =>
      object.zone === 'battlefield'
      && object.controller === source.controller
      && (
        !instruction.types
        || instruction.types.some((type) => object.types.includes(type))
      ))
    .map((object) => object.id)
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'sacrifice',
    count: candidates.length,
    min: 0,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: 'Sacrifice any number of eligible permanents, then draw that many cards.',
    destinations: ['battlefield', 'sacrifice'],
    fromSeat: source.controller,
    drawPerSelected: 1,
  })
}

const opponentsSacrifice: InstructionHandler<'opponentsSacrifice'> = (
  { draft, source },
  instruction,
) => {
  for (const seat of apnapSeats(draft)) {
    if (seat === source.controller) continue
    const candidates = Object.values(draft.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && object.controller === seat
        && object.types.includes(instruction.type))
      .map((object) => object.id)
    if (candidates.length === 0) continue
    openCardSelection(draft, {
      seat,
      kind: 'sacrifice',
      count: Math.min(instruction.count, candidates.length),
      candidates,
      sourceId: source.id,
      source: source.name,
      prompt: `Sacrifice ${Math.min(instruction.count, candidates.length)} ${instruction.type.toLowerCase()} card(s).`,
      destinations: ['battlefield', 'sacrifice'],
      fromSeat: seat,
      sequence: draft.allocTs(),
    })
  }
}

const reanimateCreatureFromGraveyards: InstructionHandler<'reanimateCreatureFromGraveyards'> = (
  { draft, source },
  instruction,
) => {
  const candidates = Object.values(draft.objects)
    .filter((object) => object.zone === 'graveyard' && object.types.includes('Creature'))
    .map((object) => object.id)
  if (candidates.length === 0) return
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'choose',
    count: 1,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: 'Choose a creature card from a graveyard to put onto the battlefield.',
    destinations: ['target'],
    moveSelectedTo: 'battlefield',
    moveSelectedController: source.controller,
    ...(instruction.addSubtype ? { addSubtypes: [instruction.addSubtype] } : {}),
  })
}

const exileColoredPermanentsAtMostX: InstructionHandler<'exileColoredPermanentsAtMostX'> = (
  { draft, item },
) => {
  const x = item?.x ?? 0
  for (const object of Object.values(draft.objects)) {
    if (
      object.zone === 'battlefield'
      && object.colors.length > 0
      && object.manaValue <= x
    ) {
      draft.enqueue({ type: 'move', objectId: object.id, to: 'exile' })
    }
  }
}

const returnOwnedGraveyardLands: InstructionHandler<'returnOwnedGraveyardLands'> = (
  { draft, source },
  instruction,
) => {
  returnOwnedLands(draft, source.controller, instruction.tapped !== false)
}

const surveil: InstructionHandler<'surveil'> = ({ draft, source }, instruction) => {
  const candidates = draft.zoneOrder[source.controller].library.slice(0, instruction.count)
  if (candidates.length === 0) return
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'surveil',
    count: instruction.count,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: `Surveil ${instruction.count}.`,
    destinations: ['top', 'graveyard'],
  })
}

const scry: InstructionHandler<'scry'> = ({ draft, source }, instruction) => {
  const candidates = draft.zoneOrder[source.controller].library.slice(0, instruction.count)
  if (candidates.length === 0) return
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'scry',
    count: instruction.count,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: `Scry ${instruction.count}.`,
    destinations: ['top', 'bottom'],
  })
}

const putLandFromHand: InstructionHandler<'putLandFromHand'> = (
  { draft, source },
  instruction,
) => {
  const candidates = draft.zoneOrder[source.controller].hand.filter(
    (objectId) => draft.object(objectId)?.types.includes('Land'),
  )
  if (candidates.length === 0) return
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'choose',
    count: 1,
    min: 0,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: instruction.tapped
      ? 'You may put a land from your hand onto the battlefield tapped.'
      : 'You may put a land from your hand onto the battlefield.',
    destinations: ['target'],
    moveSelectedTo: 'battlefield',
    tapSelected: instruction.tapped,
  })
}

const bounceChosenLand: InstructionHandler<'bounceChosenLand'> = ({ draft, source }) => {
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'bounce-land',
    prompt: 'Return a land you control to its owner\'s hand.',
    waiting: 'is choosing a land to return.',
    judge: 'Waiting for a land to bounce.',
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['battlefield', 'hand'],
    types: ['Land'],
    requirements: { hand: { min: 1, max: 1 } },
  })
}

const revealPick: InstructionHandler<'revealPick'> = (
  { draft, source },
  instruction,
) => {
  const ids = draft.zoneOrder[source.controller].library.slice(0, instruction.count)
  if (ids.length > 0) {
    draft.enqueue({ type: 'reveal', seat: source.controller, objectIds: ids, source: source.name })
  }
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'reveal-pick',
    prompt: instruction.type
      ? `You may put a ${instruction.type.toLowerCase()} card into your hand.`
      : 'You may put a matching card into your hand.',
    waiting: 'is choosing among revealed cards.',
    judge: 'Waiting for a revealed-card pick.',
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['hand', 'graveyard'],
    count: instruction.count,
    ...(instruction.type ? { types: [instruction.type] } : {}),
    ...(instruction.permanent ? { permanent: true } : {}),
    optional: true,
    requirements: { hand: { max: 1 } },
  })
}

const returnTargetFromGraveyard: InstructionHandler<'returnTargetFromGraveyard'> = (
  { draft, source, item },
  instruction,
) => {
  const target = item?.targets[0]
  if (target?.kind !== 'object') return
  if (instruction.optional) {
    openCardSelection(draft, {
      seat: source.controller,
      kind: 'choose',
      count: 1,
      min: 0,
      candidates: [target.objectId],
      sourceId: source.id,
      source: source.name,
      prompt: `You may return the targeted card to ${instruction.to}.`,
      fromSeat: source.controller,
      fromZone: 'graveyard',
      destinations: ['target'],
      moveSelectedTo: instruction.to,
      ...(instruction.to === 'battlefield'
        ? { moveSelectedController: source.controller }
        : {}),
      ...(instruction.tapped && instruction.to === 'battlefield'
        ? { tapSelected: true }
        : {}),
    })
    return
  }
  draft.enqueue({
    type: 'move',
    objectId: target.objectId,
    to: instruction.to,
    ...(instruction.to === 'battlefield' ? { controller: source.controller } : {}),
  })
  if (instruction.tapped && instruction.to === 'battlefield') {
    draft.enqueue({ type: 'tap', objectId: target.objectId })
  }
}

const bounceAttacking: InstructionHandler<'bounceAttacking'> = ({ draft }) => {
  for (const object of Object.values(draft.objects)) {
    if (object.zone === 'battlefield' && object.attacking) {
      draft.enqueue({ type: 'move', objectId: object.id, to: 'hand' })
    }
  }
}

const revealDrawLoseLife: InstructionHandler<'revealDrawLoseLife'> = ({ draft, source }) => {
  const topId = draft.zoneOrder[source.controller].library[0]
  const top = topId ? draft.object(topId) : undefined
  if (!top) return
  draft.enqueue({
    type: 'reveal',
    seat: source.controller,
    objectIds: [top.id],
    source: source.name,
  })
  draft.enqueue({ type: 'move', objectId: top.id, to: 'hand' })
  const amount = top.manaValue
  if (amount > 0) {
    draft.enqueue({
      type: 'loseLife',
      seat: source.controller,
      amount,
      source: source.name,
    })
  }
}

const randomExileCopyWhile: InstructionHandler<'randomExileCopyWhile'> = (
  { draft, source },
  instruction,
) => {
  const choices = Object.values(draft.objects)
    .filter((object) =>
      object.owner === source.controller
      && object.zone === 'graveyard'
      && isPermanentType(object.types))
    .map((object) => object.id)
  if (choices.length === 0) {
    draft.note(`${source.name} finds no matching card in ${source.controller}'s graveyard`)
    return
  }
  draft.enqueue({
    type: 'custom',
    name: RANDOM_CHOICE,
    seat: source.controller,
    payload: {
      choices,
      resultName: RANDOM_EXILE_COPY_CARD_CHOSEN,
      context: {
        sourceName: source.name,
        repeatWhileType: instruction.repeatWhileType,
        tapped: instruction.tapped === true,
        selectedIds: [],
      },
    },
  })
}

const putMilledLandTapped: InstructionHandler<'putMilledLandTapped'> = (
  { draft, item },
) => {
  // Triggered from the stack (CR 603); triggeringObjectId is the milled land.
  const objectId = typeof item?.payload?.triggeringObjectId === 'string'
    ? item.payload.triggeringObjectId
    : undefined
  if (!objectId) return
  const land = draft.object(objectId)
  if (!land || !land.types.includes('Land')) return
  draft.enqueue({ type: 'move', objectId, to: 'battlefield' })
  draft.enqueue({ type: 'tap', objectId })
}

const returnChosenLandFromGraveyard: InstructionHandler<'returnChosenLandFromGraveyard'> = (
  { draft, source },
  instruction,
) => {
  const candidates = (draft.zoneOrder[source.controller].graveyard ?? []).filter(
    (objectId) => draft.object(objectId)?.types.includes('Land'),
  )
  if (candidates.length === 0) return
  const tapped = instruction.tapped !== false
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'choose',
    count: 1,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: tapped
      ? 'Return a land card from your graveyard to the battlefield tapped.'
      : 'Return a land card from your graveyard to the battlefield.',
    destinations: ['target'],
    fromSeat: source.controller,
    moveSelectedTo: 'battlefield',
    tapSelected: tapped,
  })
}

const returnCreatureManaValueX: InstructionHandler<'returnCreatureManaValueX'> = (
  { draft, source, item },
  instruction,
) => {
  const x = Math.max(0, item?.x ?? 0)
  if (x < (instruction.minimumX ?? 0)) return
  const candidates = (draft.zoneOrder[source.controller].graveyard ?? []).filter((objectId) => {
    const object = draft.object(objectId)
    return object?.types.includes('Creature') && object.manaValue <= x
  })
  if (candidates.length === 0) return
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'choose',
    count: 1,
    min: 0,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: `You may return a creature card with mana value ${x} or less to the battlefield.`,
    destinations: ['target'],
    fromSeat: source.controller,
    moveSelectedTo: 'battlefield',
    tapSelected: instruction.tapped,
  })
}

export const zoneHandlers = {
  selfMill,
  bounceSelf,
  sacrificeSelf,
  revealUntil,
  revealUntilBasicLand,
  revealMatchingToHand,
  lockOrUnlockDoor,
  sacrificePermanentsThenDraw,
  opponentsSacrifice,
  reanimateCreatureFromGraveyards,
  exileColoredPermanentsAtMostX,
  returnOwnedGraveyardLands,
  surveil,
  scry,
  putLandFromHand,
  bounceChosenLand,
  revealPick,
  returnTargetFromGraveyard,
  bounceAttacking,
  revealDrawLoseLife,
  randomExileCopyWhile,
  putMilledLandTapped,
  returnChosenLandFromGraveyard,
  returnCreatureManaValueX,
} satisfies Partial<InstructionHandlers>
