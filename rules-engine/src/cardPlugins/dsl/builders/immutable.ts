import { inspectJsonData } from '../compiler/data'

const cloneAndFreeze = (value: unknown): unknown => {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreeze))
  if (value !== null && typeof value === 'object') {
    const clone: Record<string, unknown> = {}
    const descriptors = Object.getOwnPropertyDescriptors(value)
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if ('value' in descriptor) clone[key] = cloneAndFreeze(descriptor.value)
    }
    return Object.freeze(clone)
  }
  return value
}

export const immutableData = <Value>(value: Value): Value => {
  const diagnostics = inspectJsonData(value)
  if (diagnostics.length > 0) {
    throw new TypeError(diagnostics.map(({ path, message }) => `${path}: ${message}`).join('\n'))
  }
  return cloneAndFreeze(value) as Value
}
