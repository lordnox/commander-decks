/** Public, server-owned interaction contracts shared by live and headless clients. */

export type InteractionPhase =
  | 'announcement'
  | 'triggerPlacement'
  | 'resolution'
  | 'replacement'

export type InteractionPurpose =
  | 'target'
  | 'choice'
  | 'cost'
  | 'order'
  | 'replacement'
  | 'optional'

export type InteractionCancellation = 'cancelProposal' | 'mustAnswer'

export type PublicSourceLabel = {
  name: string
  objectId?: string
  abilityId?: string
}

export type VisibleObjectRef = {
  id: string
  incarnation?: number
  zone?: string
  name?: string
  controller?: string
}

export type TargetCandidate =
  | { kind: 'player'; id: string; name?: string; controller?: string; zone?: string }
  | { kind: 'object'; ref: VisibleObjectRef }
  | { kind: 'stackItem'; id: string; name?: string; controller?: string; zone?: string }

export type TargetClauseOffer = {
  scopeId: string
  clauseIndex: number
  candidates: TargetCandidate[]
  min: number
  max: number
  distinct: boolean
}

export type TargetConstraintOffer =
  | { kind: 'different'; clauses: number[] }
  | { kind: 'sameController'; clauses: number[] }
  | { kind: 'differentZone'; clauses: number[] }

export type OptionOffer = { id: string; label: string }
export type PublicEntryRef = { id: string; label?: string }
export type AllocationEntry = { id: string; label?: string; max?: number }

export type SelectionOffer =
  | {
      kind: 'selectCards'
      candidates: VisibleObjectRef[]
      min: number
      max: number
      distinct: boolean
    }
  | {
      kind: 'selectPlayers'
      candidates: string[]
      min: number
      max: number
      distinct: boolean
    }
  | {
      kind: 'selectTargets'
      clauses: TargetClauseOffer[]
      constraints: TargetConstraintOffer[]
    }
  | { kind: 'selectOptions'; options: OptionOffer[]; min: number; max: number; distinct: boolean }
  | { kind: 'order'; entries: PublicEntryRef[]; distinct: boolean }
  | { kind: 'allocate'; entries: AllocationEntry[]; total: number; minEach: number }

export type InteractionRequest = {
  requestId: string
  revision: number
  chooser: string
  source: PublicSourceLabel
  phase: InteractionPhase
  purpose: InteractionPurpose
  cancellation: InteractionCancellation
  selection: SelectionOffer
}

export type InteractionSelection =
  | { kind: 'selectCards'; ids: string[] }
  | { kind: 'selectPlayers'; ids: string[] }
  | { kind: 'selectTargets'; clauses: Array<{ scopeId: string; clauseIndex: number; targets: TargetCandidate[] }> }
  | { kind: 'selectOptions'; ids: string[] }
  | { kind: 'order'; ids: string[] }
  | { kind: 'allocate'; values: Array<{ id: string; amount: number }> }

export type InteractionAnswer = {
  requestId: string
  revision: number
  chooser: string
  selection?: InteractionSelection
  cancel?: boolean
}

export type DriverOutcome<TResult = unknown> =
  | { kind: 'needsInput'; request: InteractionRequest }
  | { kind: 'priority'; holder: string; actions: unknown[] }
  | { kind: 'ended'; result: TResult }

export type InteractionValidation = { ok: true } | { ok: false; error: string }

const unique = (values: readonly string[]) => new Set(values).size === values.length

const candidateKeys = (candidate: TargetCandidate) => {
  switch (candidate.kind) {
    case 'player': return `player:${candidate.id}:${candidate.zone ?? ''}`
    case 'object': return `object:${candidate.ref.id}:${candidate.ref.incarnation ?? ''}:${candidate.ref.zone ?? ''}`
    case 'stackItem': return `stack:${candidate.id}:${candidate.zone ?? ''}`
  }
}

const candidateController = (candidate: TargetCandidate) => {
  if (candidate.kind === 'object') return candidate.ref.controller
  return candidate.controller ?? (candidate.kind === 'player' ? candidate.id : undefined)
}

const candidateZone = (candidate: TargetCandidate) =>
  candidate.kind === 'object' ? candidate.ref.zone : candidate.zone

const validateBounds = (count: number, min: number, max: number, distinct: boolean, values: readonly string[]) =>
  Number.isSafeInteger(min)
  && Number.isSafeInteger(max)
  && min >= 0
  && max >= min
  && count >= min
  && count <= max
  && (!distinct || unique(values))

export const validateInteractionAnswer = (
  request: InteractionRequest,
  answer: InteractionAnswer,
): InteractionValidation => {
  if (answer.requestId !== request.requestId) return { ok: false, error: 'stale interaction request' }
  if (answer.revision !== request.revision) return { ok: false, error: 'stale interaction revision' }
  if (answer.chooser !== request.chooser) return { ok: false, error: 'wrong interaction seat' }
  if (answer.cancel) {
    return request.cancellation === 'cancelProposal'
      ? { ok: true }
      : { ok: false, error: 'mandatory interaction cannot be cancelled' }
  }
  if (!answer.selection) return { ok: false, error: 'interaction answer is missing its selection' }
  const selection = answer.selection
  if (selection.kind !== request.selection.kind) return { ok: false, error: 'interaction kind does not match its offer' }
  switch (selection.kind) {
    case 'selectCards': {
      if (request.selection.kind !== 'selectCards') return { ok: false, error: 'card offer mismatch' }
      const allowed = new Set(request.selection.candidates.map((candidate) => candidate.id))
      if (!selection.ids.every((id) => allowed.has(id))) return { ok: false, error: 'card was not offered' }
      return validateBounds(selection.ids.length, request.selection.min, request.selection.max, request.selection.distinct, selection.ids)
        ? { ok: true }
        : { ok: false, error: 'invalid card selection' }
    }
    case 'selectPlayers': {
      if (request.selection.kind !== 'selectPlayers') return { ok: false, error: 'player offer mismatch' }
      if (!selection.ids.every((id) => request.selection.candidates.includes(id))) return { ok: false, error: 'player was not offered' }
      return validateBounds(selection.ids.length, request.selection.min, request.selection.max, request.selection.distinct, selection.ids)
        ? { ok: true }
        : { ok: false, error: 'invalid player selection' }
    }
    case 'selectTargets': {
      if (request.selection.kind !== 'selectTargets') return { ok: false, error: 'target offer mismatch' }
      if (selection.clauses.length !== request.selection.clauses.length) return { ok: false, error: 'every target clause must be answered' }
      const clauses = new Map(request.selection.clauses.map((clause) => [clause.clauseIndex, clause]))
      const seenClauses = new Set<number>()
      const selectedByClause = new Map<number, TargetCandidate[]>()
      for (const selected of selection.clauses) {
        const clause = clauses.get(selected.clauseIndex)
        if (!clause) return { ok: false, error: 'target clause was not offered' }
        if (seenClauses.has(selected.clauseIndex) || selected.scopeId !== clause.scopeId) return { ok: false, error: 'target clause was duplicated or used in the wrong scope' }
        seenClauses.add(selected.clauseIndex)
        const allowed = new Set(clause.candidates.map(candidateKeys))
        const keys = selected.targets.map(candidateKeys)
        if (!keys.every((key) => allowed.has(key))) return { ok: false, error: 'target was not offered' }
        if (!validateBounds(keys.length, clause.min, clause.max, clause.distinct, keys)) return { ok: false, error: 'invalid target selection' }
        selectedByClause.set(selected.clauseIndex, selected.targets)
      }
      if (seenClauses.size !== clauses.size) return { ok: false, error: 'every target clause must be answered exactly once' }
      for (const constraint of request.selection.constraints) {
        const groups = constraint.clauses.map((clauseIndex) => selectedByClause.get(clauseIndex) ?? [])
        if (constraint.kind === 'different') {
          const keys = groups.flat().map(candidateKeys)
          if (!unique(keys)) return { ok: false, error: 'different target constraint was violated' }
        } else if (constraint.kind === 'sameController') {
          const controllers = groups.flat().map(candidateController)
          if (controllers.some((controller) => controller === undefined) || !controllers.every((controller) => controller === controllers[0])) return { ok: false, error: 'same-controller target constraint was violated' }
        } else {
          const zones = groups.flat().map(candidateZone)
          if (zones.some((zone) => zone === undefined) || new Set(zones).size !== zones.length) return { ok: false, error: 'different-zone target constraint was violated' }
        }
      }
      return { ok: true }
    }
    case 'selectOptions': {
      if (request.selection.kind !== 'selectOptions') return { ok: false, error: 'option offer mismatch' }
      if (!selection.ids.every((id) => request.selection.options.some((option) => option.id === id))) return { ok: false, error: 'option was not offered' }
      return validateBounds(selection.ids.length, request.selection.min, request.selection.max, request.selection.distinct, selection.ids)
        ? { ok: true }
        : { ok: false, error: 'invalid option selection' }
    }
    case 'order': {
      if (request.selection.kind !== 'order') return { ok: false, error: 'order offer mismatch' }
      const offered = request.selection.entries.map((entry) => entry.id)
      return selection.ids.length === offered.length
        && unique(selection.ids)
        && selection.ids.every((id) => offered.includes(id))
        ? { ok: true }
        : { ok: false, error: 'order must contain every offered entry exactly once' }
    }
    case 'allocate': {
      if (request.selection.kind !== 'allocate') return { ok: false, error: 'allocation offer mismatch' }
      const offered = new Map(request.selection.entries.map((entry) => [entry.id, entry]))
      const seen = new Set<string>()
      let total = 0
      for (const value of selection.values) {
        const entry = offered.get(value.id)
        if (!entry || seen.has(value.id) || !Number.isSafeInteger(value.amount) || value.amount < request.selection.minEach || (entry.max !== undefined && value.amount > entry.max)) {
          return { ok: false, error: 'invalid allocation' }
        }
        seen.add(value.id)
        total += value.amount
      }
      return seen.size === offered.size && total === request.selection.total
        ? { ok: true }
        : { ok: false, error: 'allocation must include every offered entry and match its total' }
    }
  }
}
