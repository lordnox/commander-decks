import { DIALOG_CHOSEN, openSourceDialog, setPendingDialog } from '../../pendingDialog'
import { conditionHolds } from '../effects'
import type { InstructionHandler, InstructionHandlers } from './types'

const conditional: InstructionHandler<'if'> = ({ draft, source, item, run }, instruction) => {
  const live = draft.object(source.id) ?? source
  const chosen = conditionHolds(instruction.if, draft, live, item)
    ? instruction.whenTrue
    : instruction.whenFalse ?? []
  run(chosen, live)
}

const lookTopChooseOne: InstructionHandler<'lookTopChooseOne'> = (
  { draft, source },
  instruction,
) => {
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'look-top',
    prompt: `Look at the top ${instruction.count} cards. Put one into your hand and the rest on the bottom in any order.`,
    waiting: 'is making a private top-card choice.',
    judge: 'Waiting for a private top-card choice.',
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['bottom', 'hand'],
    count: instruction.count,
    requirements: { hand: { min: 1, max: 1 } },
  })
}

const teferiSunsetEmblem: InstructionHandler<'teferiSunsetEmblem'> = ({ draft, source }) => {
  draft.enqueue({
    type: 'custom',
    name: 'teferiSunset.emblem',
    seat: source.controller,
  })
}

const putPermanentsFromHand: InstructionHandler<'putPermanentsFromHand'> = (
  { draft, source },
  instruction,
) => {
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'put-permanents',
    prompt: `You may put up to ${instruction.max} permanent cards from your hand onto the battlefield.`,
    waiting: 'is choosing permanent cards privately.',
    judge: 'Waiting for an optional permanent-card choice.',
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['hand', 'battlefield'],
    permanent: true,
    optional: true,
    requirements: { battlefield: { max: instruction.max } },
  })
}

const putFromHand: InstructionHandler<'putFromHand'> = (
  { draft, source },
  instruction,
) => {
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
        ? `You may put up to ${instruction.max} ${types.join(', ').toLowerCase()} card(s) from your hand onto the battlefield.`
        : `You may put up to ${instruction.max} permanent card(s) from your hand onto the battlefield.`,
      waiting: 'is choosing a card to put onto the battlefield.',
      judge: `Waiting for ${source.name} dump choices.`,
      chosenEvent: DIALOG_CHOSEN,
      destinations: ['hand', 'battlefield'],
      ...(types ? { types } : { permanent: true }),
      optional: instruction.optional !== false,
      sequence: draft.allocTs(),
      requirements: { battlefield: { max: instruction.max } },
    })
  }
  if (instruction.repeat) {
    draft.players[source.controller].data['dumpFromHand.repeat'] = {
      sourceId: source.id,
      source: source.name,
      types,
      max: instruction.max,
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
      : `Choose one — ${source.name}.`,
    waiting: 'is choosing modes.',
    judge: `Waiting for ${source.name} mode choice.`,
    destinations: ['skip', 'target'],
    ...(instruction.choose === 'one'
      ? { requirements: { target: { min: 1, max: 1 } } }
      : {}),
  })
}

const searchLibrary: InstructionHandler<'searchLibrary'> = (
  { draft, source },
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
  { draft, source },
  instruction,
) => {
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
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'look-top-land',
    prompt: `Look at the top ${instruction.count} cards. You may put a land onto the battlefield tapped.`,
    waiting: 'is choosing among the top cards.',
    judge: 'Waiting for a look-top land choice.',
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['bottom', 'battlefield'],
    count: instruction.count,
    types: ['Land'],
    optional: true,
    requirements: { battlefield: { max: 1 } },
  })
}

export const controlHandlers = {
  if: conditional,
  lookTopChooseOne,
  teferiSunsetEmblem,
  putPermanentsFromHand,
  putFromHand,
  optionalMill,
  mayDraw,
  chooseModes,
  searchLibrary,
  counterUnlessPay,
  destroyTargetPermanent,
  lookTopPutLand,
} satisfies Partial<InstructionHandlers>
