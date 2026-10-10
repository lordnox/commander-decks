import type { LobbyState, TopdeckDecision } from './lobby'
import { InteractionStore } from '../../rules-engine/src/interaction'
import type { InteractionAnswer, InteractionSelection } from '../../shared/interaction'
import type { SeatId } from './protocol'
import type { KernelHandle } from './kernelHandle'
import {
  OPTIONAL_DIALOGS,
  assertOfferedSlots,
  type ChoiceContext,
  type TopdeckMessage,
} from './kernelChoice'
import {
  applyCastTransformed,
  applyLibrarySearch,
  applySelectCards,
  applyOptionSelection,
  applyWaitingDiscard,
} from './kernelChoiceApplyCards'
import {
  applyCumulativeUpkeep,
  applyExtortPayment,
  applyPlayerTargets,
  applySelectPlayers,
} from './kernelChoiceApplyPlayers'
import { applyStackCopy } from './kernelChoiceApplyStack'
import {
  applyChooseModes,
  applyDialogChoice,
  applyExileGraveyards,
  applyPutPermanents,
  applySacrificeLands,
  applyZoneChoice,
} from './kernelChoiceApplyDialog'

const interactionAnswerFor = (
  decision: TopdeckDecision,
  message: TopdeckMessage,
  seat: SeatId,
): InteractionAnswer => {
  if (!decision.interaction || decision.requestId === undefined || decision.revision === undefined) {
    throw new Error('This interaction is missing its server request metadata.')
  }
  const neutralDestination = (() => {
    if (decision.destinations.includes('skip')) return 'skip'
    if (decision.destinations.length > 1) return decision.destinations[0]
    return undefined
  })()
  const slots = message.choices.map((choice, index) => choice.slot ?? index)
  const selectedSlots = new Set(
    message.choices
      .map((choice, index) => neutralDestination !== undefined && choice.destination === neutralDestination
        ? undefined
        : slots[index])
      .filter((slot): slot is number => slot !== undefined),
  )
  const selection = decision.interaction.selection
  let typedSelection: InteractionSelection
  switch (selection.kind) {
    case 'selectPlayers':
      typedSelection = {
        kind: 'selectPlayers',
        ids: message.choices
          .filter(({ destination }) => decision.kernel?.stage === 'cumulative-upkeep'
            ? destination === 'target'
            : neutralDestination === undefined || destination !== neutralDestination)
          .map(({ card }) => card),
      }
      break
    case 'selectOptions':
      typedSelection = {
        kind: 'selectOptions',
        ids: [...selectedSlots].map((slot) => `${decision.requestId}:option:${slot}`),
      }
      break
    case 'selectCards':
      typedSelection = {
        kind: 'selectCards',
        ids: [...selectedSlots].map((slot) => selection.candidates[slot]?.id ?? ''),
      }
      break
    case 'order':
      typedSelection = {
        kind: 'order',
        ids: slots.map((slot) => selection.entries[slot]?.id ?? ''),
      }
      break
    default:
      typedSelection = { kind: 'selectCards', ids: [] }
      break
  }
  return {
    requestId: message.requestId ?? decision.requestId,
    revision: message.revision ?? decision.revision,
    chooser: seat,
    selection: typedSelection,
  }
}

export const applyKernelChoice = (
  kernel: KernelHandle,
  lobby: LobbyState,
  seat: SeatId,
  message: TopdeckMessage,
) => {
  const liveDecision = lobby.topdeck
  if (!liveDecision?.kernel) {
    if (!message.requestId || message.revision === undefined) return false
    const wireFingerprint = JSON.stringify({
      seat,
      requestId: message.requestId,
      revision: message.revision,
      choices: message.choices,
    })
    if (lobby.completedInteractions?.[message.requestId] !== wireFingerprint) return false
    return true
  }
  if (liveDecision.seat !== seat) return false
  const requestId = liveDecision.requestId
  if (!requestId || liveDecision.revision === undefined || !liveDecision.interaction) {
    throw new Error('This interaction is missing its server request metadata.')
  }
  if (message.requestId !== requestId) {
    throw new Error('That interaction request is stale.')
  }
  if (message.revision !== liveDecision.revision) {
    throw new Error('That interaction revision is stale.')
  }
  const interactions = new InteractionStore<TopdeckDecision, boolean>()
  interactions.restore(lobby.interactionLedger ?? [])
  const answer = interactionAnswerFor(liveDecision, message, seat)
  const accepted = interactions.answer(answer)
  if (accepted.kind === 'invalid') {
    const exactCount = Object.values(liveDecision.requirements ?? {})
      .find((requirement) => requirement?.min !== undefined && requirement.min === requirement.max)?.min
    throw new Error(accepted.error === 'card was not offered'
      ? 'That choice changed. Refresh and choose again.'
      : accepted.error === 'invalid card selection' && exactCount !== undefined
        ? `Choose exactly ${exactCount} card(s).`
      : accepted.error)
  }
  if (accepted.kind === 'duplicate') return true
  const decision = accepted.continuation
  if (!decision.kernel) throw new Error('This interaction continuation has no kernel choice.')
  lobby.interactionLedger = interactions.snapshot()
  const fingerprint = JSON.stringify({ seat, requestId, revision: decision.revision, choices: message.choices })
  const persistOutcome = (completed: boolean) => {
    const latest = new InteractionStore<TopdeckDecision, boolean>()
    latest.restore(lobby.interactionLedger ?? [])
    if (completed) latest.complete(requestId, true)
    else latest.reject(requestId)
    lobby.interactionLedger = latest.snapshot()
  }
  const context: ChoiceContext = {
    kernel,
    lobby,
    seat,
    message,
    decision: { ...decision, kernel: decision.kernel },
    state: kernel.history.current(),
  }
  // Cumulative upkeep answers with opponent names, not with the offered cards.
  try {
    if (decision.kernel.stage === 'cumulative-upkeep') {
      const applied = applyCumulativeUpkeep(context)
      persistOutcome(applied)
      if (applied) lobby.completedInteractions = { ...lobby.completedInteractions, [requestId]: fingerprint }
      return applied
    }
    assertOfferedSlots(decision.cards, message.choices)
    if (message.choices.some(({ destination }) =>
      !decision.destinations.includes(destination))) {
      throw new Error(`Invalid ${decision.kind} destination.`)
    }
    const applied = (() => {
    switch (decision.kernel.stage) {
    case 'extort-payment':
      return applyExtortPayment(context)
    case 'stack-copy':
      return applyStackCopy(context)
    case 'select-cards':
      return applySelectCards(context)
    case 'option-selection':
      return applyOptionSelection(context)
    case 'select-players':
      return applySelectPlayers(context)
    case 'waiting-discard':
      return applyWaitingDiscard(context)
    case 'battle-cast-transformed':
      return applyCastTransformed(context)
    case 'player-targets':
      return applyPlayerTargets(context)
    case 'library-search':
      return applyLibrarySearch(context)
    case 'put-land':
    case 'put-permanents':
      return applyPutPermanents(context)
    case 'choose-modes':
    case 'choose-creature-type':
      return applyChooseModes(context)
    case 'sacrifice-lands':
      return applySacrificeLands(context)
    case 'exile-graveyards':
      return applyExileGraveyards(context)
    case 'copy-creature':
    case 'fight-target':
    case 'secret-vote':
    case 'counter-spell':
    case 'bounce-permanent':
    case 'destroy-permanent':
    case 'counter-unless':
      return applyDialogChoice(context)
    case 'bounce-land':
    case 'return-land':
    case 'reveal-pick':
    case 'surveil':
      return applyZoneChoice(context)
      default:
        return OPTIONAL_DIALOGS.has(decision.kernel.stage)
        ? applyDialogChoice(context)
        : false
    }
    })()
    if (applied) {
      persistOutcome(true)
      lobby.completedInteractions = { ...lobby.completedInteractions, [requestId]: fingerprint }
    } else {
      persistOutcome(false)
    }
    return applied
  } catch (error) {
    persistOutcome(false)
    throw error
  }
}
