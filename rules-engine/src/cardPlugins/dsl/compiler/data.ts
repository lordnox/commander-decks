import type { RuleDslDiagnostic } from './errors'

const joinPath = (path: string, key: string | number): string =>
  typeof key === 'number' ? `${path}[${key}]` : `${path}.${key}`

/** Inspect descriptors before reading values so hostile authored accessors never run. */
export const inspectJsonData = (root: unknown): RuleDslDiagnostic[] => {
  const diagnostics: RuleDslDiagnostic[] = []
  const ancestors = new WeakSet<object>()
  let visitedNodes = 0
  const maximumDepth = 64
  const maximumNodes = 20_000

  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > maximumDepth) {
      diagnostics.push({ path, code: 'data-depth-limit', message: `definition data is limited to depth ${maximumDepth}` })
      return
    }
    visitedNodes += 1
    if (visitedNodes > maximumNodes) {
      if (visitedNodes === maximumNodes + 1) diagnostics.push({ path, code: 'data-node-limit', message: `definition data is limited to ${maximumNodes} values` })
      return
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) diagnostics.push({ path, code: 'non-json-number', message: 'numbers must be finite' })
      return
    }
    if (typeof value !== 'object') {
      diagnostics.push({ path, code: 'executable-value', message: `expected JSON data, received ${typeof value}` })
      return
    }
    if (ancestors.has(value)) {
      diagnostics.push({ path, code: 'cyclic-data', message: 'cyclic values cannot be serialized' })
      return
    }
    const array = Array.isArray(value)
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null && !(array && prototype === Array.prototype)) {
      diagnostics.push({ path, code: 'non-plain-object', message: 'only plain objects and arrays are valid definition data' })
      return
    }
    const symbols = Object.getOwnPropertySymbols(value)
    if (symbols.length > 0) diagnostics.push({ path, code: 'symbol-key', message: 'symbol keys are not serializable' })
    ancestors.add(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (array) {
      if (value.length > maximumNodes) {
        diagnostics.push({ path, code: 'data-node-limit', message: `definition arrays are limited to ${maximumNodes} slots` })
        ancestors.delete(value)
        return
      }
      for (let index = 0; index < value.length; index += 1) {
        if (visitedNodes > maximumNodes) break
        const descriptor = descriptors[String(index)]
        if (!descriptor) {
          diagnostics.push({ path: joinPath(path, index), code: 'array-hole', message: 'array holes are not valid JSON data' })
          continue
        }
        if ('get' in descriptor || 'set' in descriptor) {
          diagnostics.push({ path: joinPath(path, index), code: 'accessor', message: 'accessors are authoring behavior and cannot be saved' })
        } else {
          if (!descriptor.enumerable) diagnostics.push({ path: joinPath(path, index), code: 'non-enumerable', message: 'non-enumerable values are not canonical JSON data' })
          visit(descriptor.value, joinPath(path, index), depth + 1)
        }
      }
      for (const key of Object.keys(descriptors)) {
        const numeric = /^(0|[1-9]\d*)$/.test(key) ? Number(key) : Number.NaN
        if (key !== 'length' && (!Number.isSafeInteger(numeric) || numeric < 0 || numeric >= value.length || String(numeric) !== key)) {
          diagnostics.push({ path: joinPath(path, key), code: 'array-property', message: 'arrays cannot have named properties' })
        }
      }
    } else {
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (visitedNodes > maximumNodes) break
        if ('get' in descriptor || 'set' in descriptor) {
          diagnostics.push({ path: joinPath(path, key), code: 'accessor', message: 'accessors are authoring behavior and cannot be saved' })
        } else {
          if (!descriptor.enumerable) diagnostics.push({ path: joinPath(path, key), code: 'non-enumerable', message: 'non-enumerable values are not canonical JSON data' })
          visit(descriptor.value, joinPath(path, key), depth + 1)
        }
      }
    }
    ancestors.delete(value)
  }

  visit(root, '$', 0)
  return diagnostics
}

export const cloneJsonData = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value

export const deepFreezeData = <Value>(value: Value): Value => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreezeData(child)
    Object.freeze(value)
  }
  return value
}
