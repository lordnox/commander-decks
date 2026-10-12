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
import type { CanonicalResolutionFrame, CanonicalTargetBinding, GameState, ManaPool, PlayerId, Plugin, StackExecutionContext, TargetRef } from '../types'
import type { CardRuleDefinitionSnapshotV1, DistributionSpec, Instruction, TargetClause } from '../cardPlugins/dsl/schema/v1'
import { allocationOptions } from './canonicalAllocation'

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
    kind: 'abundance'
    replacedBy: string[]
    remainingAfter?: number
  } | {
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
  if (selection.action.kind === 'putCanonicalTriggeredAbilityAllocation') draft.priority = null
  else if (!draft.resolution) draft.priority = selection.seat
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
          const announcement = {
            ...allocation.announcement,
            distributionBounds: allocation.bounds,
            execution: {
              ...allocation.announcement.execution,
              distributionBindings: nextAllocations,
              distributionBounds: allocation.bounds,
            },
          }
          delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
          stackCanonical(draft, announcement)
          draft.priority = null
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
      delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      const completedAllocations = currentAllocations
      const announcement = {
        ...selection.action.announcement,
        distributionBounds: selection.action.bounds,
        execution: { ...selection.action.announcement.execution, distributionBindings: completedAllocations, distributionBounds: selection.action.bounds },
      }
      stackCanonical(draft, announcement)
      draft.priority = null
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
    delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
  },
}
