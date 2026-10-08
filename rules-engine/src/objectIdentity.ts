import type {
  CapturedObject,
  GameObject,
  GameState,
  ObjectIdentity,
  ObjectSnapshot,
  ObjectTargetRef,
  StackExecutionContext,
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

const executionContext = (value: unknown): StackExecutionContext | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<StackExecutionContext>
  return candidate.source?.ref && candidate.source.snapshot && candidate.controller
    ? candidate as StackExecutionContext
    : undefined
}

/** Refresh private stack or continuation contexts with source LKI immediately before departure. */
export const refreshLastKnownSource = (value: unknown, before: GameObject): void => {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const entry of value) refreshLastKnownSource(entry, before)
    return
  }
  const record = value as Record<string, unknown>
  for (const key of ['execution', 'triggerExecution']) {
    const execution = executionContext(record[key])
    if (!execution || !isSameObject(before, execution.source.ref)) continue
    execution.source = {
      ref: execution.source.ref,
      snapshot: snapshotObject(before),
      information: 'lastKnown',
    }
  }
  for (const child of Object.values(record)) refreshLastKnownSource(child, before)
}
