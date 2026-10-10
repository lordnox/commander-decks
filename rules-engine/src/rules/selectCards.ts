import type Draft from '../draft'
import type {
  GameEvent,
  GameState,
  PlayerId,
  Plugin,
  StackExecutionContext,
  StackItem,
  ObjectIdentity,
  ZoneId,
} from '../types'
import { runInstructions, type CardInstruction, type TargetFilter } from '../cardPlugins/effects'
import { linkExileSelected } from '../cardPlugins/linkedExile'
import { linkMonarchExileSelected } from '../cardPlugins/monarchExile'
import { isKnownTo, markKnownTo, markKnownToAll } from '../knowledge'
import { matchesTargetFilter, validTarget } from '../cardPlugins/targetedResolve'
import { grantOracleLineUntilEndOfTurn } from '../cardPlugins/continuousEffects'
import { addPlusCounters } from '../cardPlugins/effectRuntime'
import { payCost } from '../plugins/spells'
import { registerDelayedTrigger } from './delayedTriggers'
import { targetObject } from '../objectIdentity'
import { continueCanonicalTargetSelection } from './canonicalAnnouncement'

export const PENDING_SELECTION = 'kernel.pendingSelection'
export const PENDING_STEAL_CAST = 'stealCast.pending'
export const INSTRUCTIONS_RESUME = 'instructions.resume'

export type InstructionResume = {
  sourceId: string
  remaining: CardInstruction[]
  item?: StackItem
}

export type CardSelectionKind =
  | 'choose'
  | 'discard'
  | 'sacrifice'
  | 'scry'
  | 'surveil'
  | 'reveal'
  | 'partition'
  | 'choosePile'

export type CardSelectionDestination =
  | 'top'
  | 'bottom'
  | 'skip'
  | 'graveyard'
  | 'battlefield'
  | 'sacrifice'
  | 'library'
  | 'target'
  | 'hand'
  | 'face-up'
  | 'face-down'

export type OpponentPileReveal = 'public' | 'look'
export type OpponentPileVisibility = 'public' | 'facedown-faceup'

export type CardSelectionChoice = {
  objectId: string
  destination: CardSelectionDestination
}

/** Server-owned choice state until the seat sends `selectCards` with `objectIds`. */
export type PendingCardSelection = {
  id: string
  seat: PlayerId
  kind: CardSelectionKind
  count: number
  min?: number
  /** Object ids the chooser may pick from; host must not infer these from hidden zones. */
  candidates: string[]
  sourceId?: string
  source?: string
  prompt?: string
  destinations?: CardSelectionDestination[]
  /** Exact number of cards a `scry` look must put into hand (fewer when fewer cards were looked at). */
  handQuota?: number
  /** Whose zone the cards come from (defaults to `seat`). */
  fromSeat?: PlayerId
  fromZone?: ZoneId
  sequence?: number
  after?: Array<'resolveTop' | 'shuffleLibrary'>
  drawPerSelected?: number
  moveSelectedTo?: ZoneId
  moveLibraryPosition?: 'top' | 'bottom'
  moveSelectedController?: PlayerId
  addSubtypes?: string[]
  tapSelected?: boolean
  untapSelected?: boolean
  plusCounters?: number
  castWithoutPaying?: boolean
  action?: {
    kind: 'dredge'
    replacedBy: string[]
    remainingAfter?: number
  } | {
    kind: 'abundance-order'
    remainingAfter?: number
  }
  /** CR 603.3b ordering answer for a controller's pending trigger group. */
  triggerOrder?: { ids: string[]; pass: 1 | 2; entries?: Array<{ id: string; label: string }> }
  /** Canonical triggered ability target answer, retained until it is stacked. */
  canonicalTrigger?: {
    definitionSnapshot: import('../cardPlugins/dsl/schema/v1').CardRuleDefinitionSnapshotV1
    abilityIndex: number
    execution: StackExecutionContext
    sourceId: string
    targetClauses?: Array<{ min: number; max: number }>
        targetClauseDefinitions?: import('../cardPlugins/dsl/schema/v1').TargetClause[]
    targetIndex?: number
    selectedTargets?: import('../types').TargetRef[]
    selectedModes?: number[]
  }
  /** Put a targeted triggered ability on the stack after this pre-stack target choice. */
  triggerAbilityId?: string
  triggerInstructions?: CardInstruction[]
  triggerPayload?: Record<string, unknown>
  triggerExecution?: StackExecutionContext
  /** Exile chosen permanents linked to `sourceId` (see `linkedExile` plugin). */
  linkExile?: boolean
  /** Exile chosen permanents until an opponent becomes monarch. */
  exileUntilOpponentMonarch?: boolean
  targetFilter?: TargetFilter
  /** Identity offered for a pre-stack target choice; prevents leave-and-return rebinding. */
  targetIdentities?: Record<string, ObjectIdentity>
  triggerX?: number
  grantKeywordsUntilEot?: string[]
  piles?: { 'face-up': string[]; 'face-down': string[] }
  pileController?: PlayerId
  pileReveal?: OpponentPileReveal
  pileVisibility?: OpponentPileVisibility
  /** Refresh candidates from `fromZone` while the choice is open. */
  liveZone?: true
  /** Remaining instructions after this choice; applied once the selected cards have moved. */
  resume?: InstructionResume
  /** Canonical Rule DSL card-choice continuation. */
  canonicalChoice?: {
    stackId: string
    binding: string
  }
  /** Pay this mana only if at least one card is chosen. */
  payMana?: string
  /** Pay this life only if at least one card is chosen. */
  payLife?: number
  /** After a non-empty choice, also move these objects (Masked Vandal / Victimize "if you do"). */
  ifYouDo?: {
    objectIds: string[]
    to: ZoneId
    controller?: PlayerId
    tapped?: boolean
  }
  /** After a successful discard, register a one-shot "when you do" trigger. */
  reflexive?: { filter: TargetFilter; do: CardInstruction[] }
}

const isSelection = (value: unknown): value is PendingCardSelection =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingCardSelection).id === 'string'
  && typeof (value as PendingCardSelection).seat === 'string'
  && typeof (value as PendingCardSelection).kind === 'string'
  && typeof (value as PendingCardSelection).count === 'number'
  && Array.isArray((value as PendingCardSelection).candidates)

export const pendingSelectionsFor = (
  state: GameState | Draft,
  seat: PlayerId,
): PendingCardSelection[] => {
  const value = state.players[seat]?.data[PENDING_SELECTION]
  if (Array.isArray(value)) return value.filter(isSelection)
  return isSelection(value) ? [value] : []
}

export const pendingSelectionFor = (state: GameState | Draft, seat: PlayerId) =>
  pendingSelectionsFor(state, seat)[0]

/** Library objects a viewer may keep: pending candidates, except unknown choosePile cards. */
export const visibleLibrarySelectionIds = (
  state: GameState | Draft,
  viewer: PlayerId | null,
) => {
  const ids = new Set<string>()
  if (!viewer) return ids
  for (const selection of pendingSelectionsFor(state, viewer)) {
    for (const objectId of selection.candidates) {
      const object = state.objects[objectId]
      if (object?.zone !== 'library') continue
      if (
        selection.kind === 'choosePile'
        && !isKnownTo(object, viewer, state.playerOrder)
      ) {
        continue
      }
      ids.add(objectId)
    }
  }
  return ids
}

export const pendingSelectionById = (state: GameState | Draft, id: string) => {
  for (const seat of state.playerOrder) {
    const match = pendingSelectionsFor(state, seat).find((selection) => selection.id === id)
    if (match) return match
  }
}

/** Oldest open selection in APNAP order (or lowest `sequence` when set). */
export const pendingSelection = (state: GameState) => {
  const open = state.playerOrder.flatMap((seat) => pendingSelectionsFor(state, seat))
  const sequenced = open.filter((selection) => typeof selection.sequence === 'number')
  if (sequenced.length > 0) {
    return [...sequenced].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))[0]
  }
  for (const seat of state.playerOrder) {
    const selection = pendingSelectionFor(state, seat)
    if (selection) return selection
  }
}

/**
 * A seat answers a pick by giving every offered card a destination, so it needs
 * "not targeted" whenever it may leave candidates out (more offered than the minimum).
 */
export const targetDestinations = (
  candidates: number,
  min: number,
): CardSelectionDestination[] =>
  min === 0 || candidates > min ? ['skip', 'target'] : ['target']

export const openCardSelection = (
  draft: Draft,
  args: Omit<PendingCardSelection, 'id'>,
) => {
  const selection: PendingCardSelection = { id: draft.allocId('selection'), ...args }
  draft.players[args.seat].data[PENDING_SELECTION] = [
    ...pendingSelectionsFor(draft, args.seat),
    selection,
  ]
  const active = pendingSelection(draft)
  if (active) draft.priority = active.seat
}

const clearPendingSelection = (draft: Draft, seat: PlayerId) => {
  const remaining = pendingSelectionsFor(draft, seat).slice(1)
  if (remaining.length === 0) delete draft.players[seat].data[PENDING_SELECTION]
  else draft.players[seat].data[PENDING_SELECTION] = remaining
}

const cardInHand = (state: GameState | Draft, seat: PlayerId, objectId: string) => {
  const object = state.objects[objectId]
  return object?.zone === 'hand' && object.controller === seat
}

const libraryTop = (state: GameState | Draft, seat: PlayerId, count: number) =>
  (state.zoneOrder[seat]?.library ?? []).slice(0, count)

const battlefieldPermanent = (state: GameState | Draft, seat: PlayerId, objectId: string) => {
  const object = state.objects[objectId]
  return object?.zone === 'battlefield'
    && object.controller === seat
}

export const liveSelectionCandidates = (
  state: GameState | Draft,
  selection: PendingCardSelection,
) => {
  const fromSeat = selection.fromSeat ?? selection.seat
  const controller = selection.seat
  if (selection.kind === 'discard' || selection.kind === 'reveal') {
    return selection.candidates.filter((objectId) => cardInHand(state, fromSeat, objectId))
  }
  if (
    (selection.kind === 'scry' || selection.kind === 'surveil' || selection.kind === 'partition')
    && (!selection.fromZone || selection.fromZone === 'library')
  ) {
    const top = new Set(libraryTop(state, fromSeat, selection.count))
    return selection.candidates.filter((objectId) => top.has(objectId))
  }
  if (selection.kind === 'choosePile') {
    return selection.candidates.filter((objectId) => {
      const object = state.objects[objectId]
      return object?.zone === 'library'
    })
  }
  if (selection.kind === 'sacrifice') {
    return selection.candidates.filter((objectId) => battlefieldPermanent(state, fromSeat, objectId))
  }
  if (selection.kind === 'choose' && selection.liveZone && selection.fromZone) {
    return (state.zoneOrder[fromSeat]?.[selection.fromZone] ?? []).filter((objectId) => {
      const object = state.objects[objectId]
      if (!object) return false
      if (!selection.targetFilter) return true
      return matchesTargetFilter(state as GameState, object, selection.targetFilter, controller)
    })
  }
  return selection.candidates.filter((objectId) => {
    const object = state.objects[objectId]
    return Boolean(object)
      && (!selection.targetIdentities
        || Boolean(targetObject(state, {
          kind: 'object',
          ...selection.targetIdentities[objectId],
        })))
      && (!selection.fromZone || object?.zone === selection.fromZone)
      && (!selection.fromSeat || object?.owner === selection.fromSeat)
      && (!selection.targetFilter
        || validTarget(state as GameState, object, selection.targetFilter, controller))
  })
}

const liveCandidates = (state: GameState, selection: PendingCardSelection) =>
  liveSelectionCandidates(state, selection)

const expectedCount = (state: GameState, selection: PendingCardSelection) =>
  Math.min(selection.count, liveCandidates(state, selection).length)

const allowedDestinations = (selection: PendingCardSelection): CardSelectionDestination[] => {
  if (selection.destinations?.length) return selection.destinations
  if (selection.kind === 'scry') return ['top', 'bottom']
  if (selection.kind === 'surveil') return ['top', 'graveyard']
  if (selection.kind === 'partition') return ['face-up', 'face-down']
  if (selection.kind === 'choosePile') return ['hand']
  return ['graveyard']
}

const sameIdSet = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false
  const rightIds = new Set(right)
  return left.every((id) => rightIds.has(id))
}

export const openOpponentPilePartition = (
  draft: Draft,
  args: {
    opponent: PlayerId
    controller: PlayerId
    sourceId: string
    source: string
    count: number
    reveal: OpponentPileReveal
    piles: OpponentPileVisibility
  },
) => {
  const candidates = draft.zoneOrder[args.controller].library.slice(0, args.count)
  if (candidates.length === 0) return
  if (args.reveal === 'public') {
    draft.enqueue({
      type: 'reveal',
      seat: args.controller,
      objectIds: candidates,
      source: args.source,
    })
  } else {
    markKnownTo(draft, candidates, [args.opponent])
    draft.note(`${args.opponent} looks at the top ${candidates.length} cards for ${args.source}`)
  }
  openCardSelection(draft, {
    seat: args.opponent,
    kind: 'partition',
    count: args.count,
    candidates,
    sourceId: args.sourceId,
    source: args.source,
    prompt: args.piles === 'public'
      ? `Separate these cards into two piles.`
      : `Separate these cards into a face-down pile and a face-up pile.`,
    destinations: ['face-up', 'face-down'],
    fromSeat: args.controller,
    pileController: args.controller,
    pileReveal: args.reveal,
    pileVisibility: args.piles,
  })
}

const parseChoices = (
  event: Extract<GameEvent, { type: 'selectCards' }>,
): CardSelectionChoice[] | undefined => {
  if (!Array.isArray(event.choices)) return
  const choices: CardSelectionChoice[] = []
  for (const entry of event.choices) {
    if (
      !entry
      || typeof entry !== 'object'
      || typeof (entry as CardSelectionChoice).objectId !== 'string'
      || typeof (entry as CardSelectionChoice).destination !== 'string'
    ) {
      return
    }
    choices.push(entry as CardSelectionChoice)
  }
  return choices
}

const legalSelectCards = (state: GameState, event: GameEvent) => {
  if (event.type !== 'selectCards') return

  const selection = pendingSelectionFor(state, event.seat)
  if (!selection) return `${event.seat} has no open card selection`
  if (event.selectionId !== undefined && event.selectionId !== selection.id) {
    return 'card selection identity is stale'
  }
  if (selection.kind !== event.kind) return `expected a ${selection.kind} selection`
  if (event.count !== selection.count) return `expected count ${selection.count}`

  const expected = expectedCount(state, selection)
  if (selection.triggerOrder) {
    const objectIds = event.objectIds
    if (!Array.isArray(objectIds) || objectIds.length !== selection.triggerOrder.ids.length) {
      return 'must order every pending trigger'
    }
    if (new Set(objectIds).size !== objectIds.length
      || objectIds.some((id) => !selection.triggerOrder?.ids.includes(id))) {
      return 'trigger order contains an unoffered or duplicate trigger'
    }
    return
  }
  const allowed = new Set(liveCandidates(state, selection))
  const destinations = new Set(allowedDestinations(selection))

  if (selection.kind === 'choosePile') {
    const objectIds = event.objectIds
    if (!Array.isArray(objectIds) || !objectIds.every((id) => typeof id === 'string')) {
      return 'objectIds must be a string array'
    }
    if (new Set(objectIds).size !== objectIds.length) {
      return 'objectIds must not contain duplicates'
    }
    const piles = selection.piles
    if (!piles) return 'no piles were constructed for this selection'
    const matchesPile = sameIdSet(objectIds, piles['face-up'])
      || sameIdSet(objectIds, piles['face-down'])
    if (!matchesPile) return 'must choose exactly one constructed pile'
    for (const objectId of objectIds) {
      if (!selection.candidates.includes(objectId)) {
        return 'card was not offered for this selection'
      }
      if (!allowed.has(objectId)) {
        return 'card is no longer a valid choice'
      }
    }
    return
  }

  if (
    selection.kind === 'discard'
    || selection.kind === 'sacrifice'
    || selection.kind === 'reveal'
    || selection.kind === 'choose'
  ) {
    const objectIds = event.objectIds
    if (!Array.isArray(objectIds) || !objectIds.every((id) => typeof id === 'string')) {
      return 'objectIds must be a string array'
    }
    if (new Set(objectIds).size !== objectIds.length) {
      return 'objectIds must not contain duplicates'
    }
    const minimum = selection.min ?? expected
    if (objectIds.length < minimum || objectIds.length > expected) {
      return minimum === expected
        ? `must choose exactly ${expected} card(s)`
        : `must choose between ${minimum} and ${expected} card(s)`
    }
    for (const objectId of objectIds) {
      if (!selection.liveZone && !selection.candidates.includes(objectId)) {
        return 'card was not offered for this selection'
      }
      if (!allowed.has(objectId)) {
        return 'card is no longer a valid choice'
      }
    }
    if (objectIds.length > 0) {
      if (selection.payMana && !payCost(state.players[event.seat].mana, selection.payMana)) {
        return `${event.seat} cannot pay ${selection.payMana}`
      }
      if (selection.payLife && state.players[event.seat].life < selection.payLife) {
        return `${event.seat} cannot pay ${selection.payLife} life`
      }
    }
    return
  }

  const choices = parseChoices(event)
  if (!choices) return 'choices must list each candidate with a destination'
  if (choices.length !== expected) {
    return `must assign exactly ${expected} card(s)`
  }
  const seen = new Set<string>()
  for (const choice of choices) {
    if (!selection.candidates.includes(choice.objectId)) {
      return 'card was not offered for this selection'
    }
    if (!allowed.has(choice.objectId)) {
      return 'card is no longer a valid choice'
    }
    if (!destinations.has(choice.destination)) {
      return `invalid destination ${choice.destination}`
    }
    if (seen.has(choice.objectId)) {
      return 'each card may only be assigned once'
    }
    seen.add(choice.objectId)
  }
  if (selection.handQuota !== undefined) {
    const toHand = choices.filter(({ destination }) => destination === 'hand').length
    const required = Math.min(selection.handQuota, expected)
    if (toHand !== required) return `must put exactly ${required} card(s) into hand`
  }
}

const applyTopDeckChoices = (
  draft: Draft,
  seat: PlayerId,
  choices: CardSelectionChoice[],
  kind: 'scry' | 'surveil',
) => {
  for (const choice of choices.filter(({ destination }) => destination === 'top').toReversed()) {
    draft.enqueue({
      type: 'move',
      objectId: choice.objectId,
      to: 'library',
      position: 'top',
    })
  }
  for (const choice of choices.filter(({ destination }) => destination === 'hand')) {
    draft.enqueue({ type: 'move', objectId: choice.objectId, to: 'hand' })
  }
  if (kind === 'scry') {
    for (const choice of choices.filter(({ destination }) => destination === 'bottom')) {
      draft.enqueue({
        type: 'move',
        objectId: choice.objectId,
        to: 'library',
        position: 'bottom',
      })
    }
  } else {
    for (const choice of choices.filter(({ destination }) => destination === 'graveyard')) {
      draft.enqueue({ type: 'move', objectId: choice.objectId, to: 'graveyard' })
    }
  }
}

const applySelectCards = (draft: Draft, event: GameEvent) => {
  if (event.type !== 'selectCards') return

  const selection = pendingSelectionFor(draft, event.seat)
  if (!selection || selection.kind !== event.kind) return

  const fromSeat = selection.fromSeat ?? selection.seat
  const after = selection.after
  const resume = selection.resume
  const canonicalChoice = selection.canonicalChoice
  clearPendingSelection(draft, event.seat)
  const next = pendingSelection(draft)
  if (next) draft.priority = next.seat

  if (selection.triggerOrder) {
    const ids = event.objectIds ?? []
    if (draft.triggerPlacement) {
      draft.triggerPlacement = {
        ...draft.triggerPlacement,
        controller: event.seat,
        orderIds: [...ids],
      }
    }
    draft.priority = null
    return
  }

  if (canonicalChoice && draft.resolution?.kind === 'canonicalSpell'
    && draft.resolution.stackId === canonicalChoice.stackId) {
    draft.resolution.choices = {
      ...draft.resolution.choices,
      [canonicalChoice.binding]: (event.objectIds ?? []).flatMap((objectId) => {
        const object = draft.objects[objectId]
        return object ? [{ kind: 'object' as const, objectId, incarnation: object.incarnation, zone: object.zone }] : []
      }),
    }
    draft.priority = null
    return
  }

  if (selection.kind === 'discard') {
    const discarded = event.objectIds ?? []
    for (const objectId of discarded) {
      draft.enqueue({ type: 'discard', seat: fromSeat, objectId })
    }
    const name = draft.objects[discarded[0] ?? '']?.name ?? 'a card'
    draft.note(
      selection.source
        ? `${event.seat} discards ${name} to ${selection.source}`
        : `${event.seat} discards ${name}`,
    )
    if (selection.reflexive && discarded.length > 0 && selection.sourceId) {
      const source = draft.object(selection.sourceId)
      if (source) {
        registerDelayedTrigger(
          draft,
          source,
          { kind: 'event', type: 'discard' },
          selection.reflexive.do,
          { payload: { targetFilter: selection.reflexive.filter } },
        )
      }
    }
  } else if (selection.kind === 'reveal') {
    const objectIds = event.objectIds ?? []
    const source = selection.sourceId ? draft.object(selection.sourceId) : undefined
    if (objectIds.length > 0) {
      draft.enqueue({
        type: 'reveal',
        seat: event.seat,
        objectIds,
        source: selection.source,
      })
    } else if (source?.zone === 'battlefield') {
      source.tapped = true
      draft.note(`${source.name} enters tapped`)
    }
  } else if (selection.kind === 'sacrifice') {
    for (const objectId of event.objectIds ?? []) {
      draft.enqueue({ type: 'sacrifice', objectId })
    }
    const name = draft.objects[event.objectIds?.[0] ?? '']?.name ?? 'a creature'
    draft.note(
      selection.source
        ? `${event.seat} sacrifices ${name} to ${selection.source}`
        : `${event.seat} sacrifices ${name}`,
    )
  } else if (selection.kind === 'choose') {
    const chosenIds = event.objectIds ?? []
    if (selection.linkExile && selection.sourceId) {
      const source = draft.object(selection.sourceId)
      if (source) linkExileSelected(draft, source, chosenIds)
    }
    if (selection.exileUntilOpponentMonarch && selection.sourceId) {
      const source = draft.object(selection.sourceId)
      if (source) linkMonarchExileSelected(draft, source, chosenIds)
    }
    if (chosenIds.length > 0) {
      if (selection.payMana) {
        draft.enqueue({ type: 'payMana', seat: event.seat, cost: selection.payMana })
      }
      if (selection.payLife) {
        draft.enqueue({
          type: 'payLife',
          seat: event.seat,
          amount: selection.payLife,
          source: selection.source,
        })
      }
    }
    for (const objectId of chosenIds) {
      const object = draft.object(objectId)
      if (!object) continue
      if (selection.addSubtypes) {
        object.subtypes = [...new Set([...object.subtypes, ...selection.addSubtypes])]
      }
      if (selection.moveSelectedTo && !selection.linkExile) {
        draft.enqueue({
          type: 'move',
          objectId,
          to: selection.moveSelectedTo,
          ...(selection.moveLibraryPosition
            ? { position: selection.moveLibraryPosition }
            : {}),
          ...(selection.moveSelectedController
            ? { controller: selection.moveSelectedController }
            : {}),
        })
        if (selection.tapSelected) {
          draft.enqueue({ type: 'tap', objectId })
        }
      }
      if (selection.untapSelected) {
        draft.enqueue({ type: 'untap', objectId })
      }
      if (selection.plusCounters) {
        addPlusCounters(object, selection.plusCounters)
      }
      if (selection.grantKeywordsUntilEot) {
        for (const keyword of selection.grantKeywordsUntilEot) {
          grantOracleLineUntilEndOfTurn(object, keyword)
        }
      }
    }
    if (selection.castWithoutPaying) {
      const objectId = event.objectIds?.[0]
      const stolen = objectId ? draft.object(objectId) : undefined
      if (stolen) {
        stolen.controller = event.seat
        draft.players[event.seat].data[PENDING_STEAL_CAST] = {
          objectId: stolen.id,
          seat: event.seat,
        }
        draft.enqueue({
          type: 'castSpell',
          seat: event.seat,
          objectId: stolen.id,
          withoutPayingMana: true,
        })
      }
    }
  }

  if (
    (selection.kind === 'choose' || selection.kind === 'sacrifice')
    && (selection.triggerAbilityId || selection.triggerInstructions)
    && selection.sourceId
  ) {
    const source = selection.triggerExecution?.source.snapshot ?? draft.object(selection.sourceId)
    // A target choice names every chosen target; a sacrifice names only its first card.
    const targetIds = selection.kind === 'choose'
      ? event.objectIds ?? []
      : (event.objectIds ?? []).slice(0, 1)
    const targets = targetIds.map((objectId) => ({
      kind: 'object' as const,
      ...(selection.targetIdentities?.[objectId] ?? { objectId }),
    }))
    const sacrificeCount = selection.kind === 'sacrifice'
      ? (event.objectIds?.length ?? 0)
      : undefined
    if (source && (targetIds.length > 0 || sacrificeCount !== undefined)) {
      const payload = {
        ...selection.triggerPayload,
        ...(sacrificeCount !== undefined ? { sacrificedCount: sacrificeCount } : {}),
      }
      if (selection.triggerPayload?.devour && selection.triggerInstructions) {
        runInstructions(draft, source, selection.triggerInstructions, {
          id: 'devour-follow-up',
          kind: 'ability',
          objectId: source.id,
          controller: source.controller,
          name: source.name,
          targets,
          payload,
          ...(selection.triggerExecution ? { execution: selection.triggerExecution } : {}),
        })
      } else {
        draft.addTriggeredAbility(source, selection.triggerInstructions ?? [], {
          ...(selection.triggerAbilityId
            ? { abilityId: selection.triggerAbilityId }
            : {}),
          ...(selection.triggerX !== undefined ? { x: selection.triggerX } : {}),
          targets,
          payload,
          ...(selection.triggerExecution ? { execution: selection.triggerExecution } : {}),
        })
      }
      draft.passedInRow = []
      draft.priority = draft.active
    }
  }

  if (selection.canonicalTrigger && selection.sourceId) {
    const selectedTargets = [
      ...(selection.canonicalTrigger.selectedTargets ?? []),
      ...(event.objectIds ?? []).map((objectId) => ({
        kind: 'object' as const,
        ...(selection.targetIdentities?.[objectId] ?? { objectId }),
      })),
    ]
    const targetClauses = selection.canonicalTrigger.targetClauses ?? [{
      min: event.objectIds?.length ?? 0,
      max: event.objectIds?.length ?? 0,
    }]
    continueCanonicalTargetSelection(draft, {
      definitionSnapshot: selection.canonicalTrigger.definitionSnapshot,
      abilityIndex: selection.canonicalTrigger.abilityIndex,
      execution: selection.canonicalTrigger.execution,
      source: selection.canonicalTrigger.execution.source.snapshot,
      sourceId: selection.sourceId,
      targetClauses: selection.canonicalTrigger.targetClauseDefinitions ?? [],
      targets: selectedTargets,
      selectedModes: selection.canonicalTrigger.selectedModes,
      clauseBounds: targetClauses,
      clauseIndex: (selection.canonicalTrigger.targetIndex ?? 0) + 1,
    })
    return
  }

  if (selection.kind === 'scry' || selection.kind === 'surveil') {
    const choices = parseChoices(event)
    if (!choices) return
    applyTopDeckChoices(draft, event.seat, choices, selection.kind)
    // The log reaches every seat, so name only the cards that become public.
    const binned = choices
      .filter(({ destination }) => destination === 'graveyard')
      .map((choice) => draft.objects[choice.objectId]?.name ?? 'a card')
      .join(', ')
    draft.note(
      `${event.seat} ${selection.kind === 'scry' ? 'looks at' : 'surveils'} ${choices.length} card(s)${
        selection.source ? ` for ${selection.source}` : ''
      }${binned ? `, putting ${binned} into the graveyard` : ''}`,
    )
  } else if (selection.kind === 'partition') {
    const choices = parseChoices(event)
    if (!choices || !selection.pileController) return
    const faceUp = choices
      .filter(({ destination }) => destination === 'face-up')
      .map(({ objectId }) => objectId)
    const faceDown = choices
      .filter(({ destination }) => destination === 'face-down')
      .map(({ objectId }) => objectId)
    if (selection.pileVisibility === 'public') {
      markKnownToAll(draft, [...faceUp, ...faceDown])
    } else {
      markKnownToAll(draft, faceUp)
    }
    const controller = selection.pileController
    const source = selection.source ?? 'the spell'
    const named = (ids: string[]) => ids
      .map((objectId) => draft.objects[objectId]?.name ?? 'a card')
      .join(', ')
      || 'no cards'
    draft.note(
      selection.pileVisibility === 'public'
        ? `${event.seat} made two piles for ${source}: ${named(faceUp)} and ${named(faceDown)}`
        : `${event.seat} made a face-up pile (${named(faceUp)}) and a face-down pile for ${source}`,
    )
    openCardSelection(draft, {
      seat: controller,
      kind: 'choosePile',
      count: 1,
      min: 0,
      candidates: [...faceUp, ...faceDown],
      sourceId: selection.sourceId,
      source: selection.source,
      prompt: 'Put one pile into your hand and the other into your graveyard.',
      destinations: ['hand'],
      fromSeat: controller,
      fromZone: 'library',
      piles: { 'face-up': faceUp, 'face-down': faceDown },
      pileController: controller,
      pileReveal: selection.pileReveal,
      pileVisibility: selection.pileVisibility,
    })
  } else if (selection.kind === 'choosePile') {
    const taken = event.objectIds ?? []
    const piles = selection.piles
    if (!piles) return
    const faceUp = piles['face-up']
    const faceDown = piles['face-down']
    const toHand = sameIdSet(taken, faceUp) ? faceUp : faceDown
    const toYard = toHand === faceUp ? faceDown : faceUp
    for (const objectId of toHand) {
      draft.enqueue({ type: 'move', objectId, to: 'hand' })
    }
    for (const objectId of toYard) {
      draft.enqueue({ type: 'move', objectId, to: 'graveyard' })
    }
    const named = (ids: string[]) => ids
      .map((objectId) => draft.objects[objectId]?.name ?? 'a card')
      .join(', ')
      || 'no cards'
    const hideFaceDown = selection.pileVisibility === 'facedown-faceup'
    const handPublic = hideFaceDown && sameIdSet(toHand, faceDown)
      ? `${toHand.length} face-down card${toHand.length === 1 ? '' : 's'}`
      : named(toHand)
    draft.note(
      selection.source
        ? `${event.seat} put ${handPublic} into hand for ${selection.source}`
        : `${event.seat} put ${handPublic} into hand`,
    )
  }

  const chosenIds = event.objectIds ?? []
  if (chosenIds.length > 0 && selection.ifYouDo) {
    for (const objectId of selection.ifYouDo.objectIds) {
      const object = draft.object(objectId)
      if (!object) continue
      if (selection.ifYouDo.to === 'battlefield' && object.zone !== 'graveyard') continue
      if (selection.ifYouDo.to === 'exile' && object.zone !== 'battlefield') continue
      draft.enqueue({
        type: 'move',
        objectId,
        to: selection.ifYouDo.to,
        ...(selection.ifYouDo.controller
          ? { controller: selection.ifYouDo.controller }
          : {}),
      })
      if (selection.ifYouDo.tapped) {
        draft.enqueue({ type: 'tap', objectId })
      }
    }
  }

  if (selection.drawPerSelected) {
    draft.enqueue({
      type: 'draw',
      seat: selection.seat,
      count: chosenIds.length * selection.drawPerSelected,
    })
  }

  for (const followUp of after ?? []) {
    if (followUp === 'resolveTop') draft.enqueue({ type: 'resolveTop' })
    if (followUp === 'shuffleLibrary') {
      draft.enqueue({ type: 'shuffleLibrary', seat: selection.fromSeat ?? selection.seat })
    }
  }

  if (resume) {
    draft.enqueue({
      type: 'custom',
      name: INSTRUCTIONS_RESUME,
      payload: {
        sourceId: resume.sourceId,
        remaining: resume.remaining,
        ...(resume.item ? { item: resume.item } : {}),
      },
    })
  }
}

/**
 * Builtin game rule for server-authoritative card selection (discard, scry, surveil).
 */
export const selectCards: Plugin = {
  id: 'selectCards',
  legal: ({ state, event }) => {
    if (event.type === 'passPriority') {
      const selection = pendingSelection(state)
      if (selection) {
        return `${selection.seat} is choosing cards${selection.source ? ` for ${selection.source}` : ''}`
      }
      return
    }
    return legalSelectCards(state, event)
  },
  apply: ({ event, draft }) => {
    applySelectCards(draft, event)
  },
}
