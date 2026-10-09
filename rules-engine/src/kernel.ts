import type { PluginCatalog } from './catalog'
import type { Draft } from './draft'
import { freezeDraft, makeDraft, nextPlayer } from './draft'
import type {
  GameEvent,
  GameState,
  HookCtx,
  EventTrace,
  PlayerId,
  ReduceResult,
  RuleInstance,
  ZoneId,
} from './types'
import { markPutIntoGraveyardFromBattlefieldThisTurn } from './plugins/fromBattlefieldThisTurn'
import { untapPermanent } from './rules/untap'
import { ZONE_IDS } from './types'
import {
  canonicalResolutionCandidate,
  finishResolution,
  prepareResolutionStep,
  startCanonicalResolution,
} from './driver'
import { captureEventTriggers, placePendingTriggers } from './rules/triggers'
import {
  INSTRUCTIONS_RESUME,
  PENDING_SELECTION,
  PENDING_STEAL_CAST,
  pendingSelection,
  pendingSelectionsFor,
} from './rules/selectCards'
import { PENDING_PLAYER_SELECTION, pendingPlayerSelection } from './rules/selectPlayers'
import { PENDING_OPTION_SELECTION, pendingOptionSelection } from './rules/selectOptions'
import { PENDING_DIALOG, dialogCandidates, pendingDialog } from './pendingDialog'
import { finishedSpellZone } from './cardPlugins/alternateCosts'
import {
  SEARCH_CHOSEN,
  SEARCH_PENDING,
  pendingSearch,
  searchCandidates,
  searchSpecForPending,
  searchingSeat,
} from './cardPlugins/librarySearch'
import { pendingFreeCastFor, reboundsOnResolution } from './plugins/rebound'
import { isSameObject } from './objectIdentity'
import { pendingOptionalManaPay } from './cardPlugins/optionalManaPay'
import { pendingExtort } from './cardPlugins/extort'
import { stackCopyPending } from './cardPlugins/stackCopy'

const CHECKPOINT_CAP = 32

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

const replaceEvent = (
  state: GameState,
  event: GameEvent,
  catalog: PluginCatalog,
): { value: GameEvent | GameEvent[] | null; pluginId?: string } => {
  let current: GameEvent = event
  const used = new Set<string>()
  let pluginId: string | undefined
  let guard = 0
  while (guard < 64) {
    guard += 1
    let hit = false
    for (const rule of sortedRules(state)) {
      if (used.has(rule.instanceId)) continue
      const plugin = catalog.get(rule.pluginId)
      const next = plugin?.replace?.(ctxFor(state, current, makeDraft(state), rule, catalog))
      if (next === undefined) continue
      pluginId = rule.pluginId
      if (next === null) return { value: null, pluginId }
      used.add(rule.instanceId)
      if (Array.isArray(next)) return { value: next, pluginId }
      current = next
      hit = true
      break
    }
    if (!hit) return { value: current, pluginId }
  }
  return { value: current, pluginId }
}

const legalError = (
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

const coreApply = (draft: ReturnType<typeof makeDraft>, event: GameEvent) => {
  switch (event.type) {
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
      const previous = object.zone
      const leftBattlefield = previous === 'battlefield' && event.to !== 'battlefield'
      const entered = previous !== 'battlefield' && event.to === 'battlefield'
      draft.move(event.objectId, event.to, event.position, event.sameZone)
      object.controller = event.to === 'battlefield'
        ? event.controller ?? object.controller
        : object.owner
      if (leftBattlefield) {
        draft.rules = draft.rules.filter((rule) => rule.sourceId !== event.objectId)
        if (previous === 'battlefield' && event.to === 'graveyard') {
          markPutIntoGraveyardFromBattlefieldThisTurn(object)
        }
        draft.note(`${object.name} leaves battlefield`)
      }
      if (entered) {
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
      }
      return
    }
    case 'tap': {
      const object = draft.object(event.objectId)
      if (object) object.tapped = true
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

  const replacement = replaceEvent(state, event, catalog)
  const replaced = replacement.value
  if (replaced === null) {
    return {
      ok: true,
      state: { ...state, prevented: true },
      trace: [trace(event, 'prevented', { pluginId: replacement.pluginId })],
      prevented: true,
    }
  }
  if (Array.isArray(replaced)) {
    let current = state
    const entries = [trace(event, 'replaced', { pluginId: replacement.pluginId })]
    for (const inner of replaced) {
      const next = applyEventTree(current, inner, catalog, options)
      entries.push(...nested(next.trace, 1))
      if (!next.ok) return { ...next, state: current, trace: entries }
      current = next.state
    }
    return { ok: true, state: current, trace: entries }
  }

  const draft = makeDraft(state)
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
  const wasReplaced = replaced !== event
  return {
    ok: true,
    state: freezeDraft(draft),
    queued,
    queuedDepth: wasReplaced ? 2 : 1,
    trace: wasReplaced
      ? [
          trace(event, 'replaced', { pluginId: replacement.pluginId }),
          trace(replaced, 'applied', { depth: 1 }),
        ]
      : [trace(event, 'applied')],
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
      return { ...next, state: current, trace: entries }
    }
    current = next.state
    if (current.resolution) return { ok: true, state: current, trace: entries }
  }
  return { ok: true, state: current, trace: entries }
}

const appliedEvent = (result: ReduceOnce, fallback: GameEvent) =>
  [...result.trace].reverse().find((entry) => entry.outcome === 'applied')?.event ?? fallback

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
        if (next.ok) current = next.state
      }
      const committed = makeDraft(current)
      if (committed.resolution) {
        if ((committed.resolution.pendingEvents?.length ?? 0) > 0) {
          committed.resolution.phase = 'committing'
        } else if (hasOpenChoice(committed)) {
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
    if (step.kind === 'events') continue
    if (step.event) {
      const next = applyEventTree(current, step.event, catalog)
      entries.push(...nested(next.trace, 1))
      if (next.ok) current = next.state
    }
    const completed = makeDraft(current)
    finishResolution(completed)
    return { ok: true, state: freezeDraft(completed), trace: entries }
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
  const draft = makeDraft(answered.state)
  if (draft.resolution?.kind === 'canonicalSpell') {
    draft.resolution.phase = (draft.resolution.pendingEvents?.length ?? 0) > 0
        ? 'committing'
        : hasOpenChoice(draft)
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
        : hasOpenChoice(draft)
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
  if (state.resolution?.kind === 'legacy') {
    if (!isResolutionAnswer(state, event)) {
      const error = 'resolution is waiting for input'
      return { ok: false, error, state, trace: [trace(event, 'rejected', { error })] }
    }
    const resumed = resumeLegacyResolution(state, event, catalog)
    if (!resumed.ok || resumed.state.resolution) return resumed
    const checked = checkpoint(resumed.state, catalog)
    return {
      ...checked,
      trace: [...resumed.trace, ...checked.trace],
    }
  }
  if (state.resolution?.phase === 'waiting') {
    if (!isResolutionAnswer(state, event)) {
      const error = 'resolution is waiting for input'
      return { ok: false, error, state, trace: [trace(event, 'rejected', { error })] }
    }
    const resumed = resumeCanonicalResolution(state, event, catalog)
    if (!resumed.ok || resumed.state.resolution) return resumed
    const checked = checkpoint(resumed.state, catalog)
    return checked.ok
      ? { ok: true, state: checked.state, trace: [...resumed.trace, ...checked.trace] }
      : { ...checked, trace: [...resumed.trace, ...checked.trace] }
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
  const applied = applyEventTree(state, event, catalog)
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
  return checked.ok
    ? { ok: true, state: checked.state, trace: entries }
    : { ...checked, trace: entries }
}

export const isBattlefield = (zone: ZoneId) => zone === 'battlefield'
