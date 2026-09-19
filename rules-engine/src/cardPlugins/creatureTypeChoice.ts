import { hasKeyword } from '../keywords'
import {
  DIALOG_CHOSEN,
  pendingDialogFor,
  setPendingDialog,
} from '../pendingDialog'
import type { GameObject, Plugin } from '../types'
import type { InstructionHandler } from './instructionHandlers/types'

const OTHER_TYPE = 'Other (no current creature)'
const PENDING_ACTION = 'creatureTypeChoice.action'

type TypeAction = {
  sourceId: string
  action: 'addToSource' | 'destroyOthers' | 'bounceOthers'
}

const isTypeAction = (value: unknown): value is TypeAction =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as TypeAction).sourceId === 'string'
  && ['addToSource', 'destroyOthers', 'bounceOthers'].includes(
    (value as TypeAction).action,
  )

const allTypes = (objects: Record<string, GameObject>) => [
  ...new Set(
    Object.values(objects)
      .filter((object) => object.zone === 'battlefield' && object.types.includes('Creature'))
      .flatMap((object) => object.subtypes),
  ),
].sort()

const hasAllCreatureTypes = (
  objects: Record<string, GameObject>,
  object: GameObject,
) => Object.values(objects).some((source) =>
  source.zone === 'battlefield'
  && source.controller === object.controller
  && (source.effects ?? []).some((effect) => effect.op === 'static' && effect.allCreatureTypes))

const hasChosenType = (
  objects: Record<string, GameObject>,
  object: GameObject,
  chosenType: string,
) => chosenType !== OTHER_TYPE
  && (object.subtypes.includes(chosenType) || hasAllCreatureTypes(objects, object))

export const chooseCreatureTypeInstruction: InstructionHandler<'chooseCreatureType'> = (
  { draft, source },
  instruction,
) => {
  const options = [...allTypes(draft.objects), OTHER_TYPE]
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'choose-creature-type',
    options,
    prompt: `Choose a creature type for ${source.name}.`,
    waiting: 'is choosing a creature type.',
    judge: `Waiting for ${source.name} creature-type choice.`,
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['skip', 'target'],
    requirements: { target: { min: 1, max: 1 } },
  })
  draft.players[source.controller].data[PENDING_ACTION] = {
    sourceId: source.id,
    action: instruction.action,
  }
}

const selectedType = (payload: Record<string, unknown> | undefined) => {
  const modes = payload?.modes
  return Array.isArray(modes) && typeof modes[0] === 'string' ? modes[0] : undefined
}

export const creatureTypeChoice: Plugin = {
  id: 'creatureTypeChoice',
  legal: ({ state, event }) => {
    if (event.type !== 'custom' || event.name !== DIALOG_CHOSEN || !event.seat) return
    const dialog = pendingDialogFor(state, event.seat)
    if (dialog?.kind !== 'choose-creature-type') return
    const chosenType = selectedType(event.payload)
    if (!chosenType || !dialog.options?.includes(chosenType)) {
      return `${dialog.source} requires one offered creature type`
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type !== 'custom' || event.name !== DIALOG_CHOSEN || !event.seat) return
    const dialog = pendingDialogFor(state, event.seat)
    if (dialog?.kind !== 'choose-creature-type') return
    const pending = draft.players[event.seat].data[PENDING_ACTION]
    const chosenType = selectedType(event.payload)
    if (!isTypeAction(pending) || !chosenType) return

    const source = draft.object(pending.sourceId)
    if (pending.action === 'addToSource' && source) {
      source.chosenType = chosenType
      if (chosenType !== OTHER_TYPE && !source.subtypes.includes(chosenType)) {
        source.subtypes = [...source.subtypes, chosenType]
      }
    } else {
      for (const object of Object.values(draft.objects)) {
        if (
          object.zone !== 'battlefield'
          || !object.types.includes('Creature')
          || hasChosenType(draft.objects, object, chosenType)
        ) continue
        if (pending.action === 'destroyOthers' && hasKeyword(object, 'indestructible', state)) {
          continue
        }
        draft.enqueue({
          type: 'move',
          objectId: object.id,
          to: pending.action === 'bounceOthers' ? 'hand' : 'graveyard',
        })
      }
    }
    delete draft.players[event.seat].data[PENDING_ACTION]
    draft.note(`${dialog.source} chose ${chosenType}`)
  },
}
