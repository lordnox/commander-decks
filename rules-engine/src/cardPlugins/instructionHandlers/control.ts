import { DIALOG_CHOSEN, openSourceDialog, setPendingDialog } from '../../pendingDialog'
import { STEAL_CAST_DRAW } from '../stealCast'
import { conditionHolds } from '../effects'
import { hasKeyword } from '../../keywords'
import { instructionAmount } from './helpers'
import { counterStackSpell } from '../targetedResolve'
import { instructionCount } from '../voteResult'
import type { InstructionHandler, InstructionHandlers } from './types'
import { targetObject as resolveTargetObject } from '../../objectIdentity'

const conditional: InstructionHandler<'if'> = ({ draft, source, item, run }, instruction) => {
  const live = draft.object(source.id) ?? source
  const chosen = conditionHolds(instruction.if, draft, live, item)
    ? instruction.whenTrue
    : instruction.whenFalse ?? []
  run(chosen, live)
}

const ifTargetTypes: InstructionHandler<'ifTargetTypes'> = (
  { draft, item, run, source },
  instruction,
) => {
  const target = item?.targets[0]
  const object = target?.kind === 'object' ? resolveTargetObject(draft, target) : undefined
  const chosen = object && instruction.types.some((type) => object.types.includes(type))
    ? instruction.whenTrue
    : instruction.whenFalse ?? []
  run(chosen, source)
}

const removeTarget: InstructionHandler<'removeTarget'> = (
  { draft, item },
  instruction,
) => {
  const target = item?.targets[0]
  const object = target?.kind === 'object' ? resolveTargetObject(draft, target) : undefined
  if (!object || object.phasedOut) return
  if (instruction.action === 'destroy' && hasKeyword(object, 'indestructible', draft)) return
  if (item) {
    item.payload = {
      ...item.payload,
      removedTargetController: object.controller,
    }
    if (
      draft.resolution?.kind === 'legacy'
      && draft.resolution.item.id === item.id
    ) {
      draft.resolution.item.payload = item.payload
    }
  }
  draft.enqueue({
    type: 'move',
    objectId: object.id,
    to: instruction.action === 'bounce'
      ? 'hand'
      : instruction.action === 'exile'
        ? 'exile'
        : 'graveyard',
  })
}

const repeatIf: InstructionHandler<'repeatIf'> = (
  { draft, source, item, run, appendRemaining },
  instruction,
) => {
  const live = draft.object(source.id) ?? source
  if (!instruction.spent) {
    const paused = run(instruction.do, live)
    if (paused) {
      appendRemaining({ ...instruction, spent: true })
      return
    }
  }
  if (conditionHolds(instruction.if, draft, live, item)) run(instruction.do, live)
}

const teferiSunsetEmblem: InstructionHandler<'teferiSunsetEmblem'> = ({ draft, source }) => {
  draft.enqueue({
    type: 'custom',
    name: 'teferiSunset.emblem',
    seat: source.controller,
  })
}

const putPermanentsFromHand: InstructionHandler<'putPermanentsFromHand'> = (
  { draft, source, item },
  instruction,
) => {
  const max = instructionCount(instruction.max, source.controller, item)
  if (max === 0) return
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'put-permanents',
    prompt: `You may put up to ${max} permanent cards from your hand onto the battlefield.`,
    waiting: 'is choosing permanent cards privately.',
    judge: 'Waiting for an optional permanent-card choice.',
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['hand', 'battlefield'],
    permanent: true,
    optional: true,
    requirements: { battlefield: { max } },
  })
}

const putFromHand: InstructionHandler<'putFromHand'> = (
  { draft, source, item },
  instruction,
) => {
  const max = instructionCount(instruction.max, source.controller, item)
  if (max === 0) return
  const living = draft.playerOrder.filter((seat) => !draft.players[seat].lost)
  const start = instruction.who === 'active' ? draft.active : source.controller
  const startIndex = Math.max(0, living.indexOf(start))
  const seats = instruction.who === 'each'
    ? [...living.slice(startIndex), ...living.slice(0, startIndex)]
    : [start]
  const types = instruction.types
  for (const seat of seats) {
    setPendingDialog(draft, {
      sourceId: source.id,
      source: source.name,
      seat,
      kind: 'put-permanents',
      prompt: types
        ? `You may put up to ${max} ${types.join(', ').toLowerCase()} card(s) from your hand onto the battlefield.`
        : `You may put up to ${max} permanent card(s) from your hand onto the battlefield.`,
      waiting: 'is choosing a card to put onto the battlefield.',
      judge: `Waiting for ${source.name} dump choices.`,
      chosenEvent: DIALOG_CHOSEN,
      destinations: ['hand', 'battlefield'],
      ...(types ? { types } : { permanent: true }),
      optional: instruction.optional !== false,
      sequence: draft.allocTs(),
      requirements: { battlefield: { max } },
    })
  }
  if (instruction.repeat) {
    draft.players[source.controller].data['dumpFromHand.repeat'] = {
      sourceId: source.id,
      source: source.name,
      types,
      max,
    }
  }
}

const optionalMill: InstructionHandler<'optionalMill'> = (
  { draft, source },
  instruction,
) => {
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'may',
    prompt: `You may mill ${instruction.count} cards.`,
    waiting: 'is deciding whether to mill.',
    judge: 'Waiting for an optional mill.',
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['skip', 'target'],
    count: instruction.count,
    optional: true,
  })
}

const mayPayLifeDraw: InstructionHandler<'mayPayLifeDraw'> = ({ draft, source, item }) => {
  const amount = instructionAmount('triggerAmount', item)
  if (amount <= 0) return
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'may-pay-life-draw',
    prompt: amount === 1
      ? 'You may pay 1 life. If you do, draw a card.'
      : `You may pay ${amount} life. If you do, draw ${amount} cards.`,
    waiting: 'is deciding whether to pay life to draw.',
    judge: `Waiting for ${source.name}'s optional life payment.`,
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['skip', 'target'],
    count: amount,
    optional: true,
  })
}

const mayDraw: InstructionHandler<'mayDraw'> = ({ draft, source }, instruction) => {
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: instruction.seat ?? source.controller,
    kind: 'may-draw',
    prompt: `You may draw ${instruction.count === 1 ? 'a card' : `${instruction.count} cards`}.`,
    waiting: 'is deciding whether to draw.',
    judge: `Waiting for an optional draw from ${source.name}.`,
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['skip', 'target'],
    count: instruction.count,
  })
}

const opponentMayDrawThenStealCast: InstructionHandler<'opponentMayDrawThenStealCast'> = (
  { draft, source, item },
  instruction,
) => {
  const opponent = item?.targets[0]?.kind === 'player' ? item.targets[0].player : undefined
  if (!opponent) return
  draft.players[source.controller].data[STEAL_CAST_DRAW] = {
    sourceId: source.id,
    opponent,
    count: instruction.count,
  }
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: opponent,
    kind: 'may-draw',
    prompt: `You may draw ${instruction.count} cards.`,
    waiting: 'is deciding whether to draw.',
    judge: `Waiting for ${source.name}'s optional draw.`,
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['skip', 'target'],
    count: instruction.count,
  })
}

const counterTargetSpell: InstructionHandler<'counterTargetSpell'> = (
  { draft, source, item },
  instruction,
) => {
  if (instruction.chosen) {
    // Legality is checked now: a spell that left the stack since targeting is no longer there to counter.
    const target = item?.targets[0]
    const spell = target?.kind === 'object' ? resolveTargetObject(draft, target) : undefined
    if (spell?.zone === 'stack') counterStackSpell(draft, source, spell)
    return
  }
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'counter-spell',
    prompt: 'Counter target spell.',
    waiting: 'is choosing a spell to counter.',
    judge: `Waiting for ${source.name} to pick a stack target.`,
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['skip', 'target'],
    requirements: { target: { min: 1, max: 1 } },
  })
}

const bounceTargetPermanent: InstructionHandler<'bounceTargetPermanent'> = ({ draft, source }) => {
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'bounce-permanent',
    prompt: "Return target permanent to its owner's hand.",
    waiting: 'is choosing a permanent to return.',
    judge: `Waiting for ${source.name} to pick a target.`,
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['skip', 'target'],
    requirements: { target: { min: 1, max: 1 } },
  })
}

const chooseModes: InstructionHandler<'chooseModes'> = (
  { draft, source },
  instruction,
) => {
  openSourceDialog(draft, source, {
    seat: source.controller,
    kind: 'choose-modes',
    options: instruction.modes.map((mode) => mode.label),
    prompt: instruction.choose === 'any'
      ? `${source.name}: choose any number of modes.`
      : instruction.choose === 'two'
        ? `Choose two — ${source.name}.`
        : `Choose one — ${source.name}.`,
    waiting: 'is choosing modes.',
    judge: `Waiting for ${source.name} mode choice.`,
    destinations: ['skip', 'target'],
    ...(instruction.choose === 'one'
      ? { requirements: { target: { min: 1, max: 1 } } }
      : instruction.choose === 'two'
        ? { requirements: { target: { min: 2, max: 2 } } }
        : {}),
  })
}

const searchLibrary: InstructionHandler<'searchLibrary'> = (
  { draft, source, item },
  instruction,
) => {
  if (!instruction.subtype && !instruction.spec) return
  draft.enqueue({
    type: 'custom',
    name: 'librarySearch.begin',
    seat: source.controller,
    payload: {
      source: source.name,
      sourceId: source.id,
      via: 'resolve',
      ...(instruction.subtype ? { subtype: instruction.subtype } : { spec: instruction.spec }),
      ...(item?.x !== undefined ? { x: item.x } : {}),
    },
  })
}

const counterUnlessPay: InstructionHandler<'counterUnlessPay'> = (
  { draft, source },
  instruction,
) => {
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'counter-unless',
    prompt: `Counter target noncreature spell unless its controller pays {${instruction.amount}}.`,
    waiting: 'is choosing a spell to counter.',
    judge: `Waiting for ${source.name} to pick a stack target.`,
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['skip', 'target'],
    requirements: { target: { max: 1 } },
  })
  draft.players[source.controller].data['counterUnlessPay.amount'] = instruction.amount
}

const destroyTargetPermanent: InstructionHandler<'destroyTargetPermanent'> = (
  { draft, source, item },
  instruction,
) => {
  const objectTargets = (item?.targets ?? []).flatMap((target) =>
    target.kind === 'object' ? [target.objectId] : [])
  if (objectTargets.length > 0) {
    for (const objectId of objectTargets) {
      const object = draft.object(objectId)
      if (!object || object.zone !== 'battlefield') continue
      if (instruction.types.length > 0
        && !instruction.types.some((type) => object.types.includes(type))) continue
      if (hasKeyword(object, 'indestructible', draft)) {
        draft.note(`${source.name} cannot destroy indestructible ${object.name}`)
        continue
      }
      draft.enqueue({ type: 'move', objectId, to: 'graveyard' })
      draft.note(`${source.name} destroys ${object.name}`)
    }
    return
  }
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'destroy-permanent',
    prompt: `Destroy target ${instruction.types.join(' or ').toLowerCase()}.`,
    waiting: 'is choosing a permanent to destroy.',
    judge: `Waiting for ${source.name} to pick a target.`,
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['skip', 'target'],
    types: instruction.types,
    optional: true,
    requirements: { target: { max: 1 } },
  })
}

const lookTopPutLand: InstructionHandler<'lookTopPutLand'> = (
  { draft, source },
  instruction,
) => {
  const count = instruction.countFromPower
    ? Math.max(0, source.power ?? 0)
    : instruction.count
  if (count <= 0 && !instruction.orHand) return
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'look-top-land',
    prompt: instruction.anyNumber
      ? `Look at the top ${count} cards. Put any number of land cards onto the battlefield tapped.`
      : instruction.orHand
        ? `Look at the top ${count} cards. You may put a land onto the battlefield tapped, or put a card into your hand.`
        : `Look at the top ${count} cards. You may put a land onto the battlefield tapped.`,
    waiting: 'is choosing among the top cards.',
    judge: 'Waiting for a look-top land choice.',
    chosenEvent: DIALOG_CHOSEN,
    destinations: instruction.orHand ? ['bottom', 'battlefield', 'hand'] : ['bottom', 'battlefield'],
    count,
    types: instruction.orHand ? undefined : ['Land'],
    optional: true,
    shuffleAfter: instruction.shuffleAfter,
    requirements: instruction.anyNumber
      ? { battlefield: { min: 0, max: count } }
      : instruction.orHand
        ? { battlefield: { max: 1 }, hand: { max: 1 } }
        : { battlefield: { max: 1 } },
  })
}

export const controlHandlers = {
  if: conditional,
  ifTargetTypes,
  removeTarget,
  repeatIf,
  teferiSunsetEmblem,
  putPermanentsFromHand,
  putFromHand,
  optionalMill,
  mayPayLifeDraw,
  mayDraw,
  opponentMayDrawThenStealCast,
  counterTargetSpell,
  bounceTargetPermanent,
  chooseModes,
  searchLibrary,
  counterUnlessPay,
  destroyTargetPermanent,
  lookTopPutLand,
} satisfies Partial<InstructionHandlers>
