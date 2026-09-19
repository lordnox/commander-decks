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

const bestowEffect = (source: GameObject) =>
  effectsOf(source).find((effect) => effect.op === 'bestow')

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

const detachInvalidAuras = (
  draft: Draft,
) => {
  for (const source of Object.values(draft.objects)) {
    const effect = bestowEffect(source)
    if (!effect || !source.subtypes.includes('Aura') || !source.attachedTo) continue
    const target = draft.object(source.attachedTo)
    if (
      source.zone === 'battlefield'
      && target?.zone === 'battlefield'
      && target.types.includes('Creature')
    ) continue
    if (target) {
      if (target.power !== null) target.power -= effect.power
      if (target.toughness !== null) target.toughness -= effect.toughness
    }
    source.attachedTo = null
  }
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
    if (event.type === 'castSpell' && event.castOption === 'bestow') {
      const source = state.objects[event.objectId]
      if (!source || !bestowEffect(source)) return
      const target = event.targets?.[0]
      if (target?.kind !== 'object') return `${source.name} bestow requires a creature target`
      const object = state.objects[target.objectId]
      if (!object || object.zone !== 'battlefield' || !object.types.includes('Creature')) {
        return `illegal target for ${source.name}`
      }
      return
    }
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
    detachInvalidAuras(draft)

    if (event.type === 'resolveTop') {
      const item = state.stack[0]
      const source = item ? draft.object(item.objectId) : undefined
      const effect = source ? bestowEffect(source) : undefined
      if (item?.castOption !== 'bestow' || !source || !effect) return
      const targetRef = item.targets[0]
      const target = targetRef?.kind === 'object'
        ? draft.object(targetRef.objectId)
        : undefined
      if (!target || target.zone !== 'battlefield' || !target.types.includes('Creature')) {
        // CR 702.102c: an illegally targeted bestowed Aura resolves as a creature.
        draft.note(`${source.name}'s bestow target is illegal; it enters as a creature`)
        return
      }
      source.types = ['Enchantment']
      source.subtypes = ['Aura']
      source.attachedTo = target.id
      source.power = null
      source.toughness = null
      source.summoningSickness = false
      if (target.power !== null) target.power += effect.power
      if (target.toughness !== null) target.toughness += effect.toughness
      draft.note(`${source.name} enters attached to ${target.name}`)
      return
    }

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
