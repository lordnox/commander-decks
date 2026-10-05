import { payCost } from '../plugins/spells'
import type { GameState, HookCtx, PlayerId, Plugin, StackItem } from '../types'
import { runInstructions, type CardInstruction } from './effects'
import { addAttackBan, type AttackBanAdd } from './attackBan'
import type { InstructionHandler } from './instructionHandlers/types'

export const PENDING_OPTIONAL_MANA = 'kernel.pendingOptionalManaPay'

export type PendingOptionalManaPay = {
  id: string
  payer: PlayerId
  cost: string
  sourceId: string
  source: string
  ifNot: CardInstruction[]
  protectorController: PlayerId
  item?: StackItem
}

const isPending = (value: unknown): value is PendingOptionalManaPay =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingOptionalManaPay).id === 'string'
  && typeof (value as PendingOptionalManaPay).payer === 'string'

export const pendingOptionalManaPayFor = (
  state: Pick<GameState, 'players'>,
  seat: PlayerId,
) => {
  const value = state.players[seat]?.data[PENDING_OPTIONAL_MANA]
  return isPending(value) ? value : undefined
}

export const pendingOptionalManaPay = (state: GameState) => {
  for (const seat of state.playerOrder) {
    const pending = pendingOptionalManaPayFor(state, seat)
    if (pending) return pending
  }
}

const allowedDuringPayment = new Set([
  'tapForMana',
  'addMana',
  'payOptionalMana',
  'authoritativeSync',
  'concede',
])

export const openOptionalManaPay = (
  draft: HookCtx['draft'],
  options: {
    payer: PlayerId
    cost: string
    sourceId: string
    source: string
    ifNot: CardInstruction[]
    protectorController: PlayerId
    item?: StackItem
  },
) => {
  const id = draft.allocTs().toString()
  draft.players[options.payer].data[PENDING_OPTIONAL_MANA] = {
    id,
    payer: options.payer,
    cost: options.cost,
    sourceId: options.sourceId,
    source: options.source,
    ifNot: options.ifNot,
    protectorController: options.protectorController,
    ...(options.item ? { item: options.item } : {}),
  } satisfies PendingOptionalManaPay
  draft.note(`${options.payer} may pay ${options.cost} (${options.source})`)
}

const payerSeat = (draft: { active: PlayerId }, payer: 'active' | 'controller', controller: PlayerId) =>
  payer === 'active' ? draft.active : controller

const opponentMayPayMana: InstructionHandler<'opponentMayPayMana'> = (
  { draft, source, item },
  instruction,
) => {
  openOptionalManaPay(draft, {
    payer: payerSeat(draft, instruction.payer, source.controller),
    cost: instruction.cost,
    sourceId: source.id,
    source: source.name,
    ifNot: instruction.ifNot,
    protectorController: source.controller,
    item,
  })
}

const attackBanUntilEot: InstructionHandler<'attackBanUntilEot'> = (
  { draft, source },
  instruction,
) => {
  const attackerController = instruction.attackerController === 'active'
    ? draft.active
    : source.controller
  addAttackBan(draft, {
    turn: draft.turn,
    attackerController,
    defenderFilter: instruction.defenderFilter,
    protectorController: source.controller,
  } satisfies AttackBanAdd)
}

export const optionalManaPayInstructionHandlers = {
  opponentMayPayMana,
  attackBanUntilEot,
}

export const optionalManaPay: Plugin = {
  id: 'optionalManaPay',
  legal: ({ state, event }) => {
    const pending = pendingOptionalManaPay(state)
    if (pending && !allowedDuringPayment.has(event.type)) {
      return `${pending.payer} must choose whether to pay ${pending.cost}`
    }
    if (event.type !== 'payOptionalMana') return
    const choice = pendingOptionalManaPayFor(state, event.seat)
    if (!choice || choice.id !== event.pendingId) {
      return 'that optional payment is no longer open'
    }
    if (event.cost && !payCost(state.players[event.seat].mana, event.cost)) {
      return `${event.seat} cannot pay ${event.cost}`
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type !== 'payOptionalMana') return
    const choice = pendingOptionalManaPayFor(state, event.seat)
    if (!choice || choice.id !== event.pendingId) return
    delete draft.players[event.seat].data[PENDING_OPTIONAL_MANA]
    const source = draft.object(choice.sourceId)
    if (!source) return
    if (!event.cost) {
      draft.note(`${event.seat} declines to pay ${choice.cost}`)
      runInstructions(draft, source, choice.ifNot, choice.item)
      return
    }
    const paid = payCost(draft.players[event.seat].mana, event.cost)
    if (!paid) return
    draft.players[event.seat].mana = paid
    draft.note(`${event.seat} pays ${event.cost} (${choice.source})`)
  },
}
