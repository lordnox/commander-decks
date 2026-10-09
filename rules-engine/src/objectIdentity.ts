import type {
  CapturedObject,
  GameObject,
  GameState,
  ObjectIdentity,
  ObjectSnapshot,
  ObjectTargetRef,
  TargetRef,
} from './types'

export const objectIdentity = (object: GameObject): ObjectIdentity => ({
  objectId: object.id,
  incarnation: object.incarnation,
  zone: object.zone,
})

export const snapshotObject = (object: GameObject): ObjectSnapshot =>
  structuredClone(object)

export const captureObject = (
  object: GameObject,
  information: CapturedObject['information'] = 'current',
): CapturedObject => ({
  ref: objectIdentity(object),
  snapshot: snapshotObject(object),
  information,
})

export const isSameObject = (
  object: GameObject | undefined,
  ref: Pick<ObjectIdentity, 'objectId' | 'incarnation' | 'zone'>,
) => Boolean(
  object
  && object.id === ref.objectId
  && object.incarnation === ref.incarnation
  && object.zone === ref.zone,
)

/** Object-ID input targets are pinned once, when their stack item is created. */
export const pinTarget = (state: Pick<GameState, 'objects'>, target: TargetRef): TargetRef => {
  if (target.kind === 'player') return structuredClone(target)
  if ((target.incarnation === undefined) !== (target.zone === undefined)) {
    throw new Error(`object target ${target.objectId} has a partial identity pin`)
  }
  if (target.incarnation !== undefined && target.zone !== undefined) {
    return structuredClone(target)
  }
  const object = state.objects[target.objectId]
  return object
    ? { kind: 'object', ...objectIdentity(object) }
    : structuredClone(target)
}

export const targetObject = (
  state: { objects: Record<string, GameObject | undefined> },
  target: ObjectTargetRef,
): GameObject | undefined => {
  const object = state.objects[target.objectId]
  if (!object) return undefined
  if ((target.incarnation === undefined) !== (target.zone === undefined)) return undefined
  if (target.incarnation !== undefined && target.incarnation !== object.incarnation) return undefined
  if (target.zone !== undefined && target.zone !== object.zone) return undefined
  return object
}

const capturedObject = (value: unknown): value is CapturedObject => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CapturedObject>
  return Boolean(candidate.ref && candidate.snapshot && candidate.information)
}

const refreshCapturedSource = (value: unknown, before: GameObject) => {
  if (capturedObject(value) && isSameObject(before, value.ref)) {
    value.snapshot = snapshotObject(before)
    value.information = 'lastKnown'
  }
}

const refreshExecutionSource = (value: unknown, before: GameObject) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const execution = value as Record<string, unknown>
  refreshCapturedSource(execution.source, before)
}

/** Refresh execution source LKI without rewriting historical occurrence snapshots. */
export const refreshLastKnownSource = (value: unknown, before: GameObject) => {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const entry of value) refreshLastKnownSource(entry, before)
    return
  }

  const record = value as Record<string, unknown>
  if (record.kind === 'canonicalSpell') {
    refreshCapturedSource(record.source, before)
  }
  if (record.kind === 'legacy') {
    const item = record.item
    if (item && typeof item === 'object') {
      refreshExecutionSource((item as Record<string, unknown>).execution, before)
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === 'occurrence' || key === 'source' || key === 'snapshot') continue
    if (key === 'execution' || key === 'triggerExecution') {
      refreshExecutionSource(child, before)
      continue
    }
    refreshLastKnownSource(child, before)
  }
}
