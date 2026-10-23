import { effectiveActivatedDefinition } from './cardPlugins/dsl/activatedGrants'
import { setStats } from './cardPlugins/continuousEffects'
import { CREATURE_TYPES } from './creatureTypes'
import { MANA_ABILITY_RESOLVED } from './cardPlugins/dsl/manaConstants'
import { CONTROL_EVENT } from './cardPlugins/dsl/controlConstants'
import { commitExileLink, opponentBecameMonarchSince, releaseCanonicalLinkedExile } from './rules/canonicalLinkedExile'
import { linkExileSelected, releaseLinkedExile } from './rules/linkExile'
import { changeControllerPermanent } from './cardPlugins/continuousEffects'
import { counterPtBonus } from './definitions'
import type { PluginCatalog } from './catalog'
import { KEYWORDS } from './cardPlugins/dsl/schema/v1'
import type { Draft } from './draft'
import { freezeDraft, makeDraft, nextPlayer } from './draft'
import type {
  GameEvent,
  GameState,
  HookCtx,
  EventTrace,
  ManaId,
  PlayerId,
  ReduceResult,
  RuleInstance,
  StepId,
  ZoneId,
} from './types'
import { markPutIntoGraveyardFromBattlefieldThisTurn } from './plugins/fromBattlefieldThisTurn'
import { untapPermanent } from './rules/untap'
import { ZONE_IDS } from './types'
import { ceaseToExist, enterResolvingCopyAsToken } from './rules/spellCopies'
import {
  canonicalResolutionCandidate,
  finishResolution,
  prepareResolutionStep,
  startCanonicalResolution,
} from './driver'
import { captureEventTriggers, placePendingManaTriggers, placePendingTriggers } from './rules/triggers'
import {
  INSTRUCTIONS_RESUME,
  PENDING_SELECTION,
  PENDING_STEAL_CAST,
  pendingSelection,
  pendingSelectionsFor,
  finishCanonicalTopDeckChoices,
} from './rules/selectCards'
import { PENDING_PLAYER_SELECTION, pendingPlayerSelection } from './rules/selectPlayers'
import { PENDING_OPTION_SELECTION, pendingOptionSelection, settleResolutionPayment } from './rules/selectOptions'
import { PENDING_DIALOG, dialogCandidates, pendingDialog } from './pendingDialog'
import { finishedSpellZone } from './cardPlugins/alternateCosts'
import { canonicalCyclingEvent } from './cardPlugins/cycling'
import {
  SEARCH_CHOSEN,
  SEARCH_PENDING,
  pendingSearch,
  searchCandidates,
  searchSpecForPending,
  searchingSeat,
} from './cardPlugins/librarySearch'
import { pendingFreeCastFor, reboundsOnResolution } from './plugins/rebound'
import { isSameObject, refreshExecutionReferences } from './objectIdentity'
import { pendingOptionalManaPay } from './cardPlugins/optionalManaPay'
import { hasKeyword } from './keywords'
import { copyCharacteristics, createToken } from './cardPlugins/effectRuntime'
import { recordInstructionAmount } from './cardPlugins/dsl/instructionResults'
import { pendingExtort } from './cardPlugins/extort'
import { stackCopyPending } from './cardPlugins/stackCopy'
import { preparePlannedSpellAnnouncement } from './plugins/spells'
import { evaluateAnnouncementCostAmount } from './cardPlugins/dsl/compiler'
import type { AnnouncementTransaction } from './cardPlugins/dsl/compiler/announcement'
import { putCanonicalSpellCopyOnStack, resolveCanonicalCopyTargets } from './cardPlugins/dsl/copies'
import { applyRegisterPrevention } from './replacement/prevention'
import { replaceEvent as settleReplaceableEvent, startPreventionAdditionalPrograms, registerNestedApply } from './replacement'

const CHECKPOINT_CAP = 32

const announcementCostEvents = (payer: PlayerId, transaction: AnnouncementTransaction, state: GameState) => {
  const paymentEvents: GameEvent[] = []
  let costIndex = 0
  let millIndex = 0
  for (const cost of transaction.lockedCost.nonMana) {
    switch (cost.kind) {
      case 'tapSource':
        paymentEvents.push({ type: 'tap', objectId: transaction.proposal.sourceId })
        break
      case 'life':
        paymentEvents.push({
          type: 'payLife',
          seat: payer,
          amount: evaluateAnnouncementCostAmount(cost.amount, transaction.lockedCost.x),
          source: transaction.proposal.sourceId,
        })
        break
      case 'discard':
      case 'sacrifice': {
        const amount = evaluateAnnouncementCostAmount(cost.count, transaction.lockedCost.x)
        paymentEvents.push(...(transaction.proposal.nonManaChoices ?? []).slice(costIndex, costIndex + amount).map((objectId) =>
          cost.kind === 'discard' ? { type: 'discard' as const, seat: payer, objectId } : { type: 'sacrifice' as const, objectId }))
        costIndex += amount
        break
      }
      case 'mill': {
        const amount = evaluateAnnouncementCostAmount(cost.count, transaction.lockedCost.x)
        for (const objectId of state.zoneOrder[payer]!.library.slice(millIndex, millIndex + amount)) paymentEvents.push({ type: 'mill', seat: payer, objectId })
        millIndex += amount
        break
      }
      case 'draw': {
        const amount = evaluateAnnouncementCostAmount(cost.count, transaction.lockedCost.x)
        paymentEvents.push(...Array.from({ length: amount }, () => ({ type: 'draw' as const, seat: payer, count: 1 })))
        break
      }
      case 'mana':
      case 'delve':
        break
    }
  }
  return paymentEvents
}

const applyCostSequence = (
  state: GameState,
  catalog: PluginCatalog,
  events: GameEvent[],
  startCursor: number,
  writeCursor: (draft: Draft, cursor: number) => void,
  baseline: GameState,
) => {
  let current = state
  const entries: EventTrace[] = []
  let cursor = startCursor
  while (cursor < events.length) {
    const draft = makeDraft(current)
    writeCursor(draft, cursor + 1)
    current = freezeDraft(draft)
    const paid = applyEventTree(current, events[cursor]!, catalog)
    entries.push(...nested(paid.trace, 1))
    if (!paid.ok) return { ok: false as const, error: paid.error, state: baseline, trace: entries }
    current = paid.state
    cursor += 1
    if (current.resolution) {
      const driven = driveResolution(current, catalog)
      entries.push(...nested(driven.trace, 1))
      if (!driven.ok) return { ok: false as const, error: driven.error, state: baseline, trace: entries }
      current = driven.state
      if (current.resolution) return { ok: true as const, state: current, trace: entries }
    }
    if (hasOpenChoice(current) || current.eventProcessing) {
      return { ok: true as const, state: current, trace: entries }
    }
  }
  return { ok: true as const, state: current, trace: entries }
}

const continueNestedManaPayment = (state: GameState, catalog: PluginCatalog, baseline: GameState) => {
  const nested = state.provisionalAnnouncement?.nestedManaPayment
  const payer = state.provisionalAnnouncement?.payer
  if (!nested || !payer) return { ok: true as const, state, trace: [] }
  const paid = applyCostSequence(
    state,
    catalog,
    announcementCostEvents(payer, nested.transaction, state),
    nested.plannedPaymentCursor,
    (draft, cursor) => {
      if (draft.provisionalAnnouncement?.nestedManaPayment) {
        draft.provisionalAnnouncement.nestedManaPayment.plannedPaymentCursor = cursor
      }
    },
    baseline,
  )
  if (!paid.ok) return paid
  if (hasOpenChoice(paid.state) || paid.state.eventProcessing || paid.state.resolution) {
    return paid
  }
  const remaining = paid.state.provisionalAnnouncement?.nestedManaPayment
  if (!remaining) return paid
  const completed = makeDraft(paid.state)
  if (completed.priority === null) completed.priority = payer
  startCanonicalResolution(completed, {
    id: completed.allocId('inline'),
    ...remaining.pendingActivation,
  }, { inline: true })
  if (completed.resolution?.kind === 'canonicalSpell') {
    completed.resolution.phase = 'running'
    delete completed.resolution.pendingEvents
  }
  completed.priority = null
  if (completed.provisionalAnnouncement) delete completed.provisionalAnnouncement.nestedManaPayment
  const resolved = freezeDraft(completed)
  const nestedTrace = [...paid.trace]
  if (!resolved.resolution) return { ok: true as const, state: resolved, trace: nestedTrace }
  const driven = driveResolution(resolved, catalog)
  if (!driven.ok) return { ok: false as const, error: driven.error, state: driven.state, trace: [...nestedTrace, ...driven.trace] }
  return { ok: true as const, state: driven.state, trace: [...nestedTrace, ...driven.trace] }
}

const continuePlannedAnnouncement = (state: GameState, catalog: PluginCatalog): ReduceResult => {
  const frame = state.provisionalAnnouncement
  if (!frame) return { ok: true, state, trace: [] }
  let current = state
  const entries: EventTrace[] = []
  const nestedStart = continueNestedManaPayment(current, catalog, frame.baseline)
  entries.push(...nestedStart.trace)
  if (!nestedStart.ok) return { ...nestedStart, state: frame.baseline, trace: entries }
  current = nestedStart.state
  if (current.resolution) {
    const driven = driveResolution(current, catalog)
    entries.push(...nested(driven.trace, 1))
    if (!driven.ok) return { ...driven, state: frame.baseline, trace: entries }
    current = driven.state
    if (current.resolution) return { ok: true, state: current, trace: entries }
  }
  if (hasOpenChoice(current) || current.eventProcessing) {
    return { ok: true, state: current, trace: entries }
  }
  const planned = current.provisionalAnnouncement?.plannedManaActivations ?? frame.plannedManaActivations ?? []
  let cursor = current.provisionalAnnouncement?.plannedManaCursor ?? frame.plannedManaCursor ?? 0
  while (cursor < planned.length) {
    const draft = makeDraft(current)
    if (draft.provisionalAnnouncement) draft.provisionalAnnouncement.plannedManaCursor = cursor + 1
    current = freezeDraft(draft)
    const next = applyEventTree(current, planned[cursor]!, catalog)
    entries.push(...nested(next.trace, 1))
    if (!next.ok) return { ...next, state: frame.baseline, trace: entries }
    current = next.state
    cursor += 1
    const nestedPaid = continueNestedManaPayment(current, catalog, frame.baseline)
    entries.push(...nestedPaid.trace)
    if (!nestedPaid.ok) return { ...nestedPaid, state: frame.baseline, trace: entries }
    current = nestedPaid.state
    if (current.resolution) {
      const driven = driveResolution(current, catalog)
      entries.push(...nested(driven.trace, 1))
      if (!driven.ok) return { ...driven, state: frame.baseline, trace: entries }
      current = driven.state
      if (current.resolution) return { ok: true, state: current, trace: entries }
    }
    if (hasOpenChoice(current) || current.eventProcessing) {
      return { ok: true, state: current, trace: entries }
    }
  }
  const parent = current.provisionalAnnouncement ?? frame
  if (parent.source && parent.definitionSnapshot) {
    const liveSource = current.objects[parent.source.ref.objectId]
    if (!liveSource || !isSameObject(liveSource, parent.source.ref)
      || JSON.stringify(effectiveActivatedDefinition(liveSource).definition) !== JSON.stringify(parent.definitionSnapshot.definition)) {
      const error = 'planned announcement source or definition changed before payment completed'
      return { ok: false, error, state: frame.baseline, trace: entries }
    }
  }
  const paid = applyCostSequence(
    current,
    catalog,
    announcementCostEvents(parent.payer, parent.transaction, current),
    parent.plannedPaymentCursor ?? 0,
    (draft, nextCursor) => {
      if (draft.provisionalAnnouncement) draft.provisionalAnnouncement.plannedPaymentCursor = nextCursor
    },
    frame.baseline,
  )
  entries.push(...paid.trace)
  if (!paid.ok) return { ...paid, state: frame.baseline, trace: entries }
  current = paid.state
  if (hasOpenChoice(current) || current.eventProcessing || current.resolution) {
    return { ok: true, state: current, trace: entries }
  }
  if (frame.pendingActivation) {
    const completed = makeDraft(current)
    if (frame.inlineManaAbility) {
      completed.priority = frame.baseline.priority
      startCanonicalResolution(completed, {
        id: completed.allocId('inline'),
        ...frame.pendingActivation,
      }, { inline: true })
      if (completed.resolution?.kind === 'canonicalSpell') {
        completed.resolution.phase = 'running'
        delete completed.resolution.pendingEvents
      }
      completed.priority = null
    } else {
      completed.addToStack(frame.pendingActivation)
      completed.passedInRow = []
      completed.priority = frame.payer
      completed.note(`${frame.payer} activates ${frame.pendingActivation.name}`)
    }
    delete completed.provisionalAnnouncement
    const cycle = canonicalCyclingEvent(frame.pendingActivation)
    if (cycle) {
      const cycled = applyEventTree(freezeDraft(completed), cycle, catalog)
      entries.push(...nested(cycled.trace, 1))
      return { ...cycled, trace: entries }
    }
    return { ok: true, state: freezeDraft(completed), trace: entries }
  }
  if (!frame.continuation) {
    const completed = makeDraft(current)
    delete completed.provisionalAnnouncement
    return { ok: true, state: freezeDraft(completed), trace: entries }
  }
  const beforeCast = current
  const cast = applyEventTree(current, {
    ...frame.continuation,
    canonicalTransaction: { ...frame.transaction, status: 'committed' as const },
  }, catalog)
  entries.push(...nested(cast.trace, 1))
  if (!cast.ok) return { ...cast, state: frame.baseline, trace: entries }
  const completed = makeDraft(cast.state)
  const stacked = completed.stack.find((item) => item.objectId === frame.continuation?.objectId)
  const announcement = stacked?.execution?.announcement
  if (announcement) announcement.payment = actualManaPayment(beforeCast, cast.state, frame.payer)
  delete completed.provisionalAnnouncement
  return { ok: true, state: freezeDraft(completed), trace: entries }
}

const actualManaPayment = (before: GameState, after: GameState, payer: PlayerId) => {
  const spent: Array<{ sourceId: string; mana: ManaId; amount: number; restricted?: boolean }> = []
  for (const mana of ['C', 'W', 'U', 'B', 'R', 'G'] as const) {
    const amount = Math.max(0, before.players[payer].mana[mana] - after.players[payer].mana[mana])
    if (amount > 0) spent.push({ sourceId: `${payer}.pool.${mana}`, mana, amount })
  }
  const beforeRestricted = before.players[payer].restrictedMana ?? []
  const afterRestricted = after.players[payer].restrictedMana ?? []
  const remaining = new Map<string, number>()
  for (const unit of afterRestricted) remaining.set(`${unit.sourceId}:${unit.mana}`, (remaining.get(`${unit.sourceId}:${unit.mana}`) ?? 0) + 1)
  for (const unit of beforeRestricted) {
    const key = `${unit.sourceId}:${unit.mana}`
    const count = remaining.get(key) ?? 0
    if (count > 0) remaining.set(key, count - 1)
    else spent.push({ sourceId: `${unit.sourceId}#planned`, mana: unit.mana, amount: 1, restricted: true })
  }
  return spent
}

const startPlannedAnnouncement = (state: GameState, event: Extract<GameEvent, { type: 'castSpell' }>, catalog: PluginCatalog): ReduceResult | undefined => {
  if (!event.manaActivations?.length) return undefined
  const permissionError = legalError(state, event, makeDraft(state), catalog)
  if (permissionError) return { ok: false, error: permissionError, state, trace: [trace(event, 'rejected', { error: permissionError })] }
  const prepared = preparePlannedSpellAnnouncement(state, event)
  if (!prepared.ok) return { ok: false, error: prepared.error, state, trace: [trace(event, 'rejected', { error: prepared.error })] }
  const transaction = prepared.transaction
  const draft = makeDraft(state)
  draft.provisionalAnnouncement = {
    id: transaction.id,
    payer: event.seat,
    transaction,
    baseline: structuredClone(state),
    continuation: { ...prepared.continuation, canonicalTransaction: transaction },
    plannedManaActivations: prepared.activations,
    plannedManaCursor: 0,
    source: prepared.source,
    definitionSnapshot: prepared.definitionSnapshot,
  }
  const started = freezeDraft(draft)
  const driven = continuePlannedAnnouncement(started, catalog)
  if (!driven.ok || driven.state.resolution) return { ...driven, trace: [trace(event, driven.ok ? 'applied' : 'rejected', driven.ok ? undefined : { error: driven.error }), ...driven.trace] }
  const checked = checkpoint(driven.state, catalog)
  return checked.ok
    ? { ok: true, state: checked.state, trace: [trace(event, 'applied'), ...driven.trace, ...checked.trace] }
    : { ...checked, trace: [trace(event, 'applied'), ...driven.trace, ...checked.trace] }
}

const attackedPlayer = (attacking: NonNullable<GameState['objects'][string]['attacking']>) =>
  typeof attacking === 'string'
    ? attacking
    : attacking.kind === 'player' ? attacking.player : null

/**
 * CR 800.4a: a player leaving the game takes every object they own with them,
 * and permanents they merely controlled go back to their owners. Leaving the
 * board behind would let a dead seat keep blocking and keep priority, which
 * CR 800.4 does not allow.
 */
const leaveGame = (draft: Draft, seat: PlayerId) => {
  const abandonedResumes = pendingSelectionsFor(draft, seat)
    .flatMap((selection) => selection.resume ? [{
      type: 'custom' as const,
      name: INSTRUCTIONS_RESUME,
      payload: {
        sourceId: selection.resume.sourceId,
        remaining: selection.resume.remaining,
        ...(selection.resume.item ? { item: selection.resume.item } : {}),
      },
    }] : [])
  for (const key of [
    PENDING_SELECTION,
    PENDING_PLAYER_SELECTION,
    PENDING_OPTION_SELECTION,
    PENDING_DIALOG,
    SEARCH_PENDING,
    PENDING_STEAL_CAST,
  ]) {
    delete draft.players[seat].data[key]
  }
  for (const object of Object.values(draft.objects)) {
    if (object.owner === seat) {
      refreshExecutionReferences(draft, object)
      delete draft.objects[object.id]
      continue
    }
    if (object.controller === seat) object.controller = object.owner
  }
  for (const zone of ZONE_IDS) {
    draft.zoneOrder[seat][zone] = []
    draft.zoneCounts[seat][zone] = 0
  }
  draft.stack = draft.stack.filter((item) =>
    item.kind === 'ability'
      ? !draft.players[item.controller]?.lost
      : Boolean(draft.objects[item.objectId]))
  if (draft.resolution && draft.players[draft.resolution.controller]?.lost) {
    delete draft.resolution
  } else if (draft.resolution && abandonedResumes.length > 0) {
    draft.resolution.pendingEvents = [
      ...(draft.resolution.pendingEvents ?? []),
      ...abandonedResumes,
    ]
  }
  finishCanonicalTopDeckChoices(draft)
  draft.pendingTriggers = draft.pendingTriggers?.filter(
    (trigger) => !draft.players[trigger.execution.controller]?.lost,
  )
  draft.delayedTriggers = draft.delayedTriggers.filter((trigger) => trigger.controller !== seat)
  draft.rules = draft.rules.filter((rule) => !rule.sourceId || draft.objects[rule.sourceId])
  draft.passedInRow = draft.passedInRow.filter((player) => player !== seat)
  for (const object of Object.values(draft.objects)) {
    if (object.blocking && !draft.objects[object.blocking]) object.blocking = null
    if (!object.attacking) continue
    const player = attackedPlayer(object.attacking)
    const gone = player
      ? player === seat
      : typeof object.attacking !== 'string'
        && object.attacking.kind === 'object'
        && !draft.objects[object.attacking.objectId]
    if (gone) object.attacking = null
  }
  if (draft.priority === seat) {
    let next = nextPlayer(draft, seat)
    for (let index = 0; index < draft.playerOrder.length; index += 1) {
      if (!draft.players[next].lost) break
      next = nextPlayer(draft, next)
    }
    draft.priority = draft.players[next]?.lost ? null : next
  }
  draft.note(`${seat} leaves the game with everything they own`)
}

const sortedRules = (state: GameState) => {
  const unique = new Map<string, RuleInstance>()
  for (const rule of state.rules) unique.set(rule.instanceId, rule)
  return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp)
}

const ctxFor = (
  state: GameState,
  event: GameEvent,
  draft: ReturnType<typeof makeDraft>,
  rule: RuleInstance,
  catalog: PluginCatalog,
): HookCtx => ({ state, event, draft, rule, catalog })

export const legalError = (
  state: GameState,
  event: GameEvent,
  draft: ReturnType<typeof makeDraft>,
  catalog: PluginCatalog,
) => {
  for (const rule of sortedRules(state)) {
    const plugin = catalog.get(rule.pluginId)
    const error = plugin?.legal?.(ctxFor(state, event, draft, rule, catalog))
    if (error) return error
  }
  return undefined
}

const canonicalEffectDuration = (
  event: Extract<GameEvent, { type: 'canonicalEffect' }>,
  draft: ReturnType<typeof makeDraft>,
) => {
  switch (event.duration.kind) {
    case 'untilCleanup':
      return { kind: 'untilCleanup' as const }
    case 'permanent':
      return { kind: 'permanent' as const }
    case 'untilStep':
      return {
        kind: 'untilStep' as const,
        step: event.duration.step as StepId,
        turn: event.durationUntilStepTurn ?? event.createdTurn ?? draft.turn,
        ...(event.durationUntilStepNotBeforeTurn !== undefined
          ? { notBeforeTurn: event.durationUntilStepNotBeforeTurn } : {}),
        ...(event.durationUntilStepActive !== undefined
          ? { active: event.durationUntilStepActive } : {}),
      }
    case 'forTurns':
      return { kind: 'forTurns' as const, untilTurn: event.durationUntilTurn ?? draft.turn + 1 }
    case 'whileSourceOnBattlefield':
      return {
        kind: 'whileSourceOnBattlefield' as const,
        sourceId: event.sourceId ?? '',
        ...(event.sourceRef ? { sourceIncarnation: event.sourceRef.incarnation } : {}),
      }
  }
}

const coreApply = (draft: ReturnType<typeof makeDraft>, event: GameEvent) => {
  switch (event.type) {
    case CONTROL_EVENT.change: {
      const object = draft.object(event.objectRef.objectId)
      if (object?.zone === 'battlefield' && isSameObject(object, event.objectRef) && !draft.players[event.controller]?.lost) {
        changeControllerPermanent(object, event.controller)
      }
      return
    }
    case 'canonicalEffect': {
      const object = draft.object(event.objectId)
      const anyZone = event.effect.kind === 'setColors'
        || (event.effect.kind === 'grantKeyword' && event.effect.keyword === KEYWORDS.flash)
      if (!object || (object.zone !== 'battlefield' && !anyZone)) return
      const duration = canonicalEffectDuration(event, draft)
      switch (event.effect.kind) {
        case 'removeAbilities': {
          const before = { oracleText: object.oracleText, grantedRules: [...object.grantedRules], ...(object.effects ? { effects: structuredClone(object.effects) } : {}) }
          object.oracleText = ''
          object.grantedRules = []
          object.effects = []
          object.continuousEffects = [...(object.continuousEffects ?? []), { effect: { kind: 'removeAbilities', timestamp: draft.allocTs(), before }, duration }]
          break
        }
        case 'setStats': {
          const power = event.effect.power.kind === 'constant' ? event.effect.power.value : 0
          const toughness = event.effect.toughness.kind === 'constant' ? event.effect.toughness.value : 0
          object.continuousEffects = [...(object.continuousEffects ?? []), { effect: setStats(object, power, toughness), duration }]
          break
        }
        case 'addTypes': {
          const before = { types: [...object.types], subtypes: [...object.subtypes] }
          object.types = [...new Set([...object.types, ...(event.effect.types ?? [])])]
          object.subtypes = [...new Set([...object.subtypes, ...(event.effect.allCreatureTypes ? CREATURE_TYPES : event.effect.subtypes ?? [])])]
          object.continuousEffects = [...(object.continuousEffects ?? []), {
            effect: { kind: 'addTypes', before, types: [...(event.effect.types ?? [])], subtypes: [...(event.effect.allCreatureTypes ? CREATURE_TYPES : event.effect.subtypes ?? [])] }, duration,
          }]
          break
        }
        case 'goad':
          if (event.effectPlayer) object.continuousEffects = [...(object.continuousEffects ?? []), {
            effect: { kind: 'goad', sourceController: event.effectPlayer }, duration,
          }]
          break
        case 'setColors': {
          const before = [...object.colors]
          object.colors = [...new Set(event.effect.colors)]
          object.continuousEffects = [...(object.continuousEffects ?? []), {
            effect: { kind: 'colorChange', before, after: [...object.colors], incarnation: object.incarnation }, duration,
          }]
          break
        }
        case 'pump': {
          const power = event.effect.power.kind === 'constant' ? event.effect.power.value : 0
          const toughness = event.effect.toughness.kind === 'constant' ? event.effect.toughness.value : 0
          if (object.power !== null) object.power += power
          if (object.toughness !== null) object.toughness += toughness
          object.continuousEffects = [...(object.continuousEffects ?? []), {
            effect: { kind: 'pump', power, toughness }, duration,
          }]
          break
        }
        case 'grantKeyword':
          object.continuousEffects = [...(object.continuousEffects ?? []), {
            effect: { kind: 'staticKeywords', grant: [event.effect.keyword], suppress: [], incarnation: object.incarnation }, duration,
          }]
          break
        case 'grantActivatedAbility':
          object.canonicalGrantedActivations = [...(object.canonicalGrantedActivations ?? []), {
            ability: structuredClone(event.effect.ability),
            sourceId: event.sourceId ?? object.id,
            sourceIncarnation: event.sourceRef?.incarnation ?? draft.objects[event.sourceId ?? '']?.incarnation ?? 0,
            definitionRevision: event.sourceRevision ?? 'unknown',
            duration: structuredClone(event.duration),
            createdTurn: event.createdTurn ?? draft.turn,
            timestamp: draft.allocTs(),
            ...(event.execution ? { execution: structuredClone(event.execution) } : {}),
            ...(event.durationUntilTurn !== undefined ? { untilTurn: event.durationUntilTurn } : {}),
            ...(event.durationUntilStepTurn !== undefined ? { untilStepTurn: event.durationUntilStepTurn } : {}),
            ...(event.durationUntilStepNotBeforeTurn !== undefined ? { untilStepNotBeforeTurn: event.durationUntilStepNotBeforeTurn } : {}),
            ...(event.durationUntilStepActive !== undefined ? { untilStepActive: event.durationUntilStepActive } : {}),
          }]
          break
        case 'grantAbility':
          object.canonicalGrantedAbilities = [...(object.canonicalGrantedAbilities ?? []), {
            ability: structuredClone(event.effect.ability),
            sourceId: event.sourceId ?? object.id,
            sourceIncarnation: event.sourceRef?.incarnation ?? draft.objects[event.sourceId ?? '']?.incarnation ?? 0,
            definitionRevision: event.sourceRevision ?? 'unknown',
            duration: structuredClone(event.duration),
            createdTurn: event.createdTurn ?? draft.turn,
            timestamp: draft.allocTs(),
            ...(event.execution ? { execution: structuredClone(event.execution) } : {}),
            ...(event.durationUntilTurn !== undefined ? { untilTurn: event.durationUntilTurn } : {}),
            ...(event.durationUntilStepTurn !== undefined ? { untilStepTurn: event.durationUntilStepTurn } : {}),
            ...(event.durationUntilStepNotBeforeTurn !== undefined ? { untilStepNotBeforeTurn: event.durationUntilStepNotBeforeTurn } : {}),
            ...(event.durationUntilStepActive !== undefined ? { untilStepActive: event.durationUntilStepActive } : {}),
          }]
          break
      }
      return
    }
    case 'registerPrevention': {
      const frozen = freezeDraft(draft)
      const next = applyRegisterPrevention(frozen, event)
      draft.preventionInstances = next.preventionInstances
      draft.nextId = next.nextId
      return
    }
    case 'destroy': {
      const object = draft.object(event.objectId)
      if (!object || object.zone !== 'battlefield' || hasKeyword(object, 'indestructible', draft)) return
      draft.enqueue({ type: 'move', objectId: object.id, to: 'graveyard' })
      return
    }
    case 'linkExile': {
      const source = draft.object(event.sourceId)
      if (event.untilSourceLeaves && source?.zone !== 'battlefield') return
      if (event.sourceRef) {
        if (event.untilOpponentMonarch && opponentBecameMonarchSince(draft, event.untilOpponentMonarch)) return
        if (event.untilSourceLeaves && !isSameObject(source, event.sourceRef)) return
        for (const ref of event.targetRefs ?? []) {
          const target = draft.objects[ref.objectId]
          if (!isSameObject(target, ref)) continue
          draft.enqueue({ type: 'move', objectId: target.id, to: 'exile', exileLink: {
            source: { ...event.sourceRef },
            ...(event.untilOpponentMonarch ? { untilOpponentMonarch: { ...event.untilOpponentMonarch } } : {}),
            ...(event.untilSourceLeaves ? { untilSourceLeaves: true } : {}),
            ...(event.returnTo ? { returnTo: event.returnTo } : {}),
          } })
        }
        return
      }
      if (!source) return
      linkExileSelected(draft, source, event.objectIds)
      if (event.untilSourceLeaves) source.returnLinkedExile = event.returnTo ?? 'battlefield'
      return
    }
    case 'returnLinkedExile': {
      const source = draft.object(event.sourceId)
      if (event.sourceRef) {
        releaseCanonicalLinkedExile(draft, event.sourceRef, event.returnTo ?? 'battlefield')
        return
      }
      if (source) releaseLinkedExile(draft, source, event.returnTo ?? 'battlefield')
      return
    }
    case 'copyPermanent': {
      const source = draft.object(event.objectId)
      const token = event.token ?? (source?.zone === 'battlefield' ? copyCharacteristics(source) : undefined)
      if (!token) return
      draft.enqueue({
        type: 'createToken',
        controller: event.controller,
        token: { ...token, dsl: true },
      })
      return
    }
    case 'copySpell': {
      const original = draft.stack.find((item) => item.id === event.stackId)
      if (!original || original.kind !== 'spell') return
      const source = draft.object(original.objectId)
      if (!source) return
      const resolved = resolveCanonicalCopyTargets(draft, original, source, event.retarget === false
        ? { kind: 'keep' }
        : { kind: 'chooseNewTargets', targets: event.targets }, event.controller)
      if (!resolved.ok) {
        draft.note(`copySpell rejected: ${resolved.error}`)
        return
      }
      putCanonicalSpellCopyOnStack(draft, original, source, event.controller, resolved.targets)
      return
    }
    case 'createToken': {
      if (!event.token.dsl) return
      createToken(draft, event.controller, event.token)
      return
    }
    case 'counterStackItem': {
      const index = draft.stack.findIndex((item) => item.id === event.stackId)
      if (index < 0) return
      const item = draft.stack[index]
      if (item.uncounterable) {
        draft.note(`${item.name} cannot be countered`)
        return
      }
      draft.stack.splice(index, 1)
      if (item.copy) {
        const copyObject = draft.object(item.objectId)
        if (copyObject) ceaseToExist(draft, copyObject)
      }
      const object = draft.object(item.objectId)
      if (
        object
        && item.kind === 'spell'
        && !item.copy
        && object.zone === 'stack'
        && (!event.objectRef || isSameObject(object, event.objectRef))
        && (!item.execution?.source || isSameObject(object, item.execution.source.ref))
      ) {
        draft.enqueue({
          type: 'move',
          objectId: object.id,
          to: event.destination ?? finishedSpellZone(item, 'graveyard'),
          ...(event.controller ? { controller: event.controller } : {}),
        })
      }
      draft.note(`${item.name} was countered`)
      return
    }
    case 'addRule': {
      draft.rules.push({
        instanceId: draft.allocId('rule'),
        pluginId: event.pluginId,
        sourceId: event.sourceId ?? null,
        timestamp: draft.allocTs(),
        params: event.params ?? {},
      })
      draft.note(`addRule ${event.pluginId}`)
      return
    }
    case 'removeRule': {
      draft.rules = draft.rules.filter((rule) => {
        if (event.instanceId) return rule.instanceId !== event.instanceId
        if (event.sourceId != null && event.pluginId) {
          return !(rule.sourceId === event.sourceId && rule.pluginId === event.pluginId)
        }
        if (event.sourceId != null) return rule.sourceId !== event.sourceId
        if (event.pluginId) return rule.pluginId !== event.pluginId
        return true
      })
      draft.note('removeRule')
      return
    }
    case 'move': {
      const object = draft.object(event.objectId)
      if (!object) return
      if (event.exileLink?.untilOpponentMonarch && opponentBecameMonarchSince(draft, event.exileLink.untilOpponentMonarch)) return
      if (event.exileLink?.untilSourceLeaves && !isSameObject(draft.objects[event.exileLink.source.objectId], event.exileLink.source)) return
      const frame = draft.resolution
      if (frame?.kind === 'canonicalSpell'
        && frame.pendingResult?.kind === 'amount'
        && frame.pendingResult.eventType === 'move'
        && frame.pendingResult.destination === event.to) {
        recordInstructionAmount(draft, 'move', 1)
      }
      const previousRef = { objectId: object.id, incarnation: object.incarnation, zone: object.zone }
      const previous = object.zone
      const leftBattlefield = previous === 'battlefield' && event.to !== 'battlefield'
      const entered = previous !== 'battlefield' && event.to === 'battlefield'
      draft.move(event.objectId, event.to, event.position, event.sameZone)
      if (event.dropStackItem && previous === 'stack' && event.to !== 'stack') {
        const resolvingId = draft.resolution?.stackId
        draft.stack = draft.stack.filter((item) =>
          item.objectId !== event.objectId || item.id === resolvingId)
      }
      object.controller = event.to === 'battlefield'
        ? event.controller ?? object.controller
        : object.owner
      if (event.to === 'exile' && event.exileLink) commitExileLink(draft, event.exileLink, object)
      if (leftBattlefield) {
        releaseCanonicalLinkedExile(draft, previousRef, undefined, true)
        draft.rules = draft.rules.filter((rule) => rule.sourceId !== event.objectId)
        if (previous === 'battlefield' && event.to === 'graveyard') {
          markPutIntoGraveyardFromBattlefieldThisTurn(object)
        }
        if (object.returnLinkedExile === 'battlefield' || object.returnLinkedExile === 'hand') {
          const returnTo = object.returnLinkedExile
          delete object.returnLinkedExile
          releaseLinkedExile(draft, object, returnTo)
        }
        draft.note(`${object.name} leaves battlefield`)
      }
      if (event.chosenType) object.chosenType = event.chosenType
      if (event.chosenColor) object.chosenColor = event.chosenColor
      if (entered) {
        if (event.attachPlayer && draft.players[event.attachPlayer] && !draft.players[event.attachPlayer].lost) object.attachedTo = event.attachPlayer
        if (event.attachTo && isSameObject(draft.objects[event.attachTo.objectId], event.attachTo)) { object.attachedTo = event.attachTo.objectId; object.attachedToRef = { ...event.attachTo } }
        if (event.enterCounters) {
          const before = counterPtBonus(object)
          for (const [counter, count] of Object.entries(event.enterCounters)) {
            if (counter && Number.isSafeInteger(count) && count > 0) object.counters[counter] = (object.counters[counter] ?? 0) + count
          }
          const delta = counterPtBonus(object) - before
          if (object.power !== null) object.power += delta
          if (object.toughness !== null) object.toughness += delta
        }
        enterResolvingCopyAsToken(object)
        // CR 302.6 tracks continuous control of the permanent, not how long it
        // has been a creature. This matters if a noncreature is animated later.
        object.enteredBattlefieldTurn = draft.turn
        object.summoningSickness = true
        for (const pluginId of object.grantedRules) {
          draft.rules.push({
            instanceId: draft.allocId('rule'),
            pluginId,
            sourceId: object.id,
            timestamp: draft.allocTs(),
            params: {},
          })
        }
        draft.note(`${object.name} enters battlefield`)
        if (event.tapped) object.tapped = true
      }
      return
    }
    case 'mill': {
      const object = draft.object(event.objectId)
      if (!object || object.zone !== 'library') return
      const pending = draft.resolution?.kind === 'canonicalSpell' ? draft.resolution.pendingMilledChoice : undefined
      // A replacement can mill additional cards (CR 701.17d).
      if (pending && !pending.objects.some(ref => ref.objectId === object.id && ref.incarnation === object.incarnation)) {
        pending.objects.push({ objectId: object.id, incarnation: object.incarnation, zone: object.zone })
      }
      draft.move(object.id, 'graveyard')
      draft.note(`${object.name} is milled`)
      return
    }
    case 'proliferateCounter': {
      if (event.recipient.kind === 'object') {
        const object = draft.object(event.recipient.objectId)
        if (object && object.zone === 'battlefield' && !object.phasedOut) object.counters[event.recipient.counter] = (object.counters[event.recipient.counter] ?? 0) + 1
      } else if (event.recipient.counter === 'poison') draft.players[event.recipient.seat].poison += 1
      else draft.players[event.recipient.seat].energy += 1
      return
    }
    case 'proliferate': {
      for (const object of Object.values(draft.objects)) {
        if (object.zone !== 'battlefield' || object.controller !== event.seat || object.phasedOut) continue
        for (const counter of Object.keys(object.counters)) object.counters[counter] += 1
      }
      if (draft.players[event.seat].poison > 0) draft.players[event.seat].poison += 1
      if (draft.players[event.seat].energy > 0) draft.players[event.seat].energy += 1
      draft.note(`${event.seat} proliferates`)
      return
    }
    case 'tap': {
      const object = draft.object(event.objectId)
      if (object) {
        object.tapped = true
        if (event.skipNextUntap) object.skipNextUntap = true
      }
      return
    }
    case 'untap': {
      const object = draft.object(event.objectId)
      if (object) untapPermanent(draft, object)
      return
    }
    case 'concede': {
      if (draft.players[event.seat]?.lost) return
      draft.players[event.seat].lost = true
      draft.note(`${event.seat} concedes`)
      leaveGame(draft, event.seat)
      return
    }
    default:
      return
  }
}

const pluginApply = (
  state: GameState,
  event: GameEvent,
  draft: ReturnType<typeof makeDraft>,
  catalog: PluginCatalog,
  options: { skipTriggerCapture?: boolean } = {},
) => {
  for (const rule of sortedRules(draft)) {
    if (options.skipTriggerCapture && rule.pluginId === 'triggers') continue
    catalog.get(rule.pluginId)?.apply?.(ctxFor(state, event, draft, rule, catalog))
  }
}

const collectRecompute = (
  state: GameState,
  draft: ReturnType<typeof makeDraft>,
  catalog: PluginCatalog,
) => {
  const events: GameEvent[] = []
  const dummy: GameEvent = { type: 'custom', name: 'checkpoint.recompute' }
  for (const rule of sortedRules(draft)) {
    const extra = catalog.get(rule.pluginId)?.recompute?.(
      ctxFor(state, dummy, draft, rule, catalog),
    )
    if (extra) events.push(...extra)
  }
  return events
}

const recomputeOnly = (
  state: GameState,
  catalog: PluginCatalog,
): ReduceResult => {
  let current = state
  const entries: EventTrace[] = []
  for (let iteration = 0; iteration < CHECKPOINT_CAP; iteration += 1) {
    const derivedDraft = makeDraft(current)
    const derived = collectRecompute(current, derivedDraft, catalog)
    if (derived.length === 0) return { ok: true, state: current, trace: entries }
    for (const event of derived) {
      const next = applyEventTree(current, event, catalog)
      entries.push(...nested(next.trace, 1))
      if (!next.ok) return { ...next, state: current, trace: entries }
      current = next.state
      if (current.resolution?.phase === 'waiting') {
        return { ok: true, state: current, trace: entries }
      }
    }
  }
  return {
    ok: false,
    error: `resolution recompute did not converge after ${CHECKPOINT_CAP} iterations`,
    state: current,
    trace: entries,
  }
}

const collectSba = (
  state: GameState,
  draft: ReturnType<typeof makeDraft>,
  catalog: PluginCatalog,
) => {
  const events: GameEvent[] = []
  const dummy: GameEvent = { type: 'custom', name: 'sba' }
  for (const rule of sortedRules(draft)) {
    const extra = catalog.get(rule.pluginId)?.sba?.(ctxFor(state, dummy, draft, rule, catalog))
    if (extra) events.push(...extra)
  }
  return events
}

const checkEnded = (draft: ReturnType<typeof makeDraft>) => {
  if (draft.rules.some((rule) =>
    rule.pluginId === 'advancedCombatPrevention'
    && rule.params.mode === 'everybodyLives')) {
    return
  }
  const alive = Object.values(draft.players).filter((player) => !player.lost)
  if (alive.length <= 1) draft.ended = true
}

type ReduceOnce = ReduceResult & {
  queued?: GameEvent[]
  queuedDepth?: number
}

const trace = (
  event: GameEvent,
  outcome: EventTrace['outcome'],
  options: Partial<Omit<EventTrace, 'event' | 'outcome'>> = {},
): EventTrace => ({
  depth: 0,
  event: structuredClone(event),
  outcome,
  ...options,
})

const nested = (entries: EventTrace[], depth: number) =>
  entries.map((entry) => ({ ...entry, depth: entry.depth + depth }))

export const reduceOnce = (
  state: GameState,
  event: GameEvent,
  catalog: PluginCatalog,
  options: { skipTriggerCapture?: boolean; deferEndCheck?: boolean } = {},
): ReduceOnce => {
  if (
    state.ended
    && event.type !== 'addRule'
    && event.type !== 'removeRule'
    && event.type !== 'concede'
    && event.type !== 'authoritativeSync'
  ) {
    const error = 'game has ended'
    return { ok: false, error, state, trace: [trace(event, 'rejected', { error })] }
  }

  const preDraft = makeDraft(state)
  const preError = legalError(state, event, preDraft, catalog)
  if (preError) {
    return {
      ok: false,
      error: preError,
      state,
      trace: [trace(event, 'rejected', { error: preError })],
    }
  }

  const announcementTransactionId = state.provisionalAnnouncement?.transaction.id
  const replacement = settleReplaceableEvent(state, event, catalog, announcementTransactionId
    ? { announcementTransactionId }
    : {})
  const mergePreventionState = (base: GameState) => (
    replacement.state
      ? { ...replacement.state, prevented: base.prevented }
      : base
  )
  const applyFollowUp = (base: GameState) => {
    if (!replacement.followUp?.length && !replacement.followUpPrograms?.length) {
      return { ok: true as const, state: base, trace: [] as EventTrace[] }
    }
    let current = base
    const entries: EventTrace[] = []
    for (const inner of replacement.followUp ?? []) {
      const next = applyEventTree(current, inner, catalog, options)
      entries.push(...nested(next.trace, 1))
      if (!next.ok) return { ...next, state: current, trace: entries }
      current = next.state
    }
    if (replacement.followUpPrograms?.length) {
      const draft = makeDraft(current)
      try {
        startPreventionAdditionalPrograms(draft, replacement.followUpPrograms)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false as const, error: message, state: current, trace: entries }
      }
      current = freezeDraft(draft)
    }
    return { ok: true as const, state: current, trace: entries }
  }
  if (replacement.waiting) {
    return {
      ok: true,
      state: replacement.waiting,
      trace: [trace(event, 'replaced', { pluginId: replacement.pluginId })],
    }
  }
  const replaced = replacement.value
  if (replaced === null) {
    const afterFollowUp = applyFollowUp(mergePreventionState({ ...state, prevented: true }))
    if (!afterFollowUp.ok) return afterFollowUp
    return {
      ok: true,
      state: afterFollowUp.state,
      trace: [
        trace(event, 'prevented', { pluginId: replacement.pluginId }),
        ...afterFollowUp.trace,
      ],
      prevented: true,
    }
  }
  if (Array.isArray(replaced)) {
    const afterFollowUp = applyFollowUp(mergePreventionState(state))
    if (!afterFollowUp.ok) return afterFollowUp
    let current = afterFollowUp.state
    const entries = [trace(event, 'replaced', { pluginId: replacement.pluginId }), ...afterFollowUp.trace]
    for (const inner of replaced) {
      const next = applyEventTree(current, inner, catalog, options)
      entries.push(...nested(next.trace, 1))
      if (!next.ok) return { ...next, state: current, trace: entries }
      current = next.state
    }
    return { ok: true, state: current, trace: entries }
  }

  const afterFollowUp = applyFollowUp(mergePreventionState(state))
  if (!afterFollowUp.ok) return afterFollowUp
  const draft = makeDraft(afterFollowUp.state)
  const error = legalError(state, replaced, draft, catalog)
  if (error) {
    return {
      ok: false,
      error,
      state,
      trace: [trace(replaced, 'rejected', { error })],
    }
  }

  coreApply(draft, replaced)
  pluginApply(state, replaced, draft, catalog, options)
  if (!options.deferEndCheck) checkEnded(draft)
  const queued = [...draft.pending]
  const wasReplaced = replacement.pluginId !== undefined
  return {
    ok: true,
    state: freezeDraft(draft),
    queued,
    queuedDepth: wasReplaced ? 2 : 1,
    trace: wasReplaced
      ? [
          trace(event, 'replaced', { pluginId: replacement.pluginId }),
          ...afterFollowUp.trace,
          trace(replaced, 'applied', { depth: 1 }),
        ]
      : [...afterFollowUp.trace, trace(event, 'applied')],
  }
}

type ReduceOptions = { skipTriggerCapture?: boolean; deferEndCheck?: boolean }

const hasOpenChoice = (state: GameState) => Boolean(
  pendingSelection(state)
  || pendingPlayerSelection(state)
  || pendingOptionSelection(state)
  || pendingDialog(state)
  || searchingSeat(state)
  || state.stack.some((item) => item.kind === 'action' && item.waiting)
  || state.playerOrder.some((seat) => pendingFreeCastFor(state, seat))
  || pendingOptionalManaPay(state)
  || pendingExtort(state)
  || stackCopyPending(state)
)

const startLegacyResolution = (state: GameState) => {
  const item = state.stack[0]
  if (!item || item.kind === 'action') return state
  const draft = makeDraft(state)
  draft.resolution = {
    version: 1,
    kind: 'legacy',
    stackId: item.id,
    controller: item.controller,
    intendedPriority: draft.active,
    item: structuredClone(item),
    phase: 'committing',
    pendingEvents: [{ type: 'resolveTop' }],
  }
  draft.priority = null
  draft.passedInRow = []
  return freezeDraft(draft)
}

type EventTreeOptions = ReduceOptions

function applyEventTree(
  state: GameState,
  event: GameEvent,
  catalog: PluginCatalog,
  options: EventTreeOptions = {},
): ReduceResult {
  if (event.type === 'actionGroup') {
    return applySimultaneousActionGroup(state, event.events, catalog, event.atomic)
  }
  if (event.type === 'resolveTop' && !state.resolution) {
    const item = canonicalResolutionCandidate(state)
    if (item) {
      const draft = makeDraft(state)
      try {
        startCanonicalResolution(draft, item)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          ok: false,
          error: message,
          state,
          trace: [trace(event, 'rejected', { error: message })],
        }
      }
      return { ok: true, state: freezeDraft(draft), trace: [trace(event, 'applied')] }
    }
    if (state.stack[0] && state.stack[0].kind !== 'action') {
      return {
        ok: true,
        state: startLegacyResolution(state),
        trace: [trace(event, 'applied')],
      }
    }
  }

  const first = reduceOnce(state, event, catalog, options)
  if (!first.ok || first.prevented) return first
  let current = first.state
  const entries = [...first.trace]
  const replacedTree = event.type === 'castSpell'
    && Boolean(state.objects[event.objectId]?.ruleDefinition)
    && first.trace.some((entry) => entry.outcome === 'replaced')
  const queue = (first.queued ?? []).map((queued) => ({
    event: queued,
    depth: first.queuedDepth ?? 1,
  }))
  if (current.resolution && queue.length > 0) {
    const suspended = makeDraft(current)
    if (suspended.resolution) {
      const waitsForChoice = hasOpenChoice(suspended)
      const immediate = queue
        .map(({ event: queued }) => queued)
        .filter((queued) => !(
          waitsForChoice
          && queued.type === 'custom'
          && queued.name === INSTRUCTIONS_RESUME
        ))
      const afterChoice = queue
        .map(({ event: queued }) => queued)
        .filter((queued) => (
          waitsForChoice
          && (
            queued.type === 'resolveTop'
            || (queued.type === 'custom' && queued.name === INSTRUCTIONS_RESUME)
          )
        ))
      suspended.resolution.pendingEvents = [
        ...immediate,
        ...(suspended.resolution.pendingEvents ?? []),
      ]
      suspended.resolution.afterChoiceEvents = [
        ...(suspended.resolution.afterChoiceEvents ?? []),
        ...afterChoice,
      ]
    }
    return { ok: true, state: freezeDraft(suspended), trace: entries }
  }
  while (queue.length > 0) {
    const queued = queue.shift()!
    const next = applyEventTree(current, queued.event, catalog, options)
    entries.push(...nested(next.trace, queued.depth))
    if (!next.ok) {
      // The parent event is already committed. Report the failed continuation
      // from that committed state rather than rolling back paid costs.
      return { ...next, state: replacedTree ? state : current, trace: entries }
    }
    current = next.state
    if (current.resolution) return { ok: true, state: current, trace: entries }
  }
  return { ok: true, state: current, trace: entries }
}

const appliedEvent = (result: ReduceOnce, fallback: GameEvent) =>
  [...result.trace].reverse().find((entry) => entry.outcome === 'applied')?.event ?? fallback

/** Reduce one canonical action group against a shared occurrence before-state. */
const applySimultaneousActionGroup = (
  state: GameState,
  events: GameEvent[],
  catalog: PluginCatalog,
  atomic = false,
): ReduceResult => {
  let current = state
  const entries: EventTrace[] = []
  const occurrences: GameEvent[] = []
  const queued: Array<{ event: GameEvent; depth: number }> = []
  for (const event of events) {
    const next = reduceOnce(current, event, catalog, {
      skipTriggerCapture: true,
      deferEndCheck: true,
    })
    entries.push(...next.trace)
    if (!next.ok) return { ...next, state: atomic ? state : current, trace: entries }
    const occurrence = next.prevented || !next.trace.some((entry) => entry.outcome === 'applied')
      ? undefined
      : appliedEvent(next, event)
    if (occurrence) occurrences.push(occurrence)
    current = next.state
    queued.push(...(next.queued ?? []).map((child) => ({
      event: child,
      depth: next.queuedDepth ?? 1,
    })))
    if (atomic && !occurrence) return { ok: true, state, trace: entries }
  }
  const grouped = makeDraft(current)
  for (const occurrence of occurrences) captureEventTriggers(state, occurrence, grouped)
  checkEnded(grouped)
  current = freezeDraft(grouped)
  if (queued.length > 1 && queued.every(({ event }) => event.type === 'move' || event.type === 'destroy' || event.type === 'sacrifice')) {
    const grouped = applySimultaneousActionGroup(current, queued.map(({ event }) => event), catalog, atomic)
    entries.push(...nested(grouped.trace, 1))
    if (!grouped.ok) return { ...grouped, state: current, trace: entries }
    current = grouped.state
  } else {
    for (const child of queued) {
      const next = applyEventTree(current, child.event, catalog)
      entries.push(...nested(next.trace, child.depth))
      if (!next.ok) return { ...next, state: current, trace: entries }
      current = next.state
    }
  }
  return { ok: true, state: current, trace: entries }
}

/** Apply one precomputed SBA wave, then capture look-back triggers from its common pre-state. */
const applySimultaneousSba = (
  state: GameState,
  events: GameEvent[],
  catalog: PluginCatalog,
): ReduceResult => {
  let current = state
  const entries: EventTrace[] = []
  const occurrences: GameEvent[] = []
  const queued: Array<{ event: GameEvent; depth: number }> = []
  for (const event of events) {
    const next = reduceOnce(current, event, catalog, {
      skipTriggerCapture: true,
      deferEndCheck: true,
    })
    entries.push(...next.trace)
    if (!next.ok) return { ...next, state: current, trace: entries }
    if (!next.prevented) occurrences.push(appliedEvent(next, event))
    current = next.state
    queued.push(...(next.queued ?? []).map((child) => ({
      event: child,
      depth: next.queuedDepth ?? 1,
    })))
  }
  const simultaneous = makeDraft(current)
  for (const occurrence of occurrences) {
    captureEventTriggers(state, occurrence, simultaneous)
  }
  checkEnded(simultaneous)
  current = freezeDraft(simultaneous)
  for (const child of queued) {
    const next = applyEventTree(current, child.event, catalog)
    entries.push(...nested(next.trace, child.depth))
    if (!next.ok) continue
    current = next.state
  }
  return { ok: true, state: current, trace: entries }
}

const recordPendingInstructionResult = (
  state: ReturnType<typeof freezeDraft>,
  trace: EventTrace[] = [],
) => {
  const pending = state.resolution?.kind === 'canonicalSpell'
    ? state.resolution.pendingResult
    : undefined
  if (!pending) return state
  const draft = makeDraft(state)
  if (draft.resolution?.kind === 'canonicalSpell') {
    let result: boolean | number
    switch (pending.kind) {
      case 'amount':
        result = typeof pending.value === 'number' ? pending.value : 0
        if ((draft.resolution.pendingEvents?.length ?? 0) > 0 || draft.eventProcessing || hasOpenChoice(draft)) return state
        break
      case 'action':
        if (!pending.eventType) {
          result = pending.value ?? true
        } else {
          switch (pending.eventType) {
            case 'createToken':
            case 'copyPermanent':
            case 'copySpell':
              result = trace.filter((entry) => entry.outcome === 'applied' && entry.event.type === pending.eventType).length
              break
            default:
              result = trace.some((entry) => entry.outcome === 'applied' && entry.event.type === pending.eventType)
              break
          }
        }
        break
      case 'counter':
        result = !draft.stack.some((item) => item.id === pending.stackId)
        break
    }
    draft.resolution.results = {
      ...draft.resolution.results,
      [pending.binding]: result,
      ...(pending.booleanBinding ? { [pending.booleanBinding]: typeof result === 'number' && result > 0 } : {}),
    }
    delete draft.resolution.pendingResult
  }
  return freezeDraft(draft)
}

const driveResolution = (
  state: GameState,
  catalog: PluginCatalog,
): ReduceResult => {
  let current = state
  const entries: EventTrace[] = []
  for (let guard = 0; guard < 100_000; guard += 1) {
    const frame = current.resolution
    if (!frame || frame.phase === 'waiting') {
      return { ok: true, state: current, trace: entries }
    }
    if (frame.kind === 'legacy' && frame.phase === 'completing') {
      const item = frame.item
      const object = current.objects[item.objectId]
      const identity = item.execution?.source.ref
      const sameSource = !identity || (object && isSameObject(object, identity))
      if (item.kind === 'spell' && !item.copy && object?.zone === 'stack' && sameSource) {
        const draft = makeDraft(current)
        if (draft.resolution?.kind === 'legacy') {
          draft.resolution.phase = 'committing'
          draft.resolution.pendingEvents = [{
            type: 'move',
            objectId: object.id,
            to: finishedSpellZone(
              item,
              item.adventureCast || reboundsOnResolution(object, item) ? 'exile' : 'graveyard',
            ),
          }]
        }
        current = freezeDraft(draft)
        continue
      }
      const completed = makeDraft(current)
      completed.stack = completed.stack.filter((candidate) => candidate.id !== frame.stackId)
      completed.priority = frame.intendedPriority
      completed.passedInRow = []
      delete completed.resolution
      return { ok: true, state: freezeDraft(completed), trace: entries }
    }
    if (frame.phase === 'committing') {
      const [event, ...remaining] = frame.pendingEvents ?? []
      if (event) {
        const before = makeDraft(current)
        if (before.resolution) {
          before.resolution.pendingEvents = remaining
        }
        current = freezeDraft(before)
        const next = applyEventTree(current, event, catalog)
        entries.push(...nested(next.trace, 1))
        if (next.ok) {
          current = recordPendingInstructionResult(next.state, next.trace)
          if (event.type === 'addMana' && (frame.kind !== 'canonicalSpell' || !frame.inlineItem)) {
            const manaFrame = makeDraft(current)
            if (placePendingManaTriggers(manaFrame)) {
              current = freezeDraft(manaFrame)
              continue
            }
          }
        }
      }
      const committed = makeDraft(current)
      if (committed.resolution) {
        if (committed.resolution.kind === 'canonicalSpell'
          && (committed.resolution.pendingEvents?.length ?? 0) === 0
          && committed.resolution.pendingResolutionPayment?.paymentEvents) {
          settleResolutionPayment(committed, entries)
        }
        if ((committed.resolution.pendingEvents?.length ?? 0) > 0) {
          committed.resolution.phase = 'committing'
        } else if (hasOpenChoice(committed) || committed.eventProcessing) {
          committed.resolution.phase = 'waiting'
        } else if ((committed.resolution.afterChoiceEvents?.length ?? 0) > 0) {
          committed.resolution.pendingEvents = committed.resolution.afterChoiceEvents ?? []
          delete committed.resolution.afterChoiceEvents
          committed.resolution.phase = 'committing'
        } else {
          if (committed.resolution.kind === 'canonicalSpell') {
            committed.resolution.phase = 'running'
            delete committed.resolution.pendingEvents
          } else {
            committed.resolution.phase = 'completing'
          }
        }
      }
      current = freezeDraft(committed)
      if (current.resolution?.phase === 'waiting') {
        return { ok: true, state: current, trace: entries }
      }
      const recomputed = recomputeOnly(current, catalog)
      entries.push(...recomputed.trace)
      if (!recomputed.ok) return recomputed
      current = recomputed.state
      if (current.resolution?.phase === 'waiting') {
        return { ok: true, state: current, trace: entries }
      }
      continue
    }

    if (frame.kind !== 'canonicalSpell') {
      return { ok: true, state: current, trace: entries }
    }

    const draft = makeDraft(current)
    let step
    try {
      step = prepareResolutionStep(draft)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message, state: current, trace: entries }
    }
    current = freezeDraft(draft)
    if (step.kind === 'events') {
      if ((step.events?.length ?? 0) === 0) current = recordPendingInstructionResult(current, [])
      continue
    }
    if (step.event) {
      const next = applyEventTree(current, step.event, catalog)
      entries.push(...nested(next.trace, 1))
      if (next.ok) current = recordPendingInstructionResult(next.state, next.trace)
      if (next.ok && (hasOpenChoice(current) || current.eventProcessing)) {
        const paused = makeDraft(current)
        if (paused.resolution?.kind === 'canonicalSpell') paused.resolution.phase = 'waiting'
        return { ok: true, state: freezeDraft(paused), trace: entries }
      }
    }
    const completed = makeDraft(current)
    const completedSpell = completed.resolution?.kind === 'canonicalSpell' ? completed.resolution : undefined
    const completedInline = Boolean(completedSpell?.inlineItem)
    const completedInlineItem = completedSpell?.inlineItem
    finishResolution(completed)
    let completedState = freezeDraft(completed)
    if (completedInline) {
      if (completedInlineItem?.execution?.abilityIndex !== undefined) {
        const completion = applyEventTree(completedState, {
          type: 'custom',
          name: MANA_ABILITY_RESOLVED,
          seat: completedInlineItem.controller,
          payload: {
            sourceId: completedInlineItem.objectId,
            abilityIndex: completedInlineItem.execution.abilityIndex,
            definitionSnapshot: completedInlineItem.execution.definitionSnapshot,
          },
        }, catalog)
        if (completion.ok) {
          entries.push(...nested(completion.trace, 1))
          completedState = completion.state
        }
      }
      // Mana-added triggers from an inline mana ability wait until that
      // ability has finished its complete program. They then resolve before
      // the suspended parent resumes its next instruction.
      const manaTriggers = makeDraft(completedState)
      if (placePendingManaTriggers(manaTriggers)) {
        current = freezeDraft(manaTriggers)
        continue
      }
    }
    current = completedState
    if (current.resolution) continue
    return { ok: true, state: current, trace: entries }
  }
  return {
    ok: false,
    error: 'resolution driver did not converge after 100000 steps',
    state: current,
    trace: entries,
  }
}

const resumeCanonicalResolution = (
  state: GameState,
  event: GameEvent,
  catalog: PluginCatalog,
): ReduceResult => {
  const frame = state.resolution
  if (frame?.kind !== 'canonicalSpell' || frame.phase !== 'waiting') {
    const error = 'canonical resolution is not waiting for input'
    return { ok: false, error, state, trace: [trace(event, 'rejected', { error })] }
  }
  const answered = applyEventTree(state, event, catalog)
  if (!answered.ok) return answered
  const resultState = answered.state.resolution?.kind === 'canonicalSpell'
    && answered.state.resolution.pendingResult?.kind === 'amount'
    ? recordPendingInstructionResult(answered.state, answered.trace) : answered.state
  const draft = makeDraft(resultState)
  if (draft.resolution?.kind === 'canonicalSpell') {
    draft.resolution.phase = (draft.resolution.pendingEvents?.length ?? 0) > 0
        ? 'committing'
        : hasOpenChoice(draft) || draft.eventProcessing
          ? 'waiting'
          : (draft.resolution.afterChoiceEvents?.length ?? 0) > 0
            ? 'committing'
            : 'running'
    if (
      draft.resolution.phase === 'committing'
      && draft.resolution.pendingEvents?.length === 0
      && (draft.resolution.afterChoiceEvents?.length ?? 0) > 0
    ) {
      draft.resolution.pendingEvents = draft.resolution.afterChoiceEvents
      delete draft.resolution.afterChoiceEvents
    }
  }
  const resumed = driveResolution(freezeDraft(draft), catalog)
  return { ...resumed, trace: [...answered.trace, ...resumed.trace] }
}

const isResolutionAnswer = (state: GameState, event: GameEvent) => {
  const searchSeat = searchingSeat(state)
  const dialog = pendingDialog(state)
  const manaPaymentSeat = (
    pendingOptionalManaPay(state)?.payer
    ?? pendingExtort(state)?.seat
  )
  switch (event.type) {
    case 'selectCards':
    case 'selectPlayers':
    case 'selectOption':
    case 'continueAction':
    case 'chooseParadigm':
    case 'chooseEpicTargets':
    case 'payOptionalMana':
    case 'payExtort':
    case 'concede':
      return true
    case 'copyStackItem': {
      const pending = stackCopyPending(state)
      return Boolean(
        pending
        && pending.seat === event.seat
        && pending.sourceId === event.sourceId
        && pending.stackId === event.stackId,
      )
    }
    case 'custom': {
      return Boolean(
        (
          dialog
          && event.name === dialog.chosenEvent
          && (!event.seat || event.seat === dialog.seat)
        )
        || (
          event.name === SEARCH_CHOSEN
          && event.seat
          && event.seat === searchSeat
          && Boolean(pendingSearch(state, event.seat))
        ),
      )
    }
    case 'reveal':
      return event.seat === searchSeat || Boolean(
        dialog
        && event.seat === dialog.seat
        && event.objectIds.every((objectId) =>
          dialogCandidates(state, dialog).some((object) => object.id === objectId)),
      )
    case 'shuffleLibrary':
      return event.seat === searchSeat || Boolean(dialog?.shuffleAfter && event.seat === dialog.seat)
    case 'move': {
      if (searchSeat) {
        const search = pendingSearch(state, searchSeat)
        const spec = search && searchSpecForPending(state, search)
        const candidate = spec && searchCandidates(
          state,
          searchSeat,
          spec,
          search?.kicked,
          search?.x,
        ).some(({ id }) => id === event.objectId)
        const destinations = spec?.split
          ? ['battlefield', 'hand']
          : spec ? [spec.destination] : []
        if (candidate && destinations.includes(event.to as typeof destinations[number])) return true
      }
      return Boolean(
        dialog
        && dialog.destinations.includes(event.to as typeof dialog.destinations[number])
        && dialogCandidates(state, dialog).some((candidate) => candidate.id === event.objectId),
      )
    }
    case 'tap': {
      const object = state.objects[event.objectId]
      return Boolean(
        (searchSeat && object?.owner === searchSeat && object.zone === 'battlefield')
        || (
          dialog?.destinations.includes('battlefield')
          && object?.controller === dialog.seat
          && object.zone === 'battlefield'
        ),
      )
    }
    case 'tapForMana':
      return Boolean(
        pendingFreeCastFor(state, event.seat)
        || manaPaymentSeat === event.seat,
      )
    case 'addMana':
      return manaPaymentSeat === event.seat
    case 'castSpell':
    case 'declineFreeCast':
      return Boolean(
        state.players[event.seat]?.data[PENDING_STEAL_CAST]
        || pendingFreeCastFor(state, event.seat),
      )
    default:
      return false
  }
}

const resumeLegacyResolution = (
  state: GameState,
  event: GameEvent,
  catalog: PluginCatalog,
): ReduceResult => {
  const frame = state.resolution
  if (frame?.kind !== 'legacy') {
    const error = 'no legacy resolution is waiting'
    return { ok: false, error, state, trace: [trace(event, 'rejected', { error })] }
  }
  const answered = applyEventTree(state, event, catalog)
  if (!answered.ok) return answered
  const draft = makeDraft(answered.state)
  if (draft.resolution?.kind === 'legacy') {
    draft.resolution.phase = draft.resolution.pendingEvents.length > 0
        ? 'committing'
        : hasOpenChoice(draft) || draft.eventProcessing
          ? 'waiting'
          : (draft.resolution.afterChoiceEvents?.length ?? 0) > 0
            ? 'committing'
            : 'completing'
    if (
      draft.resolution.phase === 'committing'
      && draft.resolution.pendingEvents.length === 0
      && (draft.resolution.afterChoiceEvents?.length ?? 0) > 0
    ) {
      draft.resolution.pendingEvents = draft.resolution.afterChoiceEvents ?? []
      delete draft.resolution.afterChoiceEvents
    }
  }
  const resumed = driveResolution(freezeDraft(draft), catalog)
  return { ...resumed, trace: [...answered.trace, ...resumed.trace] }
}

const checkpoint = (
  state: GameState,
  catalog: PluginCatalog,
): ReduceResult => {
  let current = state
  const entries: EventTrace[] = []
  const intendedPriority = current.priority
  for (let iteration = 0; iteration < CHECKPOINT_CAP; iteration += 1) {
    const derivedDraft = makeDraft(current)
    const derived = collectRecompute(current, derivedDraft, catalog)
    if (derived.length > 0) {
      for (const event of derived) {
        const next = applyEventTree(current, event, catalog)
        entries.push(...nested(next.trace, 1))
        if (!next.ok) return { ...next, state: current, trace: entries }
        current = next.state
      }
      continue
    }

    const sbaDraft = makeDraft(current)
    const pending = collectSba(current, sbaDraft, catalog)
    if (pending.length > 0) {
      const next = applySimultaneousSba(current, pending, catalog)
      entries.push(...nested(next.trace, 1))
      if (!next.ok) return { ...next, state: current, trace: entries }
      current = next.state
      continue
    }

    if ((current.pendingTriggers?.length ?? 0) > 0) {
      const triggerDraft = makeDraft(current)
      const openedChoice = placePendingTriggers(triggerDraft)
      triggerDraft.passedInRow = []
      triggerDraft.priority = intendedPriority
      current = freezeDraft(triggerDraft)
      if (openedChoice) return { ok: true, state: current, trace: entries }
      if (current.resolution) {
        const driven = driveResolution(current, catalog)
        entries.push(...driven.trace)
        if (!driven.ok) return { ...driven, trace: entries }
        current = driven.state
        if (current.resolution?.phase === 'waiting') return { ok: true, state: current, trace: entries }
      }
      continue
    }

    const stable = makeDraft(current)
    checkEnded(stable)
    return { ok: true, state: freezeDraft(stable), trace: entries }
  }
  return {
    ok: false,
    error: `execution checkpoint did not converge after ${CHECKPOINT_CAP} iterations`,
    state: current,
    trace: entries,
  }
}

export const rules = (
  state: GameState,
  event: GameEvent,
  catalog: PluginCatalog,
): ReduceResult => {
  if (event.type === 'cancelAnnouncement') {
    const frame = state.provisionalAnnouncement
    if (!frame || frame.id !== event.announcementId || frame.payer !== event.seat) {
      const error = 'no cancellable announcement for this player'
      return { ok: false, error, state, trace: [trace(event, 'rejected', { error })] }
    }
    const restored = structuredClone(frame.baseline)
    delete restored.provisionalAnnouncement
    return { ok: true, state: restored, trace: [trace(event, 'applied')] }
  }
  if (state.resolution?.kind === 'legacy') {
    if (!isResolutionAnswer(state, event)) {
      const error = 'resolution is waiting for input'
      return { ok: false, error, state, trace: [trace(event, 'rejected', { error })] }
    }
    const resumed = resumeLegacyResolution(state, event, catalog)
    if (!resumed.ok || resumed.state.resolution) return resumed
    const continued = continuePlannedAnnouncement(resumed.state, catalog)
    if (!continued.ok || continued.state.resolution) return { ...continued, trace: [...resumed.trace, ...continued.trace] }
    const checked = checkpoint(continued.state, catalog)
    return checked.ok
      ? { ok: true, state: checked.state, trace: [...resumed.trace, ...continued.trace, ...checked.trace] }
      : { ...checked, trace: [...resumed.trace, ...continued.trace, ...checked.trace] }
  }
  if (state.resolution?.phase === 'waiting') {
    if (!isResolutionAnswer(state, event)) {
      const error = 'resolution is waiting for input'
      return { ok: false, error, state, trace: [trace(event, 'rejected', { error })] }
    }
    const resumed = resumeCanonicalResolution(state, event, catalog)
    if (!resumed.ok || resumed.state.resolution) return resumed
    const continued = continuePlannedAnnouncement(resumed.state, catalog)
    if (!continued.ok || continued.state.resolution) return { ...continued, trace: [...resumed.trace, ...continued.trace] }
    const checked = checkpoint(continued.state, catalog)
    return checked.ok
      ? { ok: true, state: checked.state, trace: [...resumed.trace, ...continued.trace, ...checked.trace] }
      : { ...checked, trace: [...resumed.trace, ...continued.trace, ...checked.trace] }
  }
  if (event.type === 'resumeResolution') {
    if (!state.resolution) {
      const error = 'no resolution cursor to resume'
      return { ok: false, error, state, trace: [trace(event, 'rejected', { error })] }
    }
    const driven = driveResolution(state, catalog)
    const entries = [trace(event, 'applied'), ...driven.trace]
    if (!driven.ok || driven.state.resolution) return { ...driven, trace: entries }
    const checked = checkpoint(driven.state, catalog)
    return checked.ok
      ? { ok: true, state: checked.state, trace: [...entries, ...checked.trace] }
      : { ...checked, trace: [...entries, ...checked.trace] }
  }
  if (
    event.type === 'resolveTop'
    && hasOpenChoice(state)
  ) {
    const error = 'a player choice must be completed before another stack item resolves'
    return { ok: false, error, state, trace: [trace(event, 'rejected', { error })] }
  }
  if (event.type === 'castSpell' && event.canonicalTransaction) {
    const error = 'canonical transaction state is server-private'
    return { ok: false, error, state, trace: [trace(event, 'rejected', { error })] }
  }
  if (event.type === 'castSpell' && event.manaActivations?.length && !state.provisionalAnnouncement && !state.resolution) {
    const planned = startPlannedAnnouncement(state, event, catalog)
    if (planned) return planned
  }
  // Canonical transaction continuations are server-created queue events. A
  // public action cannot inject one by serializing the internal field.
  const publicEvent = event.type === 'castSpell' && event.canonicalTransaction
    ? (() => {
      const { canonicalTransaction: _private, ...untrusted } = event
      return untrusted as GameEvent
    })()
    : event
  const applied = applyEventTree(state, publicEvent, catalog)
  if (!applied.ok) return applied
  let current = applied.state
  const entries = [...applied.trace]
  if (current.resolution) {
    const driven = driveResolution(current, catalog)
    entries.push(...driven.trace)
    if (!driven.ok) return { ...driven, trace: entries }
    current = driven.state
    if (current.resolution) return { ok: true, state: current, trace: entries }
  }
  const checked = checkpoint(current, catalog)
  entries.push(...checked.trace)
  if (!checked.ok) return { ...checked, trace: entries }
  current = checked.state
  if (current.provisionalAnnouncement && !hasOpenChoice(current) && !current.eventProcessing) {
    const continued = continuePlannedAnnouncement(current, catalog)
    entries.push(...continued.trace)
    if (!continued.ok) return { ...continued, trace: entries }
    current = continued.state
    if (current.resolution) {
      const driven = driveResolution(current, catalog)
      entries.push(...driven.trace)
      if (!driven.ok) return { ...driven, trace: entries }
      current = driven.state
      if (current.resolution) return { ok: true, state: current, trace: entries }
    }
    if (current.provisionalAnnouncement && (hasOpenChoice(current) || current.eventProcessing)) {
      return { ok: true, state: current, trace: entries }
    }
    const after = checkpoint(current, catalog)
    entries.push(...after.trace)
    return after.ok
      ? { ok: true, state: after.state, trace: entries }
      : { ...after, trace: entries }
  }
  return { ok: true, state: current, trace: entries }
}

export const isBattlefield = (zone: ZoneId) => zone === 'battlefield'

registerNestedApply(applyEventTree)
