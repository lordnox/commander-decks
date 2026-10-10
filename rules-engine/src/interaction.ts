import {
  validateInteractionAnswer,
  type InteractionAnswer,
  type InteractionRequest,
} from '../../shared/interaction'

export type StoredInteraction<TContinuation = unknown, TResult = unknown> = {
  request: InteractionRequest
  continuation: TContinuation
  status: 'open' | 'reserved' | 'consumed' | 'cancelled' | 'invalidated'
  answerFingerprint?: string
  result?: TResult
}

export type InteractionAnswerResult<TContinuation, TResult> =
  | { kind: 'accepted'; continuation: TContinuation }
  | { kind: 'duplicate'; result?: TResult }
  | { kind: 'invalid'; error: string }

const clone = <T>(value: T): T => structuredClone(value)

/**
 * Server-side request ledger. Continuations are immutable data; clients submit
 * only request metadata and typed selections. The serialized records are safe
 * to persist and restore on reconnect or process restart.
 */
export class InteractionStore<TContinuation = unknown, TResult = unknown> {
  private readonly records = new Map<string, StoredInteraction<TContinuation, TResult>>()

  open(request: InteractionRequest, continuation: TContinuation) {
    const existing = this.records.get(request.requestId)
    if (existing) {
      if (
        JSON.stringify(existing.request) !== JSON.stringify(request)
        || JSON.stringify(existing.continuation) !== JSON.stringify(continuation)
      ) throw new Error('interaction request ID is already bound to different immutable data')
      return clone(existing.request)
    }
    this.records.set(request.requestId, {
      request: clone(request),
      continuation: clone(continuation),
      status: 'open',
    })
    return clone(request)
  }

  request(requestId: string) {
    const record = this.records.get(requestId)
    return record ? clone(record.request) : undefined
  }

  record(requestId: string) {
    const record = this.records.get(requestId)
    return record ? clone(record) : undefined
  }

  continuation(requestId: string) {
    const record = this.records.get(requestId)
    return record && record.status === 'open' ? clone(record.continuation) : undefined
  }

  answer(answer: InteractionAnswer): InteractionAnswerResult<TContinuation, TResult> {
    const record = this.records.get(answer.requestId)
    if (!record) return { kind: 'invalid', error: 'unknown interaction request' }
    if (record.status === 'reserved' || record.status === 'consumed') {
      if (answer.revision !== record.request.revision) return { kind: 'invalid', error: 'stale interaction revision' }
      if (answer.chooser !== record.request.chooser) return { kind: 'invalid', error: 'wrong interaction seat' }
      const checked = validateInteractionAnswer(record.request, answer)
      if (!checked.ok) return { kind: 'invalid', error: checked.error }
      const fingerprint = JSON.stringify(answer)
      return fingerprint === record.answerFingerprint
        ? { kind: 'duplicate', ...(record.result === undefined ? {} : { result: clone(record.result) }) }
        : { kind: 'invalid', error: 'interaction was already answered with a different selection' }
    }
    if (record.status !== 'open') return { kind: 'invalid', error: 'interaction request is no longer open' }
    const checked = validateInteractionAnswer(record.request, answer)
    if (!checked.ok) return { kind: 'invalid', error: checked.error }
    record.status = answer.cancel ? 'cancelled' : 'reserved'
    record.answerFingerprint = JSON.stringify(answer)
    return { kind: 'accepted', continuation: clone(record.continuation) }
  }

  complete(requestId: string, result: TResult) {
    const record = this.records.get(requestId)
    if (!record || record.status !== 'reserved') throw new Error('interaction is not awaiting completion')
    record.status = 'consumed'
    record.result = clone(result)
  }

  /** Roll back a reservation when the authoritative kernel transaction rejects. */
  reject(requestId: string) {
    const record = this.records.get(requestId)
    if (!record || record.status !== 'reserved') return false
    record.status = 'open'
    delete record.answerFingerprint
    return true
  }

  invalidateForChooser(chooser: string) {
    for (const record of this.records.values()) {
      if (record.request.chooser === chooser && (record.status === 'open' || record.status === 'reserved')) record.status = 'invalidated'
    }
  }

  cancel(requestId: string) {
    const record = this.records.get(requestId)
    if (!record) return false
    if (record.status !== 'open' || record.request.cancellation !== 'cancelProposal') return false
    record.status = 'cancelled'
    return true
  }

  snapshot(): StoredInteraction<TContinuation, TResult>[] {
    return [...this.records.values()].map(clone)
  }

  restore(records: readonly StoredInteraction<TContinuation, TResult>[]) {
    this.records.clear()
    for (const record of records) this.records.set(record.request.requestId, clone(record))
  }
}
