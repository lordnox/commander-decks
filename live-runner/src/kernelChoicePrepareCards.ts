import { isKnownTo } from '../../rules-engine/src/knowledge'
import { optionalDrawOffer } from './optionalDrawPolicy'
import {
  waitingCastTransformed,
  waitingDiscard,
  waitingSelectCards,
} from '../../rules-engine/src/index'
import type { LobbyState, TopdeckDecision } from './lobby'
import { isSeatId } from './protocol'
import type { KernelHandle } from './kernelHandle'
import { discardOffer, openTopdeck, selectCardsOffer, selectCardsLibraryView } from './kernelChoice'
import { pendingOptionSelection, type PendingOptionSelection } from '../../rules-engine/src/rules/selectOptions'
import { pendingVote } from '../../rules-engine/src/cardPlugins/vote'

const pileLabel = (
  state: { objects: Record<string, { name: string }> },
  ids: string[],
  hidden: boolean,
  title: string,
) => {
  if (hidden) return `${title} (${ids.length} card${ids.length === 1 ? '' : 's'})`
  if (ids.length === 0) return `${title} (empty)`
  return `${title}: ${ids.map((id) => state.objects[id]?.name ?? 'a card').join(', ')}`
}

export const prepareWaitingDiscardChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const waiting = waitingDiscard(state)
  if (!waiting || !isSeatId(waiting.chooser)) return false
  const offer = discardOffer(state, waiting)
  const hand = offer.ids.map((objectId) => state.objects[objectId])
  const cards = offer.names
  return openTopdeck(
    lobby,
    {
      seat: waiting.chooser,
      kind: 'discard-card',
      source: state.objects[waiting.item.objectId]?.name,
      cards,
      // A seat with several cards in hand must be able to keep some of them.
      destinations: cards.length === 1 ? ['graveyard'] : ['hand', 'graveyard'],
      requirements: { graveyard: { min: waiting.count, max: waiting.count } },
      kernel: {
        sourceId: waiting.item.objectId,
        stage: 'waiting-discard',
        stackId: waiting.item.id,
      },
    },
    {
      waiting: `${lobby.occupants[waiting.chooser]?.name ?? waiting.chooser} is choosing cards to discard.`,
      prompt: `Discard ${waiting.count} card${waiting.count === 1 ? '' : 's'}.`,
      judge: 'Waiting for a discard choice on the stack.',
    },
    hand,
    { purpose: 'choice', cancellation: 'mustAnswer' },
  )
}

export const prepareCastTransformedChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const waiting = waitingCastTransformed(state)
  if (!waiting || !isSeatId(waiting.chooser)) return false
  const source = state.objects[waiting.item.objectId]
  return openTopdeck(
    lobby,
    {
      seat: waiting.chooser,
      kind: 'may',
      source: source?.name,
      cards: ['Yes'],
      destinations: ['target', 'skip'],
      requirements: { target: { min: 0, max: 1 } },
      kernel: {
        sourceId: waiting.item.objectId,
        stage: 'battle-cast-transformed',
        stackId: waiting.item.id,
      },
    },
    {
      waiting: `${lobby.occupants[waiting.chooser]?.name ?? waiting.chooser} may cast a defeated Siege transformed.`,
      prompt: `Cast ${source?.name ?? 'the defeated Siege'} transformed without paying its mana cost?`,
      judge: 'Waiting for the defeated Siege casting choice.',
    },
    [],
    { phase: 'resolution', purpose: 'choice', cancellation: 'mustAnswer' },
  )
}

export const prepareSelectCardsChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const waiting = waitingSelectCards(state)
  if (!waiting) return false
  const seat = waiting.selection.seat
  if (!isSeatId(seat)) return false
  const { selection, count } = waiting
  const offer = selectCardsOffer(waiting)
  if (selection.kind === 'choosePile') {
    const piles = selection.piles ?? { 'face-up': [], 'face-down': [] }
    const hideFaceDown = selection.pileVisibility === 'facedown-faceup'
    const choosingOnly = selection.destinations?.includes('target') === true
    const pileCards = [
      pileLabel(state, piles['face-up'], piles['face-up'].some(id => !isKnownTo(state.objects[id]!, seat, state.playerOrder)), selection.pileLabels?.['face-up'] ?? 'Face-up pile'),
      pileLabel(state, piles['face-down'], hideFaceDown && piles['face-down'].some(id => !isKnownTo(state.objects[id]!, seat, state.playerOrder)), selection.pileLabels?.['face-down'] ?? 'Face-down pile'),
    ]
    return openTopdeck(
      lobby,
      {
        seat,
        kind: 'choosePile',
        source: selection.source,
        cards: pileCards,
        destinations: choosingOnly ? ['skip', 'target'] : ['graveyard', 'hand'],
        requirements: choosingOnly ? { target: { min: 1, max: 1 } } : { hand: { min: 1, max: 1 } },
        kernel: {
          sourceId: selection.sourceId ?? '',
          stage: 'select-cards',
          selectionId: selection.id,
          cardKind: selection.kind,
        },
      },
      {
        waiting: `${lobby.occupants[seat]?.name ?? seat} is choosing a pile.`,
        prompt: selection.prompt ?? 'Put one pile into your hand and the other into your graveyard.',
        judge: selection.source
          ? `Waiting for a pile choice for ${selection.source}.`
          : 'Waiting for a pile choice.',
      },
    )
  }
  const destinations = (selection.destinations
    ?? (selection.kind === 'scry'
      ? ['top', 'bottom']
      : selection.kind === 'surveil'
        ? ['top', 'graveyard']
        : selection.kind === 'partition'
          ? ['face-up', 'face-down']
        : selection.kind === 'reveal'
          ? ['hand', 'reveal']
        : selection.kind === 'choose'
          ? ['target']
        : selection.kind === 'sacrifice'
          ? ['battlefield', 'sacrifice']
          : ['graveyard'])) as TopdeckDecision['destinations']
  const requirements = selection.kind === 'sacrifice'
    ? { sacrifice: { min: selection.min ?? count, max: count } }
    : selection.kind === 'discard'
      ? { graveyard: { min: count, max: count } }
      : selection.kind === 'reveal'
        ? { reveal: { min: selection.min ?? count, max: count } }
      : selection.kind === 'choose'
        ? {
            [selection.moveSelectedTo && selection.destinations?.some(
              (destination) => destination === selection.moveSelectedTo,
            )
              ? selection.moveSelectedTo
              : 'target']: {
              min: selection.min ?? count,
              max: count,
            },
          }
      : selection.handQuota !== undefined
        ? { hand: { min: Math.min(selection.handQuota, count), max: Math.min(selection.handQuota, count) } }
      : undefined
  const library = selectCardsLibraryView(state, selection)
  return openTopdeck(
    lobby,
    {
      seat,
      kind: selection.kind === 'discard'
        ? 'discard-card'
        : selection.handQuota !== undefined
          ? 'look-top'
          : selection.kind,
      source: selection.source,
      cards: offer.names,
      ...(library !== undefined ? { library } : {}),
      destinations,
      count,
      ...(requirements ? { requirements } : {}),
      kernel: {
        sourceId: selection.sourceId ?? '',
        stage: 'select-cards',
        selectionId: selection.id,
        cardKind: selection.kind,
      },
    },
    {
      waiting: `${lobby.occupants[seat]?.name ?? seat} is choosing cards.`,
      prompt: selection.prompt ?? `Choose ${count} card${count === 1 ? '' : 's'}.`,
      judge: selection.source
        ? `Waiting for a choice from ${lobby.occupants[seat]?.name ?? seat} for ${selection.source}.`
        : `Waiting for a choice from ${lobby.occupants[seat]?.name ?? seat}.`,
    },
    offer.ids.map((objectId) => state.objects[objectId]),
    {
      phase: selection.action?.kind === 'dredge' || selection.canonicalChoice?.action === 'replacementProgram'
        ? 'replacement'
        : 'resolution',
      purpose: selection.triggerOrder || selection.canonicalChoice?.action === 'replacementProgram'
        ? 'order'
        : 'choice',
      cancellation: 'mustAnswer',
    },
  )
}

const optionSelectionMetadata = (pending: PendingOptionSelection) => {
  switch (pending.action.kind) {
    case 'replacementProgramChoice':
    case 'replacementModifier':
      return {
        phase: 'replacement' as const,
        purpose: 'replacement' as const,
        cancellation: 'mustAnswer' as const,
      }
    default:
      return undefined
  }
}

export const prepareOptionSelectionChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const pending = pendingOptionSelection(state)
  if (!pending || !isSeatId(pending.seat)) return false
  const name = lobby.occupants[pending.seat]?.name ?? pending.seat
  if (pending.action.kind === 'putCanonicalTriggeredAbilityAllocation') {
    const allocation = pending.action
    const bound = allocation.bounds[allocation.specIndex]
    const remaining = allocation.recipientCount - allocation.allocationIndex
    const allocated = allocation.amounts.reduce((sum, amount) => sum + amount, 0)
    return openTopdeck(lobby, {
      seat: pending.seat, kind: 'allocate', source: pending.source, cards: [], destinations: ['target'],
      kernel: { sourceId: pending.sourceId ?? '', stage: 'allocation', selectionId: pending.id },
      allocationOffer: {
        entries: remaining === 0
          ? []
          : Array.from({ length: remaining }, (_v, index) => ({
              id: `target:${allocation.allocationIndex + index}`,
              label: `Target ${allocation.allocationIndex + index + 1}`,
            })),
        total: bound.total - allocated,
        minEach: bound.minEach,
      },
    }, { waiting: `${name} is allocating.`, prompt: pending.prompt, judge: 'Waiting for a distribution allocation.' })
  }
  const open = pending.action.kind === 'vote' ? pendingVote(state) : undefined
  const secret = open?.secret ? 'secret ' : 'public '
  const drawOffer = optionalDrawOffer(state, pending)
  return openTopdeck(
    lobby,
    {
      seat: pending.seat,
      kind: open ? 'vote' : 'choose',
      ...(drawOffer ? { optionalDraw: drawOffer } : {}),
      source: pending.source,
      cards: pending.options.map((option) => option.label),
      destinations: ['skip', 'target'],
      requirements: { target: { min: 1, max: 1 } },
      kernel: {
        sourceId: pending.sourceId ?? '',
        stage: 'option-selection',
        selectionId: pending.id,
      },
    },
    {
      waiting: open
        ? `${name} is voting${open.secret ? ' in secret' : ''}.`
        : `${name} is choosing privately.`,
      prompt: drawOffer ? 'You may draw. Accept or decline?' : pending.prompt,
      judge: open
        ? `Waiting for ${open.source}'s ${secret}vote.`
        : pending.source
          ? `Waiting for a choice for ${pending.source}.`
          : 'Waiting for a private choice.',
    },
    [],
    optionSelectionMetadata(pending),
  )
}
