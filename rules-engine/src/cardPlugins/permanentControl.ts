import {
  changeControllerPermanent,
} from './continuousEffects'
import {
  openPlayerSelection,
  pendingPlayerSelectionFor,
} from '../rules/selectPlayers'
import type { GameObject, GameState, PlayerId, Plugin } from '../types'
import type { InstructionHandler } from './instructionHandlers/types'

export const PENDING_PERMANENT_DONATION = 'kernel.pendingPermanentDonation'

export type PendingPermanentDonation = {
  id: string
  sourceId: string
  source: string
  seat: PlayerId
  objectIds: string[]
  index: number
  assigned: Record<string, PlayerId>
  distinctWhenBalanced: boolean
}

const isDonation = (value: unknown): value is PendingPermanentDonation =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingPermanentDonation).id === 'string'
  && Array.isArray((value as PendingPermanentDonation).objectIds)

export const pendingPermanentDonation = (state: GameState): PendingPermanentDonation | undefined => {
  for (const seat of state.playerOrder) {
    const pending = state.players[seat].data[PENDING_PERMANENT_DONATION]
    if (isDonation(pending)) return pending
  }
}

const livingOpponents = (state: GameState, seat: PlayerId) =>
  state.playerOrder.filter((candidate) => candidate !== seat && !state.players[candidate]?.lost)

const requireDistinct = (donation: PendingPermanentDonation, state: GameState) =>
  donation.distinctWhenBalanced
  && donation.objectIds.length === livingOpponents(state, donation.seat).length

const candidatesFor = (
  state: GameState,
  donation: PendingPermanentDonation,
) => {
  const opponents = livingOpponents(state, donation.seat)
  if (!requireDistinct(donation, state)) return opponents
  const used = new Set(Object.values(donation.assigned))
  return opponents.filter((seat) => !used.has(seat))
}

const objectName = (state: GameState, objectId: string) =>
  state.objects[objectId]?.name ?? 'that permanent'

export const openPermanentDonationStep = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  donation: PendingPermanentDonation,
) => {
  draft.players[donation.seat].data[PENDING_PERMANENT_DONATION] = donation
  const objectId = donation.objectIds[donation.index]
  if (!objectId) {
    delete draft.players[donation.seat].data[PENDING_PERMANENT_DONATION]
    return
  }
  const candidates = candidatesFor(draft, donation)
  if (candidates.length === 0) {
    delete draft.players[donation.seat].data[PENDING_PERMANENT_DONATION]
    return
  }
  openPlayerSelection(draft, {
    seat: donation.seat,
    sourceId: donation.sourceId,
    source: donation.source,
    prompt: `Choose an opponent to gain control of ${objectName(draft, objectId)}.`,
    min: 1,
    max: 1,
    candidates,
    action: {
      kind: 'assignDonatedPermanent',
      donationId: donation.id,
      objectId,
    },
  })
}

const beginDonation = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  source: GameObject,
  objectIds: string[],
  distinctWhenBalanced: boolean,
) => {
  const onBattlefield = objectIds.filter((objectId) => {
    const object = draft.object(objectId)
    return object?.zone === 'battlefield' && object.controller === source.controller
  })
  if (onBattlefield.length === 0) return
  openPermanentDonationStep(draft, {
    id: draft.allocId('donation'),
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    objectIds: onBattlefield,
    index: 0,
    assigned: {},
    distinctWhenBalanced,
  })
}

const applyDonationChoice = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  donation: PendingPermanentDonation,
  opponent: PlayerId,
  objectId: string,
) => {
  const object = draft.object(objectId)
  if (object?.zone === 'battlefield') changeControllerPermanent(object, opponent)
  const next: PendingPermanentDonation = {
    ...donation,
    assigned: { ...donation.assigned, [objectId]: opponent },
    index: donation.index + 1,
  }
  if (next.index >= next.objectIds.length) {
    delete draft.players[donation.seat].data[PENDING_PERMANENT_DONATION]
    return
  }
  openPermanentDonationStep(draft, next)
}

export const gainControlPermanentInstruction: InstructionHandler<'gainControlPermanent'> = (
  { draft, item },
) => {
  const objectRef = item?.targets.find((target) => target.kind === 'object')
  const playerRef = item?.targets.find((target) => target.kind === 'player')
  if (objectRef?.kind !== 'object' || playerRef?.kind !== 'player') return
  const object = draft.object(objectRef.objectId)
  if (!object || object.zone !== 'battlefield') return
  changeControllerPermanent(object, playerRef.player)
}

export const pairDonateToOpponentsInstruction: InstructionHandler<'pairDonateToOpponents'> = (
  { draft, source },
  instruction,
) => beginDonation(
  draft,
  source,
  instruction.objectIds,
  instruction.distinctWhenBalanced !== false,
)

export const permanentControlHandlers = {
  gainControlPermanent: gainControlPermanentInstruction,
  pairDonateToOpponents: pairDonateToOpponentsInstruction,
}

export const permanentControl: Plugin = {
  id: 'permanentControl',
  legal: ({ state, event }) => {
    if (event.type !== 'selectPlayers') return
    const selection = pendingPlayerSelectionFor(state, event.seat)
    if (selection?.action.kind !== 'assignDonatedPermanent') return
    const donation = pendingPermanentDonation(state)
    if (!donation || donation.id !== selection.action.donationId) {
      return 'that donation assignment is not open'
    }
    const opponent = event.players[0]
    if (!opponent) return
    if (requireDistinct(donation, state) && Object.values(donation.assigned).includes(opponent)) {
      return 'each opponent can receive only one permanent'
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type !== 'selectPlayers') return
    const selection = pendingPlayerSelectionFor(state, event.seat)
    if (selection?.action.kind !== 'assignDonatedPermanent') return
    const donation = pendingPermanentDonation(state)
    const opponent = event.players[0]
    if (
      !donation
      || donation.id !== selection.action.donationId
      || !opponent
    ) return
    applyDonationChoice(draft, donation, opponent, selection.action.objectId)
  },
}
