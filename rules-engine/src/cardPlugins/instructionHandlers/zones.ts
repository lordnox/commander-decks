import { isPermanentType } from '../../definitions'
import { DIALOG_CHOSEN, setPendingDialog } from '../../pendingDialog'
import { pickRandomChoices, RANDOM_CHOICE } from '../../plugins/hiddenInformation'
import { payCost } from '../../plugins/spells'
import { INSTRUCTIONS_RESUME, openCardSelection, openOpponentPilePartition } from '../../rules/selectCards'
import { openPlayerSelection } from '../../rules/selectPlayers'
import { apnapSeats } from '../../turnOrder'
import {
  addPlusCounters,
  createToken,
  millLibrary,
  RANDOM_EXILE_COPY_CARD_CHOSEN,
  returnOwnedLands,
} from '../effects'
import { runRevealUntil } from '../revealUntil'
import { returnAsEnchantmentOnly } from '../continuousEffects'
import type { InstructionHandler, InstructionHandlers } from './types'

const devour: InstructionHandler<'devour'> = ({ draft, source, run }, instruction) => {
  const candidates = Object.values(draft.objects)
    .filter((object) =>
      object.zone === 'battlefield'
      && object.controller === source.controller
      && instruction.types.some((type) => object.types.includes(type)))
    .map((object) => object.id)
  if (candidates.length === 0) {
    run(instruction.then ?? [], source)
    return
  }
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'sacrifice',
    count: candidates.length,
    min: 0,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: `You may sacrifice any number of ${instruction.types.join('/')}s. ${source.name} enters with ${instruction.countersPer} +1/+1 counter(s) on it for each.`,
    triggerInstructions: [
      {
        kind: 'addPlusCountersFromSacrifice',
        countersPer: instruction.countersPer,
      },
      ...(instruction.then ?? []),
    ],
    triggerPayload: { devour: true },
  })
}

const addPlusCountersFromSacrifice: InstructionHandler<'addPlusCountersFromSacrifice'> = (
  { draft, source, item },
  instruction,
) => {
  const sacrificed = item?.payload?.sacrificedCount
  const count = typeof sacrificed === 'number'
    ? sacrificed * instruction.countersPer
    : 0
  if (count > 0) addPlusCounters(draft.object(source.id) ?? source, count)
}

const selfMill: InstructionHandler<'selfMill'> = ({ draft, source }, instruction) => {
  millLibrary(draft, source.controller, instruction.count)
}

const millTarget: InstructionHandler<'millTarget'> = ({ draft, source, item }, instruction) => {
  const target = item?.targets[0]
  if (target?.kind === 'player') {
    millLibrary(draft, target.player, instruction.count)
    return
  }
  const candidates = draft.playerOrder.filter((seat) => !draft.players[seat].lost)
  if (candidates.length === 0) return
  openPlayerSelection(draft, {
    seat: source.controller,
    sourceId: source.id,
    source: source.name,
    prompt: `Choose a player to mill ${instruction.count} cards.`,
    min: 1,
    max: 1,
    candidates,
    action: {
      kind: 'putTriggeredAbility',
      triggeringPlayer: source.controller,
      instructions: [{ kind: 'millTarget', count: instruction.count }],
    },
  })
}

const millThenRecover: InstructionHandler<'millThenRecover'> = (
  { draft, source, item },
  instruction,
) => {
  if (!instruction.fromObjectIds) {
    const ids = draft.zoneOrder[source.controller].library.slice(0, instruction.count)
    millLibrary(draft, source.controller, instruction.count)
    draft.enqueue({
      type: 'custom',
      name: INSTRUCTIONS_RESUME,
      payload: {
        sourceId: source.id,
        remaining: [{ ...instruction, fromObjectIds: ids }],
        ...(item ? { item } : {}),
      },
    })
    return
  }
  const controller = draft.players[source.controller]
  if (instruction.mana && !payCost(controller.mana, instruction.mana)) return
  if (instruction.life && controller.life < instruction.life) return
  const candidates = instruction.fromObjectIds.filter((objectId) => draft.object(objectId))
  if (candidates.length === 0) return
  const costParts = [
    instruction.mana ? `pay ${instruction.mana}` : undefined,
    instruction.life ? `pay ${instruction.life} life` : undefined,
  ].filter(Boolean)
  const costText = costParts.length > 0 ? ` ${costParts.join(' and ')} to` : ' to'
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'choose',
    count: 1,
    min: 0,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: `You may${costText} put one of those cards into your hand.`,
    destinations: ['skip', 'target'],
    fromZone: 'graveyard',
    moveSelectedTo: 'hand',
    ...(instruction.mana ? { payMana: instruction.mana } : {}),
    ...(instruction.life ? { payLife: instruction.life } : {}),
  })
}

const bounceSelf: InstructionHandler<'bounceSelf'> = ({ draft, source }) => {
  draft.enqueue({ type: 'move', objectId: source.id, to: 'hand' })
}

const finishWarpExile: InstructionHandler<'finishWarpExile'> = ({ draft, source }) => {
  const live = draft.object(source.id)
  if (!live || live.zone === 'exile' || live.zone === 'stack') return
  live.warpExiledTurn = draft.turn
  draft.enqueue({ type: 'move', objectId: live.id, to: 'exile' })
}

const exileSelf: InstructionHandler<'exileSelf'> = ({ draft, source }) => {
  if (source.zone !== 'battlefield') return
  draft.enqueue({ type: 'move', objectId: source.id, to: 'exile' })
}

const putSelfOntoBattlefield: InstructionHandler<'putSelfOntoBattlefield'> = (
  { draft, source },
) => {
  draft.enqueue({
    type: 'move',
    objectId: source.id,
    to: 'battlefield',
    controller: source.controller,
  })
}

const phaseOutTarget: InstructionHandler<'phaseOutTarget'> = ({ draft, item }) => {
  const target = item?.targets[0]
  if (target?.kind === 'object') {
    draft.enqueue({ type: 'phaseOut', objectId: target.objectId })
  }
}

const createHeroWithLandCounters: InstructionHandler<'createHeroWithLandCounters'> = (
  { draft, source },
) => {
  const lands = Object.values(draft.objects).filter((object) =>
    object.zone === 'battlefield'
    && !object.phasedOut
    && object.controller === source.controller
    && object.types.includes('Land')).length
  const hero = createToken(draft, source.controller, {
    name: 'Hero',
    types: ['Creature'],
    subtypes: ['Hero'],
    colors: [],
    power: 1,
    toughness: 1,
  })
  if (lands > 0) addPlusCounters(hero, lands)
}

const searchTargetControllerForBasicLandType: InstructionHandler<
  'searchTargetControllerForBasicLandType'
> = ({ draft, source, item }) => {
  const target = item?.targets[0]
  const targetObject = target?.kind === 'object' ? draft.object(target.objectId) : undefined
  const seat = targetObject?.controller
  if (!seat) return
  const basicTypes = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'])
  const candidates = draft.zoneOrder[seat].library.filter((objectId) => {
    const object = draft.object(objectId)
    const face = object?.frontFace ?? object
    return Boolean(face?.types.includes('Land') && face.subtypes.some((type) => basicTypes.has(type)))
  })
  openCardSelection(draft, {
    seat,
    kind: 'choose',
    count: 1,
    min: 0,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: 'You may find a land card with a basic land type.',
    destinations: ['target'],
    fromSeat: seat,
    fromZone: 'library',
    moveSelectedTo: 'battlefield',
    moveSelectedController: seat,
    after: ['shuffleLibrary'],
  })
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

const returnSelfAsEnchantment: InstructionHandler<'returnSelfAsEnchantment'> = (
  { draft, source },
) => {
  if (source.zone !== 'graveyard') return
  returnAsEnchantmentOnly(source)
  draft.enqueue({
    type: 'move',
    objectId: source.id,
    to: 'battlefield',
    controller: source.owner,
  })
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

const opponentPiles: InstructionHandler<'opponentPiles'> = (
  { draft, source, item },
  instruction,
) => {
  const targeted = item?.targets.find((target) => target.kind === 'player')
  if (targeted?.kind === 'player') {
    openOpponentPilePartition(draft, {
      opponent: targeted.player,
      controller: source.controller,
      sourceId: source.id,
      source: source.name,
      count: instruction.count,
      reveal: instruction.reveal,
      piles: instruction.piles,
    })
    return
  }
  const candidates = draft.playerOrder.filter(
    (seat) => seat !== source.controller && !draft.players[seat].lost,
  )
  if (candidates.length === 0) return
  openPlayerSelection(draft, {
    seat: source.controller,
    sourceId: source.id,
    source: source.name,
    prompt: 'Choose an opponent to separate the cards.',
    min: 1,
    max: 1,
    candidates,
    action: {
      kind: 'opponentPiles',
      count: instruction.count,
      reveal: instruction.reveal,
      piles: instruction.piles,
    },
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
    fromSeat: source.controller,
    fromZone: 'hand',
    liveZone: true,
    targetFilter: { type: 'Land' },
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
  const destination = instruction.to ?? 'battlefield'
  const count = Math.min(instruction.count ?? 1, candidates.length)
  const min = instruction.min ?? (instruction.count ? 0 : 1)
  if (count < 1 && min < 1) return
  const tapped = destination === 'battlefield' && instruction.tapped !== false
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'choose',
    count,
    min,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: destination === 'hand'
      ? `Return up to ${count} land card(s) from your graveyard to your hand.`
      : tapped
        ? 'Return a land card from your graveyard to the battlefield tapped.'
        : 'Return a land card from your graveyard to the battlefield.',
    destinations: ['target'],
    fromSeat: source.controller,
    moveSelectedTo: destination,
    tapSelected: tapped,
  })
}

const sacrificeControlled: InstructionHandler<'sacrificeControlled'> = (
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
  if (candidates.length === 0) return
  const count = Math.min(instruction.count, candidates.length)
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'sacrifice',
    count,
    min: count,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: `Sacrifice ${count} permanent(s).`,
    destinations: ['battlefield', 'sacrifice'],
    fromSeat: source.controller,
  })
}

const putTargetOnLibraryTop: InstructionHandler<'putTargetOnLibraryTop'> = (
  { draft, item },
) => {
  const target = item?.targets[0]
  if (target?.kind !== 'object') return
  draft.enqueue({ type: 'move', objectId: target.objectId, to: 'library', position: 'top' })
}

const destroyAllCreatures: InstructionHandler<'destroyAllCreatures'> = ({ draft }) => {
  for (const object of Object.values(draft.objects)) {
    if (object.zone === 'battlefield' && object.types.includes('Creature')) {
      draft.enqueue({ type: 'move', objectId: object.id, to: 'graveyard' })
    }
  }
}

const millHalfTargetPlayers: InstructionHandler<'millHalfTargetPlayers'> = (
  { draft, item },
) => {
  const seats = (item?.targets ?? [])
    .filter((target): target is Extract<typeof target, { kind: 'player' }> =>
      target.kind === 'player')
    .map((target) => target.player)
  for (const seat of seats) {
    millLibrary(draft, seat, Math.floor(draft.zoneOrder[seat].library.length / 2))
  }
}

const bounceCreaturesExcept: InstructionHandler<'bounceCreaturesExcept'> = (
  { draft },
  instruction,
) => {
  for (const object of Object.values(draft.objects)) {
    if (
      object.zone !== 'battlefield'
      || !object.types.includes('Creature')
      || instruction.subtypes.some((subtype) => object.subtypes.includes(subtype))
    ) continue
    draft.enqueue({ type: 'move', objectId: object.id, to: 'hand' })
  }
}

const revealTopLandsTapped: InstructionHandler<'revealTopLandsTapped'> = (
  { draft, source, item },
) => {
  const count = Math.max(0, item?.x ?? 0)
  const top = draft.zoneOrder[source.controller].library.slice(0, count)
  const lands: string[] = []
  const rest: string[] = []
  for (const objectId of top) {
    const object = draft.object(objectId)
    if (object?.types.includes('Land')) lands.push(objectId)
    else rest.push(objectId)
  }
  for (const objectId of lands) {
    draft.enqueue({ type: 'move', objectId, to: 'battlefield' })
    draft.enqueue({ type: 'tap', objectId })
  }
  for (const objectId of rest) {
    draft.enqueue({ type: 'move', objectId, to: 'library', position: 'bottom' })
  }
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
  devour,
  addPlusCountersFromSacrifice,
  selfMill,
  millTarget,
  millThenRecover,
  bounceSelf,
  finishWarpExile,
  exileSelf,
  putSelfOntoBattlefield,
  phaseOutTarget,
  createHeroWithLandCounters,
  searchTargetControllerForBasicLandType,
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
  returnSelfAsEnchantment,
  surveil,
  scry,
  opponentPiles,
  putLandFromHand,
  bounceChosenLand,
  revealPick,
  returnTargetFromGraveyard,
  bounceAttacking,
  revealDrawLoseLife,
  randomExileCopyWhile,
  putMilledLandTapped,
  returnChosenLandFromGraveyard,
  sacrificeControlled,
  putTargetOnLibraryTop,
  destroyAllCreatures,
  millHalfTargetPlayers,
  bounceCreaturesExcept,
  revealTopLandsTapped,
  returnCreatureManaValueX,
} satisfies Partial<InstructionHandlers>
