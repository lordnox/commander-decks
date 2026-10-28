import type Draft from '../draft'
import type { GameObject, GameState, PlayerId, Plugin } from '../types'
import {
  DIALOG_CHOSEN,
  pendingDialogFor,
  setPendingDialog,
} from '../pendingDialog'
import { payCost } from '../plugins/spells'
import type { InstructionHandler } from './instructionHandlers/types'
import { effectsOf } from './cardRules'
import type { CardInstruction, TokenSpec } from './effectDefinitions'
import { copyTokenTemplate, createToken } from './effectRuntime'

const attachedCreature = (
  state: GameState | Draft,
  source: GameObject,
) => {
  const attached = source.attachedTo ? state.objects[source.attachedTo] : undefined
  return attached?.zone === 'battlefield' && attached.types.includes('Creature')
    ? attached
    : undefined
}

const attachedInstruction = (source: GameObject) =>
  effectsOf(source)
    .flatMap((effect) => effect.op === 'trigger' ? effect.do : [])
    .find((
      instruction,
    ): instruction is Extract<CardInstruction, { kind: 'attachedCopyOrToken' }> =>
      instruction.kind === 'attachedCopyOrToken')

const createFallback = (
  draft: Draft,
  controller: PlayerId,
  token: TokenSpec,
) => {
  createToken(draft, controller, token)
}

export const attachedCopyOrTokenInstruction: InstructionHandler<'attachedCopyOrToken'> = (
  { draft, source },
  instruction,
) => {
  const attached = attachedCreature(draft, source)
  if (!attached || attached.controller !== source.controller) {
    createFallback(draft, source.controller, instruction.token)
    return
  }
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'may-pay-mana',
    prompt: `You may pay ${instruction.cost} to create a token copy of ${attached.name}.`,
    waiting: 'is deciding whether to pay for a creature copy.',
    judge: `Waiting for ${source.name}'s optional payment.`,
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['skip', 'target'],
    cost: instruction.cost,
  })
}

export const bestow: Plugin = {
  id: 'bestow',
  legal: ({ state, event }) => {
    if (event.type === 'custom' && event.name === DIALOG_CHOSEN && event.seat) {
      const dialog = pendingDialogFor(state, event.seat)
      if (dialog?.kind !== 'may-pay-mana' || event.payload?.accepted !== true) return
      if (!dialog.cost || !payCost(state.players[event.seat].mana, dialog.cost)) {
        return `not enough mana to pay ${dialog.cost ?? 'the optional cost'}`
      }
      const source = state.objects[dialog.sourceId]
      const attached = source ? attachedCreature(state, source) : undefined
      if (!source || !attached || attached.controller !== source.controller) {
        return `${dialog.source} is not attached to a creature you control`
      }
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type !== 'custom' || event.name !== DIALOG_CHOSEN || !event.seat) return
    const dialog = pendingDialogFor(state, event.seat)
    if (dialog?.kind !== 'may-pay-mana') return
    const source = draft.object(dialog.sourceId)
    const instruction = source ? attachedInstruction(source) : undefined
    if (!source || !instruction) return
    const attached = attachedCreature(draft, source)
    if (event.payload?.accepted === true && attached) {
      draft.enqueue({ type: 'payMana', seat: event.seat, cost: instruction.cost })
      createToken(draft, source.controller, copyTokenTemplate(attached))
      draft.note(`${source.name} copies ${attached.name}`)
    } else {
      createFallback(draft, source.controller, instruction.token)
    }
  },
}
