import type Draft from '../draft'
import { loadDefinitionSnapshot } from '../cardPlugins/dsl/compiler'
import { canonicalChoiceAnnouncement, continueCanonicalModeTargets, continueCanonicalTargetSelection, stackCanonical } from './canonicalAnnouncement'
import type { CanonicalAnnouncement, CanonicalChoicePayload } from './canonicalAnnouncement'
import { canonicalModeScopeId, canonicalTargetCandidates } from '../cardPlugins/dsl/compiler/targeting'
import type { DistributionAllocation } from '../cardPlugins/dsl/compiler/modes'
import { copyTargetsWithReplacement, validateCanonicalCopyTarget } from '../cardPlugins/dsl/copies'
import { objectIdentity } from '../objectIdentity'
import { openCardSelection } from './selectCards'
import { openPlayerSelection } from './selectPlayers'
import { validateModeSelection } from '../cardPlugins/dsl/compiler/modes'
import type { CanonicalResolutionFrame, CanonicalTargetBinding, CapturedObject, EventTrace, GameEvent, GameState, ManaPool, ObjectIdentity, PlayerId, Plugin, StackExecutionContext, TargetRef } from '../types'
import type { CardRuleDefinitionSnapshotV1, Cost, DecisionsInput, DistributionSpec, Instruction, TargetClause } from '../cardPlugins/dsl/schema/v1'
import { allocationOptions } from './canonicalAllocation'
import { captureLexicalBindings, generatedAbilitySnapshot } from '../cardPlugins/dsl/generatedPrograms'
import { canPayResolutionMana, eligibleResolutionManaAbilities, payResolutionMana, resolutionPaymentCandidates } from '../cardPlugins/dsl/resolutionPayment'
import type { ResolutionManaActivation, ResolutionPaymentBindings } from '../cardPlugins/dsl/resolutionPayment'

export const PENDING_OPTION_SELECTION = 'kernel.pendingOptionSelection'

export const openNextCopySlot = (draft: Draft, frame: CanonicalResolutionFrame): void => {
  const jobs = frame.pendingCopyTargets ?? []
  const job = jobs[0]
  if (!job) {
    delete draft.players[frame.controller].data[PENDING_OPTION_SELECTION]
    return
  }
  const original = draft.stack.find((item) => item.id === job.originalStackId)
  if (!original) {
    frame.pendingCopyTargets = jobs.slice(1)
    return openNextCopySlot(draft, frame)
  }
  const slot = job.slotCursor ?? 0
  if (slot >= job.targets.length) {
    frame.afterChoiceEvents = [...(frame.afterChoiceEvents ?? []), {
      type: 'copySpell', stackId: original.id, controller: job.controller,
      targets: structuredClone(job.answers ?? job.targets), retarget: (job.changedIndices?.length ?? 0) > 0,
      sourceId: frame.source.ref.objectId,
    }]
    frame.pendingCopyTargets = jobs.slice(1)
    return openNextCopySlot(draft, frame)
  }
  openOptionSelection(draft, {
    seat: job.controller,
    sourceId: frame.source.ref.objectId,
    source: frame.source.snapshot.name,
    prompt: `Keep target ${slot + 1} or choose a new target.`,
    options: [
      { id: 'keep', label: 'Keep the original target' },
      { id: 'retarget', label: 'Choose a new target' },
    ],
    action: { kind: 'canonical-copy-retarget', stackId: frame.stackId, copyStackId: original.id, controller: job.controller, slotIndex: slot },
  })
}

export const advanceCopySlot = (draft: Draft, frame: CanonicalResolutionFrame, replacement?: TargetRef) => {
  const job = frame.pendingCopyTargets?.[0]
  if (!job) return openNextCopySlot(draft, frame)
  const slot = job.slotCursor ?? 0
  const answer = replacement ?? job.targets[slot]
  if (answer) {
    job.answers = [...(job.answers ?? []), answer]
    if (JSON.stringify(answer) !== JSON.stringify(job.targets[slot])) {
      job.changedIndices = [...(job.changedIndices ?? []), slot]
    }
  }
  job.slotCursor = slot + 1
  openNextCopySlot(draft, frame)
}

export type PendingOptionSelection = {
  id: string
  seat: PlayerId
  sourceId?: string
  source?: string
  prompt: string
  options: Array<{ id: string; label: string }>
  action: {
    /** Pay this much life or the warded spell or ability is countered. */
    kind: 'ward-life'
    life: number
  } | {
    /** Each remaining seat, in turn order, is asked after this one answers. */
    kind: 'wheel'
    count: number
    remaining: PlayerId[]
  } | {
    kind: 'hidden-piles-reveal'
    piles: [string[], string[]]
    opponents: PlayerId[]
    lifeLoss: number
  } | {
    kind: 'hidden-piles-take'
    piles: [string[], string[]]
    lifeLoss: number
  } | {
    kind: 'vote'
    voteId: string
    /** Whose vote this answers; a vote chooser answers for each voter in turn. */
    voter: PlayerId
  } | {
    /** Pool to add for each offered option id. */
    kind: 'mana-choice'
    pools: Record<string, Partial<ManaPool>>
  } | {
    /** The color a permanent stores as it enters. */
    kind: 'choose-color'
  } | {
    /** Optional proliferate recipients selected during resolution. */
    kind: 'canonicalProliferateChoice'
    stackId: string
    recipients: Array<{ id: string; kind: 'object' | 'player'; objectId?: string; seat?: PlayerId; counter: string }>
  } | {
    /** A canonical resolution program choice; the frame remains private. */
    kind: 'canonicalInstructionChoice'
    stackId: string
    scopeId?: string
    options: readonly { id: string; instructions: readonly Instruction[] }[]
  } | {
    kind: 'canonical-copy-retarget'
    stackId: string
    copyStackId: string
    controller: PlayerId
    slotIndex?: number
  } | {
    kind: 'canonical-copy-stack-target'
    stackId: string
    copyStackId: string
    controller: PlayerId
    slotIndex?: number
  } | {
    kind: 'replacementModifier'
    frameId: string
    candidateIds: readonly string[]
  } | {
    /** A replacement application procedure is waiting for a bound option (e.g. chosen color). */
    kind: 'replacementProgramChoice'
    frameId: string
    bindChoice: string
  } | {
    kind: 'replacementInstructionChoice'
    frameId: string
    options: readonly { id: string; instructions: readonly Instruction[] }[]
  } | {
    /** A resolution-time payment is answered by its payer while its parent frame remains active. */
    kind: 'canonicalResolutionPayment'
    stackId: string
    scopeId?: string
    cost: Cost
    source: CapturedObject
    controller: PlayerId
    bindResult: string
    whenPaidDecisions?: DecisionsInput
    ifPaid: readonly Instruction[]
    ifDeclined: readonly Instruction[]
    whenPaid: readonly Instruction[]
    paymentAmount: number
    bindings?: ResolutionPaymentBindings
    manaActivations?: readonly ResolutionManaActivation[]
  } | {
    kind: 'putCanonicalModeTriggeredAbility'
    definitionSnapshot: CardRuleDefinitionSnapshotV1
    abilityIndex: number
    execution: StackExecutionContext
    sourceId: string
    targets: TargetRef[]
    targetBindings: CanonicalTargetBinding[]
    modeCount: number
    repeatable: boolean
    selectedModes: number[]
    modeClauses?: TargetClause[]
    modeClausesByMode?: TargetClause[][]
    baseTargetClauses?: TargetClause[]
    baseTargetScopeIds?: string[]
    baseTargetModeIndices?: Array<number | undefined>
    modeScopeIds?: string[]
    distributionBounds?: Array<{ total: number; minEach: number }>
  } | ({
    kind: 'putCanonicalStackTarget'
    selectedStackTargets: string[]
  } & CanonicalChoicePayload) | {
    /** Announcement-time trigger allocation, one original target slot at a time. */
    kind: 'putCanonicalTriggeredAbilityAllocation'
    announcement: CanonicalAnnouncement
    specs: DistributionSpec[]
    bounds: Array<{ total: number; minEach: number }>
    allocations: DistributionAllocation[]
    recipientCounts: number[]
    specIndex: number
    recipientCount: number
    allocationIndex: number
    amounts: number[]
  }
}

const isPending = (value: unknown): value is PendingOptionSelection =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingOptionSelection).id === 'string'
  && typeof (value as PendingOptionSelection).seat === 'string'
  && Array.isArray((value as PendingOptionSelection).options)

export const pendingOptionSelection = (
  state: GameState | Draft,
  seat?: PlayerId,
) => {
  if (seat) {
    const value = state.players[seat]?.data[PENDING_OPTION_SELECTION]
    return isPending(value) ? value : undefined
  }
  for (const player of state.playerOrder) {
    const value = state.players[player]?.data[PENDING_OPTION_SELECTION]
    if (isPending(value)) return value
  }
}

export const openOptionSelection = (
  draft: Draft,
  selection: Omit<PendingOptionSelection, 'id'>,
) => {
  draft.players[selection.seat].data[PENDING_OPTION_SELECTION] = {
    id: draft.allocId('option'),
    ...selection,
  }
  switch (selection.action.kind) {
    case 'putCanonicalTriggeredAbilityAllocation':
    case 'replacementModifier':
    case 'replacementProgramChoice':
    case 'replacementInstructionChoice':
    case 'choose-color':
      draft.priority = null
      break
    default:
      if (!draft.resolution) draft.priority = selection.seat
  }
}

const finishCanonicalAllocation = (
  draft: Draft,
  seat: PlayerId,
  announcement: CanonicalAnnouncement,
  bounds: Array<{ total: number; minEach: number }>,
  allocations: DistributionAllocation[],
) => {
  delete draft.players[seat].data[PENDING_OPTION_SELECTION]
  stackCanonical(draft, {
    ...announcement,
    distributionBounds: bounds,
    execution: {
      ...announcement.execution,
      distributionBindings: allocations,
      distributionBounds: bounds,
    },
  })
  draft.priority = null
}

export const queuePaidReflexive = (
  draft: Draft,
  action: Extract<PendingOptionSelection['action'], { kind: 'canonicalResolutionPayment' }>,
  payer: PlayerId,
) => {
  if (action.whenPaid.length === 0) return
  const occurrence = { kind: 'event' as const, eventType: 'resolutionPayment', player: payer }
  const parentFrame = draft.resolution?.kind === 'canonicalSpell' && draft.resolution.stackId === action.stackId
    ? draft.resolution
    : undefined
  const parentItem = draft.stack.find((item) => item.id === action.stackId)
  const parentAbilityIndex = parentFrame ? Number.parseInt(parentFrame.declarationPath.match(/abilities\[(\d+)\]/)?.[1] ?? '', 10) : Number.NaN
  const parentAbility = Number.isInteger(parentAbilityIndex)
    ? parentFrame?.definitionSnapshot.definition.abilities[parentAbilityIndex]
    : undefined
  const inheritedVariables = parentAbility && 'decisions' in parentAbility
    ? parentAbility.decisions.variables
    : undefined
  const captured = captureLexicalBindings(
    action.whenPaid,
    parentFrame?.choices,
    parentFrame?.results,
    action.whenPaidDecisions ? [action.whenPaidDecisions] : [],
  )
  const whenPaidDecisions = action.whenPaidDecisions
    ? captured.rewrittenAdditionalValues[0] as typeof action.whenPaidDecisions
    : undefined
  const generatedDecisions = {
    targets: whenPaidDecisions?.targets ?? [],
    ...(whenPaidDecisions?.constraints ? { constraints: whenPaidDecisions.constraints } : {}),
    ...(whenPaidDecisions?.variables ? { variables: whenPaidDecisions.variables } : inheritedVariables ? { variables: inheritedVariables } : {}),
    ...(whenPaidDecisions?.distributions ? { distributions: whenPaidDecisions.distributions } : {}),
  }
  const generatedOn = parentAbility?.kind === 'triggered'
    ? parentAbility.on
    : { kind: 'draw' as const, filter: {} }
  const capturedOccurrence = action.bindings?.capturedOccurrence
    ?? action.bindings?.occurrence
    ?? parentItem?.execution?.capturedOccurrence
    ?? parentItem?.execution?.occurrence
    ?? occurrence
  const definitionSnapshot = generatedAbilitySnapshot({
    kind: 'triggered',
    on: generatedOn,
    decisions: generatedDecisions,
    capturedBindings: captured.capturedBindings,
    instructions: captured.instructions,
  }, generatedDecisions, captured.capturedBindings)
  draft.pendingTriggers = [...(draft.pendingTriggers ?? []), {
    id: draft.allocId('reflexive'),
    source: structuredClone(action.source.snapshot),
    instructions: [],
    effect: { do: [] },
    execution: {
      controller: action.controller,
      source: structuredClone(action.source),
      occurrence,
      ...(captured.capturedBindings.occurrence
        ? {
            capturedOccurrence: structuredClone(capturedOccurrence),
            capturedOccurrenceBindings: captured.capturedBindings.occurrence,
          }
        : {}),
      ...(parentFrame?.choices ? { choices: structuredClone(parentFrame.choices) } : {}),
      ...(parentFrame?.results ? { results: structuredClone(parentFrame.results) } : {}),
      ...(Object.keys(captured.choiceAliases).length > 0 ? { capturedChoiceAliases: captured.choiceAliases } : {}),
      ...(Object.keys(captured.resultAliases).length > 0 ? { capturedResultAliases: captured.resultAliases } : {}),
      ...(parentItem?.x !== undefined ? { variables: { X: parentItem.x } } : {}),
      definitionSnapshot,
      abilityIndex: 0,
    },
    canonical: {
      definitionSnapshot,
      abilityIndex: 0,
    },
    triggeredByAbility: true,
    triggeringPlayer: payer,
  }]
  draft.note(`resolution payment paid; reflexive program ${action.bindResult} queued for checkpoint`)
}

/** Commit a card payment only after every discard/sacrifice event has settled. */
const samePaymentEvent = (left: GameEvent, right: GameEvent) => JSON.stringify(left) === JSON.stringify(right)

export const settleResolutionPayment = (draft: Draft, trace: readonly EventTrace[] = []) => {
  const frame = draft.resolution
  const pending = frame?.kind === 'canonicalSpell' ? frame.pendingResolutionPayment : undefined
  if (!frame || frame.kind !== 'canonicalSpell' || !pending?.paymentEvents) return
  const eventWasApplied = (event: GameEvent) => trace.some((entry) =>
    samePaymentEvent(entry.event, event) && entry.outcome === 'applied')
  const eventWasReplaced = (event: GameEvent) => trace.some((entry) =>
    samePaymentEvent(entry.event, event) && entry.outcome === 'replaced')
  const objectSettled = (identity: ObjectIdentity) => {
    const object = draft.object(identity.objectId)
    return !object || object.incarnation !== identity.incarnation || object.zone !== identity.zone
  }
  const cardsSettled = pending.selected?.every(objectSettled) ?? false
  const cardsHaveOutcome = pending.paymentEvents.every((event, index) =>
    eventWasApplied(event)
    || (eventWasReplaced(event) && pending.selected?.[index] !== undefined && objectSettled(pending.selected[index]!)))
  const lifeEvent = pending.cost.kind === 'life' ? pending.paymentEvents[0] : undefined
  const lifeSettled = lifeEvent
    ? eventWasApplied(lifeEvent)
      && trace.some((entry) => entry.event.type === 'loseLife'
        && entry.event.seat === pending.payer
        && entry.event.amount === pending.amount
        && entry.event.source === pending.source.ref.objectId
        && entry.outcome === 'applied')
    : false
  const paid = pending.cost.kind === 'life'
    ? lifeSettled
    : cardsSettled && cardsHaveOutcome
  delete frame.pendingResolutionPayment
  if (!paid) {
    const scopeIndex = frame.scopes.findLastIndex((scope) => scope.scopeId === pending.scopeId)
    if (scopeIndex >= 0 && frame.scopes[scopeIndex]!.cursor > 0) frame.scopes[scopeIndex]!.cursor -= 1
    frame.phase = 'running'
    draft.note('resolution payment did not settle; reopening the payment choice')
    return
  }
  frame.results = { ...frame.results, [pending.resultBinding]: true }
  if (pending.ifPaid.length > 0) {
    frame.scopes.push({
      path: `${pending.scopeId ?? ''}.payOptional`,
      scopeId: pending.scopeId,
      instructions: structuredClone(pending.ifPaid),
      cursor: 0,
    })
  }
  queuePaidReflexive(draft, {
    kind: 'canonicalResolutionPayment',
    stackId: frame.stackId,
    ...(pending.scopeId ? { scopeId: pending.scopeId } : {}),
    cost: pending.cost,
    source: pending.source,
    controller: pending.controller,
    bindResult: pending.resultBinding,
    ...(pending.whenPaidDecisions ? { whenPaidDecisions: pending.whenPaidDecisions } : {}),
    ifPaid: pending.ifPaid,
    ifDeclined: pending.ifDeclined,
    whenPaid: pending.whenPaid,
    paymentAmount: pending.amount,
    ...(pending.bindings ? { bindings: pending.bindings } : {}),
  }, pending.payer)
  frame.phase = 'running'
}

const resolutionPaymentPayable = (
  state: GameState,
  seat: PlayerId,
  action: Extract<PendingOptionSelection['action'], { kind: 'canonicalResolutionPayment' }>,
) => {
  switch (action.cost.kind) {
    case 'mana': return canPayResolutionMana(state, seat, action.cost, action.source, action.bindings)
    case 'life': return state.players[seat].life >= action.paymentAmount
    case 'discard':
    case 'sacrifice': return resolutionPaymentCandidates(state, seat, action.cost, action.source, action.bindings).length >= action.paymentAmount
  }
}

export const selectOptions: Plugin = {
  id: 'selectOptions',
  legal: ({ state, event }) => {
    const pending = pendingOptionSelection(state)
    if (event.type === 'passPriority' && pending) {
      return `${pending.seat} is choosing${pending.source ? ` for ${pending.source}` : ''}`
    }
    if (event.type !== 'selectOption') return
    const selection = pendingOptionSelection(state, event.seat)
    if (!selection) return `${event.seat} has no open option selection`
    if (event.selectionId !== selection.id) return 'option selection is no longer open'
    if (!selection.options.some((option) => option.id === event.optionId)) {
      if (selection.action.kind === 'putCanonicalTriggeredAbilityAllocation') {
        const amountMatch = new RegExp(`^allocation:${selection.action.allocationIndex}:(\\d+)$`).exec(event.optionId)
        const amount = amountMatch ? Number(amountMatch[1]) : Number.NaN
        const bound = selection.action.bounds[selection.action.specIndex]
        const remaining = selection.action.recipientCount - selection.action.allocationIndex - 1
        const chosen = selection.action.amounts.reduce((sum, value) => sum + value, 0)
        const max = bound.total - chosen - bound.minEach * remaining
        if (Number.isSafeInteger(amount) && amount >= bound.minEach && amount <= max
          && (selection.action.allocationIndex < selection.action.recipientCount - 1 || amount === max)) return
      }
      return 'option was not offered for this selection'
    }
    if (selection.action.kind === 'putCanonicalModeTriggeredAbility') {
      const modeIndex = Number(event.optionId.replace('mode:', ''))
      if (!Number.isInteger(modeIndex) || modeIndex < 0) return 'invalid mode choice'
      if (!selection.action.repeatable && selection.action.selectedModes.includes(modeIndex)) {
        return 'that mode cannot be selected again'
      }
    }
    if (selection.action.kind === 'canonical-copy-retarget' && event.optionId === 'keep') {
      const action = selection.action
      const frame = state.resolution?.kind === 'canonicalSpell' && state.resolution.stackId === action.stackId ? state.resolution : undefined
      const original = state.stack.find((item) => item.id === action.copyStackId)
      const source = original ? state.objects[original.objectId] : undefined
      const job = frame?.pendingCopyTargets?.[0]
      if (!frame || !original || !source || !job || action.slotIndex === undefined) return 'copy target choice is no longer valid'
      return validateCanonicalCopyTarget(state, original, source, action.slotIndex, original.targets[action.slotIndex]!, job.answers, action.controller)
        ?? undefined
    }
    if (selection.action.kind === 'canonical-copy-stack-target') {
      const action = selection.action
      const targetId = event.optionId.startsWith('stack:') ? event.optionId.slice('stack:'.length) : undefined
      const frame = state.resolution?.kind === 'canonicalSpell' && state.resolution.stackId === action.stackId
        ? state.resolution
        : undefined
      const original = state.stack.find((item) => item.id === action.copyStackId)
      const source = original ? state.objects[original.objectId] : undefined
      const job = frame?.pendingCopyTargets?.[0]
      if (!targetId || !frame || !original || !source || !job) return 'stack target choice is no longer valid'
      const error = validateCanonicalCopyTarget(
        state,
        original,
        source,
        action.slotIndex ?? 0,
        { kind: 'stackItem', stackId: targetId },
        job.answers,
        action.controller,
      )
      if (error) return error
    }
    if (selection.action.kind === 'canonicalResolutionPayment' && event.optionId === 'pay') {
      if (!resolutionPaymentPayable(state, event.seat, selection.action)) return `${event.seat} cannot pay this resolution cost`
    }
    if (selection.action.kind === 'canonicalResolutionPayment' && event.optionId.startsWith('activate:')) {
      const activation = selection.action.manaActivations?.find((candidate) =>
        candidate.kind === 'activateAbility'
        && `activate:${candidate.objectId}:${candidate.abilityId}` === event.optionId)
      if (!activation || activation.kind !== 'activateAbility' || !eligibleResolutionManaAbilities(state, event.seat).some((candidate) =>
        candidate.kind === 'activateAbility'
        && candidate.objectId === activation.objectId && candidate.abilityId === activation.abilityId)) {
        return 'mana activation choice is no longer available'
      }
    }
    if (selection.action.kind === 'canonicalResolutionPayment' && event.optionId.startsWith('tap:')) {
      const activation = selection.action.manaActivations?.find((candidate) =>
        candidate.kind === 'tapForMana'
        && `tap:${candidate.objectId}:${candidate.mana ?? ''}` === event.optionId)
      if (!activation || activation.kind !== 'tapForMana' || !eligibleResolutionManaAbilities(state, event.seat).some((candidate) =>
        candidate.kind === 'tapForMana'
        && candidate.objectId === activation.objectId && candidate.mana === activation.mana)) {
        return 'mana source choice is no longer available'
      }
    }
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'selectOption') return
    const selection = pendingOptionSelection(draft, event.seat)
    if (!selection || selection.id !== event.selectionId) return
    if (selection.action.kind === 'canonicalProliferateChoice') {
      if (event.optionId === 'done') {
        delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
        draft.priority = null
        return
      }
      const recipient = selection.action.recipients.find((entry) => entry.id === event.optionId)
      if (!recipient) return
      if (recipient.kind === 'object' && recipient.objectId) {
        const object = draft.object(recipient.objectId)
        if (object && object.zone === 'battlefield' && !object.phasedOut) {
          object.counters[recipient.counter] = (object.counters[recipient.counter] ?? 0) + 1
        }
      } else if (recipient.kind === 'player' && recipient.seat) {
        const player = draft.players[recipient.seat]
        if (recipient.counter === 'poison') player.poison += 1
        if (recipient.counter === 'energy') player.energy = (player.energy ?? 0) + 1
      }
      const remaining = selection.action.recipients.filter((entry) => entry.id !== event.optionId)
      draft.players[event.seat].data[PENDING_OPTION_SELECTION] = {
        ...selection,
        options: [{ id: 'done', label: 'Done' }, ...remaining.map((entry) => ({ id: entry.id, label: `${entry.kind === 'object' ? 'Permanent' : 'Player'}: ${entry.counter}` }))],
        action: { ...selection.action, recipients: remaining },
      }
      draft.priority = event.seat
      return
    }
    if (selection.action.kind === 'canonicalInstructionChoice') {
      const option = selection.action.options.find((entry) => entry.id === event.optionId)
      if (!option) return
      delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      if (draft.resolution?.kind === 'canonicalSpell' && draft.resolution.stackId === selection.action.stackId) {
        draft.resolution.scopes.push({
          path: `.choice.${event.optionId}`,
          scopeId: selection.action.scopeId,
          instructions: structuredClone(option.instructions),
          cursor: 0,
        })
      }
      draft.priority = null
      return
    }
    if (selection.action.kind === 'putCanonicalTriggeredAbilityAllocation') {
      const allocation = selection.action
      const amountMatch = new RegExp(`^allocation:${allocation.allocationIndex}:(\\d+)$`).exec(event.optionId)
      const amount = amountMatch ? Number(amountMatch[1]) : Number.NaN
      if (!Number.isSafeInteger(amount) || amount < 0) return
      const nextAmounts = [...allocation.amounts, amount]
      const nextIndex = allocation.allocationIndex + 1
      const currentAllocations = allocation.allocations.map((entry, index) => index === allocation.specIndex
        ? { ...entry, amounts: nextAmounts }
        : entry)
      if (nextIndex < allocation.recipientCount) {
        const bound = allocation.bounds[allocation.specIndex]
        const chosenTotal = nextAmounts.reduce((sum, value) => sum + value, 0)
        const options = allocationOptions(nextIndex, allocation.recipientCount, bound, chosenTotal)
        draft.players[event.seat].data[PENDING_OPTION_SELECTION] = {
          ...selection,
          id: draft.allocId('option'),
          options,
          action: { ...allocation, allocations: currentAllocations, allocationIndex: nextIndex, amounts: nextAmounts },
        }
        draft.priority = null
        return
      }
      if (allocation.specIndex + 1 < allocation.specs.length) {
        let nextSpecIndex = allocation.specIndex + 1
        let nextAllocations = currentAllocations
        while (nextSpecIndex < allocation.specs.length) {
          const nextBound = allocation.bounds[nextSpecIndex]
          const nextRecipientCount = allocation.recipientCounts[nextSpecIndex]
          if (nextRecipientCount !== 0 || nextBound.total !== 0) break
          nextAllocations = nextAllocations.map((entry, index) => index === nextSpecIndex
            ? { ...entry, amounts: [] }
            : entry)
          nextSpecIndex += 1
        }
        if (nextSpecIndex >= allocation.specs.length) {
          finishCanonicalAllocation(draft, event.seat, allocation.announcement, allocation.bounds, nextAllocations)
          return
        }
        const bound = allocation.bounds[nextSpecIndex]
        const nextRecipientCount = allocation.recipientCounts[nextSpecIndex]
        const options = allocationOptions(0, nextRecipientCount, bound)
        draft.players[event.seat].data[PENDING_OPTION_SELECTION] = {
          ...selection,
          id: draft.allocId('option'),
          options,
          action: { ...allocation, allocations: nextAllocations, specIndex: nextSpecIndex, recipientCount: nextRecipientCount, allocationIndex: 0, amounts: [] },
        }
        draft.priority = null
        return
      }
      finishCanonicalAllocation(draft, event.seat, selection.action.announcement, selection.action.bounds, currentAllocations)
      return
    }
    if (selection.action.kind === 'canonical-copy-retarget') {
      const action = selection.action
      const frame = draft.resolution?.kind === 'canonicalSpell' && draft.resolution.stackId === selection.action.stackId
        ? draft.resolution
        : undefined
      const original = draft.stack.find((item) => item.id === action.copyStackId)
      if (!frame || !original) return
      if (event.optionId === 'keep') {
        const job = frame.pendingCopyTargets?.[0]
        if (job && selection.action.slotIndex !== undefined) {
          const source = draft.object(original.objectId)
          if (!source || validateCanonicalCopyTarget(draft, original, source, selection.action.slotIndex, original.targets[selection.action.slotIndex]!, job.answers, action.controller)) return
          delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
          advanceCopySlot(draft, frame)
          return
        }
        delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
        return
      }
      const source = draft.object(original.objectId)
      const snapshot = original.execution?.definitionSnapshot
      const abilityIndex = original.execution?.abilityIndex
      const definition = snapshot ? loadDefinitionSnapshot(snapshot).definition : undefined
      const inferredAbilityIndex = abilityIndex ?? definition?.abilities.findIndex((entry) => entry.kind === 'spell')
      const ability = definition && inferredAbilityIndex !== undefined && inferredAbilityIndex >= 0
        ? definition.abilities[inferredAbilityIndex]
        : undefined
      if (!source || !ability || !('decisions' in ability)) return
      const slotIndex = selection.action.slotIndex ?? 0
      const slotTarget = original.targets[slotIndex]
      let seenSlots = 0
      const targetBinding = original.execution?.targetBindings?.find((binding) => {
        if (seenSlots + binding.recipients.length <= slotIndex) {
          seenSlots += binding.recipients.length
          return false
        }
        return true
      })
      const clauseIndex = targetBinding?.clauseIndex ?? slotIndex
      const modeClauses = targetBinding?.modeIndex !== undefined && 'modes' in ability
        ? ability.modes?.[targetBinding.modeIndex]?.decisions.targets
        : undefined
      const scoped = canonicalTargetCandidates(
        draft,
        source,
        ability,
        selection.action.controller,
        original.execution?.occurrence,
        modeClauses,
        original.x,
      )
      const job = frame.pendingCopyTargets?.[0]
      const priorAnswers = job?.answers ?? []
      const copyController = selection.action.controller
      const legalReplacement = (candidate: TargetRef) => {
        return !validateCanonicalCopyTarget(draft, original, source, slotIndex, candidate, priorAnswers, copyController)
      }
      const candidates = (scoped[clauseIndex] ?? [])
        .filter(legalReplacement)
        .filter((candidate): candidate is Extract<typeof candidate, { kind: 'object' }> => candidate.kind === 'object')
      const scopedCandidates = (scoped[clauseIndex] ?? []).filter(legalReplacement)
      const count = slotTarget?.kind === 'object' ? 1 : 0
      if (slotTarget?.kind === 'stackItem') {
        if (!scopedCandidates.some((candidate) => candidate.kind === 'stackItem')) return
        delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
        openOptionSelection(draft, {
          seat: selection.action.controller,
          sourceId: frame.source.ref.objectId,
          source: frame.source.snapshot.name,
          prompt: 'Choose a new stack target for the copied spell.',
          options: scopedCandidates.filter((candidate): candidate is Extract<typeof candidate, { kind: 'stackItem' }> => candidate.kind === 'stackItem')
            .map((candidate) => draft.stack.find((item) => item.id === candidate.stackId))
            .filter((item): item is NonNullable<typeof item> => Boolean(item))
            .map((item) => ({ id: `stack:${item.id}`, label: item.name })),
          action: { kind: 'canonical-copy-stack-target', stackId: frame.stackId, copyStackId: original.id, controller: action.controller, slotIndex },
        })
        return
      }
      if (slotTarget?.kind === 'player') {
        if (!scopedCandidates.some((candidate) => candidate.kind === 'player')) return
        openPlayerSelection(draft, {
          seat: action.controller,
          sourceId: frame.source.ref.objectId,
          source: frame.source.snapshot.name,
          prompt: 'Choose a new player target for the copied spell.',
          min: 1,
          max: 1,
          candidates: scopedCandidates
            .filter((candidate): candidate is Extract<typeof candidate, { kind: 'player' }> => candidate.kind === 'player')
            .map((candidate) => candidate.player),
          action: { kind: 'canonicalCopyTargets', stackId: frame.stackId, copyStackId: original.id, controller: action.controller, slotIndex },
        })
        delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
        return
      }
      if (candidates.length === 0) return
      openCardSelection(draft, {
        seat: action.controller,
        kind: 'choose', count, min: count,
        candidates: [...new Set(candidates.map((candidate) => candidate.objectId))],
        targetIdentities: Object.fromEntries(candidates.map((candidate) => [candidate.objectId, objectIdentity(draft.object(candidate.objectId)!)])),
        sourceId: frame.source.ref.objectId, source: frame.source.snapshot.name,
        prompt: 'Choose new targets for the copied spell.', destinations: ['target'],
        canonicalChoice: { stackId: frame.stackId, binding: `__copySpellTargets_${original.id}`, action: 'copySpellTargets', copySpellStackId: original.id, copyController: action.controller, copySlotIndex: slotIndex },
      })
      delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      return
    }
    if (selection.action.kind === 'canonical-copy-stack-target') {
      const action = selection.action
      const frame = draft.resolution?.kind === 'canonicalSpell' && draft.resolution.stackId === action.stackId
        ? draft.resolution
        : undefined
      const original = draft.stack.find((item) => item.id === action.copyStackId)
      const targetId = event.optionId.startsWith('stack:') ? event.optionId.slice('stack:'.length) : undefined
      if (targetId && frame?.pendingCopyTargets?.length) {
        const job = frame.pendingCopyTargets[0]
        const source = original ? draft.object(original.objectId) : undefined
        const slotIndex = action.slotIndex ?? 0
        if (!original || !source || validateCanonicalCopyTarget(draft, original, source, slotIndex, { kind: 'stackItem', stackId: targetId }, job.answers, action.controller)) return
        delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
        advanceCopySlot(draft, frame, { kind: 'stackItem', stackId: targetId })
        return
      }
      if (original && targetId) {
        const targets = copyTargetsWithReplacement(original, action.slotIndex ?? 0, { kind: 'stackItem', stackId: targetId })
        if (draft.resolution?.kind === 'canonicalSpell' && draft.resolution.stackId === action.stackId) {
          draft.resolution.afterChoiceEvents = [{ type: 'copySpell', stackId: original.id, controller: action.controller, targets, retarget: true, sourceId: draft.resolution.source.ref.objectId }]
        }
      }
      delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      return
    }
    if (selection.action.kind === 'canonicalResolutionPayment') {
      if (event.optionId.startsWith('activate:')) {
        const activation = selection.action.manaActivations?.find((candidate) =>
          candidate.kind === 'activateAbility'
          && `activate:${candidate.objectId}:${candidate.abilityId}` === event.optionId)
        const frame = draft.resolution?.kind === 'canonicalSpell' && draft.resolution.stackId === selection.action.stackId
          ? draft.resolution
          : undefined
        if (!activation || activation.kind !== 'activateAbility' || !frame) return
        const scope = frame.scopes.at(-1)
        if (scope && scope.scopeId === selection.action.scopeId && scope.cursor > 0) scope.cursor -= 1
        delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
        frame.pendingEvents = []
        frame.phase = 'committing'
        draft.enqueue({
          type: 'activateAbility',
          seat: event.seat,
          objectId: activation.objectId,
          abilityId: activation.abilityId,
          manaAbility: true,
        })
        return
      }
      if (event.optionId.startsWith('tap:')) {
        const activation = selection.action.manaActivations?.find((candidate) =>
          candidate.kind === 'tapForMana'
          && `tap:${candidate.objectId}:${candidate.mana ?? ''}` === event.optionId)
        const frame = draft.resolution?.kind === 'canonicalSpell' && draft.resolution.stackId === selection.action.stackId
          ? draft.resolution
          : undefined
        if (!activation || activation.kind !== 'tapForMana' || !frame) return
        const scope = frame.scopes.at(-1)
        if (scope && scope.scopeId === selection.action.scopeId && scope.cursor > 0) scope.cursor -= 1
        delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
        frame.pendingEvents = []
        frame.phase = 'committing'
        draft.enqueue({
          type: 'tapForMana',
          seat: event.seat,
          objectId: activation.objectId,
          ...(activation.mana ? { mana: activation.mana } : {}),
        })
        return
      }
      if (event.optionId !== 'pay' && event.optionId !== 'decline') return
      const cost = selection.action.cost
      const paid = event.optionId === 'pay' && resolutionPaymentPayable(draft, event.seat, selection.action)
      if (event.optionId === 'pay' && !paid) return
      delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      if (draft.resolution?.kind === 'canonicalSpell' && draft.resolution.stackId === selection.action.stackId) {
        const frame = draft.resolution
        const branch = paid ? selection.action.ifPaid : selection.action.ifDeclined
        if (!paid) {
          frame.results = { ...frame.results, [selection.action.bindResult]: false }
          if (branch.length > 0) frame.scopes.push({ path: `${selection.action.scopeId ?? ''}.payOptional`, scopeId: selection.action.scopeId, instructions: structuredClone(branch), cursor: 0 })
          frame.phase = 'running'
          return
        }
        switch (cost.kind) {
          case 'mana': {
            const nextMana = payResolutionMana(draft, event.seat, cost, selection.action.source, selection.action.bindings)
            if (!nextMana) return
            draft.players[event.seat].mana = nextMana.pool
            draft.players[event.seat].restrictedMana = nextMana.restrictedMana
            break
          }
          case 'life': {
            const paymentEvent: GameEvent = {
              type: 'payLife',
              seat: event.seat,
              amount: selection.action.paymentAmount,
              source: selection.action.source.ref.objectId,
            }
            frame.pendingResolutionPayment = {
              scopeId: selection.action.scopeId,
              payer: event.seat,
              amount: selection.action.paymentAmount,
              cost,
              resultBinding: selection.action.bindResult,
              source: structuredClone(selection.action.source),
              controller: selection.action.controller,
              ifPaid: structuredClone(selection.action.ifPaid),
              ifDeclined: structuredClone(selection.action.ifDeclined),
              whenPaid: structuredClone(selection.action.whenPaid),
              paymentEvents: [paymentEvent],
              ...(selection.action.whenPaidDecisions ? { whenPaidDecisions: structuredClone(selection.action.whenPaidDecisions) } : {}),
              ...(selection.action.bindings ? { bindings: structuredClone(selection.action.bindings) } : {}),
            }
            draft.enqueue(paymentEvent)
            frame.phase = 'committing'
            return
          }
          case 'discard':
          case 'sacrifice': {
          frame.pendingResolutionPayment = {
            scopeId: selection.action.scopeId,
            payer: event.seat,
            amount: selection.action.paymentAmount,
            cost,
            resultBinding: selection.action.bindResult,
            source: structuredClone(selection.action.source),
            controller: selection.action.controller,
            ifPaid: structuredClone(selection.action.ifPaid),
            ifDeclined: structuredClone(selection.action.ifDeclined),
            whenPaid: structuredClone(selection.action.whenPaid),
            ...(selection.action.whenPaidDecisions ? { whenPaidDecisions: structuredClone(selection.action.whenPaidDecisions) } : {}),
            ...(selection.action.bindings ? { bindings: structuredClone(selection.action.bindings) } : {}),
          }
          const candidates = resolutionPaymentCandidates(draft, event.seat, cost, selection.action.source, selection.action.bindings)
          openCardSelection(draft, {
            seat: event.seat,
            kind: cost.kind,
            count: selection.action.paymentAmount,
            min: selection.action.paymentAmount,
            candidates: candidates.map((object) => object.id),
            targetIdentities: Object.fromEntries(candidates.map((object) => [object.id, objectIdentity(object)])),
            sourceId: selection.action.source.ref.objectId,
            source: selection.action.source.snapshot.name,
            prompt: `Choose cards to ${cost.kind} as the optional cost.`,
            destinations: ['target'],
            canonicalChoice: {
              stackId: selection.action.stackId,
              scopeId: selection.action.scopeId,
              binding: selection.action.bindResult,
              action: 'resolutionPayment',
              payment: {
                cost,
                amount: selection.action.paymentAmount,
                payer: event.seat,
                bindResult: selection.action.bindResult,
                scopeId: selection.action.scopeId,
                source: structuredClone(selection.action.source),
                controller: selection.action.controller,
                ...(selection.action.whenPaidDecisions ? { whenPaidDecisions: structuredClone(selection.action.whenPaidDecisions) } : {}),
                ...(selection.action.bindings ? { bindings: structuredClone(selection.action.bindings) } : {}),
                ifPaid: structuredClone(selection.action.ifPaid),
                ifDeclined: structuredClone(selection.action.ifDeclined),
                whenPaid: structuredClone(selection.action.whenPaid),
              },
            },
          })
          frame.phase = 'committing'
          frame.pendingEvents = []
          return
          }
        }
        frame.results = { ...frame.results, [selection.action.bindResult]: paid }
        if (branch.length > 0) frame.scopes.push({ path: `${selection.action.scopeId ?? ''}.payOptional`, scopeId: selection.action.scopeId, instructions: structuredClone(branch), cursor: 0 })
        if (paid) queuePaidReflexive(draft, selection.action, event.seat)
        frame.phase = 'running'
      }
      return
    }
    if (selection.action.kind === 'putCanonicalModeTriggeredAbility') {
      const modeIndex = Number(event.optionId.replace('mode:', ''))
      const selectedModes = [...selection.action.selectedModes, modeIndex]
      if (selectedModes.length < selection.action.modeCount) {
        draft.players[event.seat].data[PENDING_OPTION_SELECTION] = {
          ...selection,
          options: selection.action.repeatable
            ? selection.options
            : selection.options.filter((option) => option.id !== event.optionId),
          action: { ...selection.action, selectedModes },
        }
        draft.priority = event.seat
        return
      }
      delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      validateModeSelection(
        { count: { kind: 'constant', value: selection.action.modeCount }, repeatable: selection.action.repeatable },
        selection.action.modeClausesByMode?.length ?? selection.options.length,
        selection.action.modeCount,
        selectedModes,
      )
      const modeClausesByMode = selection.action.modeClausesByMode
      const modeClauses = modeClausesByMode
        ? selectedModes.flatMap((index) => modeClausesByMode[index] ?? [])
        : selection.action.modeClauses
      if (modeClauses && modeClauses.length > 0) {
        const abilityIndex = selection.action.abilityIndex
        continueCanonicalModeTargets(draft, {
          definitionSnapshot: selection.action.definitionSnapshot,
          abilityIndex: selection.action.abilityIndex,
          execution: selection.action.execution,
          source: selection.action.execution.source.snapshot,
          sourceId: selection.action.sourceId,
          targets: selection.action.targets,
          selectedModes,
          clauses: [ ...(selection.action.baseTargetClauses ?? []), ...modeClauses ],
          targetScopeIds: [
            ...(selection.action.baseTargetScopeIds ?? []),
            ...selectedModes.flatMap((selectedModeIndex, occurrence) =>
              (modeClausesByMode?.[selectedModeIndex] ?? []).map(() =>
                canonicalModeScopeId(abilityIndex, selectedModeIndex, occurrence))),
          ],
          targetModeIndices: [
            ...(selection.action.baseTargetModeIndices ?? []),
            ...selectedModes.flatMap((selectedModeIndex) => (modeClausesByMode?.[selectedModeIndex] ?? []).map(() => selectedModeIndex)),
          ],
          initialClauseIndex: selection.action.baseTargetClauses?.length ?? 0,
        })
        return
      }
      const source = draft.object(selection.action.sourceId) ?? selection.action.execution.source.snapshot
      const definition = loadDefinitionSnapshot(selection.action.definitionSnapshot).definition
      const ability = definition.abilities[selection.action.abilityIndex]
      if (!source || !ability || ability.kind !== 'triggered' || !('modes' in ability)
        || selectedModes.some((index) => !ability.modes?.[index])) return
      if ((ability.modes?.some((mode) => mode.decisions.distributions?.length) ?? false)
        || ability.decisions.distributions?.length) {
        stackCanonical(draft, {
          definitionSnapshot: selection.action.definitionSnapshot,
          abilityIndex: selection.action.abilityIndex,
          execution: selection.action.execution,
          source,
          sourceId: source.id,
          targets: selection.action.targets,
          targetBindings: selection.action.targetBindings,
          targetClauses: selection.action.baseTargetClauses ?? [],
          clauseBounds: (selection.action.baseTargetClauses ?? []).map(() => ({ min: 0, max: 0 })),
          clauseIndex: 0,
          selectedModes,
          targetScopeIds: selection.action.baseTargetScopeIds,
          targetModeIndices: selection.action.baseTargetModeIndices,
          modeScopeIds: selection.action.modeScopeIds,
          distributionBounds: selection.action.distributionBounds,
        })
        draft.priority = null
        return
      }
      draft.addToStack({
        kind: 'ability',
        objectId: source.id,
        controller: selection.action.execution.controller,
        name: source.name,
        targets: selection.action.targets,
        execution: {
          ...selection.action.execution,
          definitionSnapshot: selection.action.definitionSnapshot,
          abilityIndex: selection.action.abilityIndex,
          modeIndices: selectedModes,
          ...(selection.action.modeScopeIds ? { modeScopeIds: [...selection.action.modeScopeIds] } : {}),
          targetBindings: selection.action.targetBindings,
        },
      })
      draft.passedInRow = []
      draft.priority = null
      return
    }
    if (selection.action.kind === 'putCanonicalStackTarget') {
      const selectedStackTargets = [...selection.action.selectedStackTargets]
      if (event.optionId === 'done') {
        delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      } else {
        const stackId = event.optionId.replace('stack:', '')
        selectedStackTargets.push(stackId)
        if (selectedStackTargets.length < selection.action.targetClauses[selection.action.targetIndex].max) {
          const options = selection.options
            .filter((option) => option.id !== event.optionId && option.id !== 'done')
          if (selectedStackTargets.length >= selection.action.targetClauses[selection.action.targetIndex].min) {
            options.push({ id: 'done', label: 'Done' })
          }
          draft.players[event.seat].data[PENDING_OPTION_SELECTION] = {
            ...selection,
            options,
            action: { ...selection.action, selectedStackTargets },
          }
          draft.priority = event.seat
          return
        }
        delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      }
      const targets = [
        ...selection.action.selectedTargets,
        ...selectedStackTargets.map((stackId) => ({ kind: 'stackItem' as const, stackId })),
      ]
      const bounds = selection.action.targetClauses
      continueCanonicalTargetSelection(draft, canonicalChoiceAnnouncement(selection.action, {
        source: selection.action.execution.source.snapshot,
        sourceId: selection.action.sourceId,
        targetClauses: selection.action.targetClauseDefinitions ?? [],
        targets,
        clauseBounds: bounds,
        clauseIndex: selection.action.targetIndex + 1,
      }))
      return
    }
    if (
      selection.action.kind === 'replacementModifier'
      || selection.action.kind === 'replacementProgramChoice'
      || selection.action.kind === 'replacementInstructionChoice'
    ) {
      return
    }
    delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
  },
}
