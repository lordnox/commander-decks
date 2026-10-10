import type {
  CardRuleDefinitionV1,
  ContextBinding,
  DefinitionDeclaration,
  ResultField,
} from '../schema/v1'
import { RULE_DSL_SCHEMA_VERSION } from '../schema/v1'
import { definitionRevisionFor } from '../builders/revision'
import type { RuleDslDiagnostic } from './errors'
import { MAX_EXPRESSION_DEPTH, MAX_LITERAL_AMOUNT } from './evaluate'

type Data = Record<string, unknown>
type Domain = 'player' | 'object' | 'stack' | 'boolean' | 'number'
type Binding = {
  kind: 'choice' | 'result'
  domain: Domain
  fields?: ReadonlySet<ResultField>
}
type Environment = {
  context: ReadonlyMap<ContextBinding, Domain>
  targets: readonly (Domain | undefined)[]
  targetSingleton: readonly boolean[]
  variables: ReadonlySet<string>
  locals: Map<string, Binding>
  declared: Set<string>
  eventAmount: boolean
}

const MAX_TREE_DEPTH = 32
const MAX_LIST_LENGTH = 256
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/
const ZONES = new Set(['library', 'hand', 'battlefield', 'graveyard', 'exile', 'stack', 'command'])
const CONTEXT_DOMAINS = new Map<ContextBinding, Domain>([
  ['source', 'object'],
  ['controller', 'player'],
])

const isData = (value: unknown): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value)
const childPath = (path: string, key: string | number): string =>
  typeof key === 'number' ? `${path}[${key}]` : `${path}.${key}`

export const validateDefinitionV1 = (root: unknown): {
  diagnostics: RuleDslDiagnostic[]
  declarations: DefinitionDeclaration[]
} => {
  const diagnostics: RuleDslDiagnostic[] = []
  const declarations: DefinitionDeclaration[] = []
  const issue = (path: string, code: string, message: string): void => {
    diagnostics.push({ path, code, message })
  }
  const object = (value: unknown, path: string): Data | undefined => {
    if (!isData(value)) {
      issue(path, 'type', 'expected an object')
      return undefined
    }
    return value
  }
  const exactKeys = (value: Data, path: string, allowed: readonly string[], required: readonly string[] = []): void => {
    const allowedSet = new Set(allowed)
    for (const key of Object.keys(value)) if (!allowedSet.has(key)) issue(childPath(path, key), 'unknown-field', 'field is not part of Rule DSL v1')
    for (const key of required) if (!(key in value)) issue(childPath(path, key), 'missing-field', 'required field is missing')
  }
  const array = (value: unknown, path: string, options: { nonempty?: boolean } = {}): readonly unknown[] => {
    if (!Array.isArray(value)) {
      issue(path, 'type', 'expected an array')
      return []
    }
    if (options.nonempty && value.length === 0) issue(path, 'empty-list', 'list must not be empty')
    if (value.length > MAX_LIST_LENGTH) issue(path, 'list-limit', `lists are limited to ${MAX_LIST_LENGTH} entries`)
    return value
  }
  const enumeration = (value: unknown, path: string, values: ReadonlySet<string>, label: string): string | undefined => {
    if (typeof value !== 'string' || !values.has(value)) {
      issue(path, 'enum', `unsupported ${label}: ${String(value)}`)
      return undefined
    }
    return value
  }
  const integer = (
    value: unknown,
    path: string,
    options: { min?: number; max?: number } = {},
  ): number | undefined => {
    const min = options.min ?? 0
    const max = options.max ?? MAX_LITERAL_AMOUNT
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
      issue(path, 'numeric-limit', `expected a safe integer from ${min} to ${max}`)
      return undefined
    }
    return value as number
  }
  const bindingName = (value: unknown, path: string): string | undefined => {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
      issue(path, 'binding-name', 'binding names must start with a letter and contain at most 64 letters, digits, dots, underscores, or hyphens')
      return undefined
    }
    return value
  }
  const declareBinding = (env: Environment, name: string | undefined, binding: Binding, path: string): void => {
    if (!name) return
    if (env.declared.has(name)) {
      issue(path, 'duplicate-binding', `binding ${name} is already declared in this program scope`)
      return
    }
    env.declared.add(name)
    env.locals.set(name, binding)
  }
  const cloneEnv = (env: Environment): Environment => ({
    ...env,
    locals: new Map(env.locals),
    declared: new Set(env.declared),
  })
  const intersectBranches = (env: Environment, branches: readonly Environment[]): void => {
    if (branches.length === 0) return
    for (const branch of branches) for (const name of branch.declared) env.declared.add(name)
    for (const [name, binding] of branches[0].locals) {
      const present = branches.every((branch) => {
        const candidate = branch.locals.get(name)
        return candidate?.kind === binding.kind && candidate.domain === binding.domain
          && (!binding.fields || [...binding.fields].every((field) => candidate.fields?.has(field)))
      })
      if (present) env.locals.set(name, binding)
    }
  }

  const validatePlayerFilter = (value: unknown, path: string, depth = 0): void => {
    if (depth > MAX_TREE_DEPTH) {
      issue(path, 'depth-limit', `filter nesting is limited to ${MAX_TREE_DEPTH}`)
      return
    }
    const node = object(value, path)
    if (!node) return
    exactKeys(node, path, ['relation', 'all', 'any', 'not'])
    if (node.relation !== undefined) enumeration(node.relation, childPath(path, 'relation'), new Set(['you', 'opponent', 'any']), 'player relation')
    for (const key of ['all', 'any'] as const) if (node[key] !== undefined) {
      array(node[key], childPath(path, key), { nonempty: true }).forEach((part, index) =>
        validatePlayerFilter(part, childPath(childPath(path, key), index), depth + 1))
    }
    if (node.not !== undefined) validatePlayerFilter(node.not, childPath(path, 'not'), depth + 1)
  }

  const validateReference = (
    value: unknown,
    path: string,
    env: Environment,
    expected?: readonly Domain[],
  ): Domain | undefined => {
    const node = object(value, path)
    if (!node) return undefined
    const kind = node.kind
    let domain: Domain | undefined
    switch (kind) {
      case 'contextRef': {
        exactKeys(node, path, ['kind', 'name'], ['kind', 'name'])
        if (typeof node.name !== 'string') issue(childPath(path, 'name'), 'type', 'expected a context binding name')
        else {
          domain = env.context.get(node.name as ContextBinding)
          if (!domain) issue(childPath(path, 'name'), 'unresolved-binding', `${node.name} is not available in this execution context`)
        }
        break
      }
      case 'targetRef': {
        exactKeys(node, path, ['kind', 'clauseIndex'], ['kind', 'clauseIndex'])
        const index = integer(node.clauseIndex, childPath(path, 'clauseIndex'), { max: MAX_LIST_LENGTH - 1 })
        if (index !== undefined) {
          domain = env.targets[index]
          if (!domain) issue(childPath(path, 'clauseIndex'), 'target-index', `target clause ${index} is not declared in this program scope`)
        }
        break
      }
      case 'choiceRef': {
        exactKeys(node, path, ['kind', 'binding'], ['kind', 'binding'])
        const name = bindingName(node.binding, childPath(path, 'binding'))
        if (name) {
          const binding = env.locals.get(name)
          if (!binding) issue(childPath(path, 'binding'), 'unresolved-binding', `choice ${name} is not available on every control-flow path`)
          else if (binding.kind !== 'choice') issue(childPath(path, 'binding'), 'binding-kind', `${name} is a result binding, not a choice binding`)
          else domain = binding.domain
        }
        break
      }
      case 'resultRef': {
        exactKeys(node, path, ['kind', 'binding', 'field'], ['kind', 'binding', 'field'])
        const name = bindingName(node.binding, childPath(path, 'binding'))
        const field = enumeration(node.field, childPath(path, 'field'), new Set(['discarded', 'discardedCount', 'countered', 'paid']), 'result field') as ResultField | undefined
        if (name && field) {
          const binding = env.locals.get(name)
          if (binding && binding.kind !== 'result') issue(childPath(path, 'binding'), 'binding-kind', `${name} is a choice binding, not a result binding`)
          else if (!binding?.fields?.has(field)) issue(childPath(path, 'field'), 'unresolved-binding', `result ${name}.${field} is not produced on every control-flow path`)
          else domain = field === 'discardedCount' ? 'number' : 'boolean'
        }
        break
      }
      default:
        issue(childPath(path, 'kind'), 'unsupported-kind', `unsupported reference kind: ${String(kind)}`)
    }
    if (domain && expected && !expected.includes(domain)) {
      issue(path, 'domain', `expected ${expected.join(' or ')} reference, received ${domain}`)
    }
    return domain
  }

  const validateObjectFilter = (value: unknown, path: string, env: Environment, depth = 0): void => {
    if (depth > MAX_TREE_DEPTH) {
      issue(path, 'depth-limit', `filter nesting is limited to ${MAX_TREE_DEPTH}`)
      return
    }
    const node = object(value, path)
    if (!node) return
    exactKeys(node, path, ['zone', 'type', 'subtypes', 'controller', 'owner', 'token', 'name', 'all', 'any', 'not'])
    if (node.zone !== undefined) enumeration(node.zone, childPath(path, 'zone'), ZONES, 'zone')
    for (const key of ['type', 'name'] as const) if (node[key] !== undefined && typeof node[key] !== 'string') issue(childPath(path, key), 'type', 'expected a string')
    if (node.token !== undefined && typeof node.token !== 'boolean') issue(childPath(path, 'token'), 'type', 'expected a boolean')
    if (node.subtypes !== undefined) array(node.subtypes, childPath(path, 'subtypes')).forEach((part, index) => {
      if (typeof part !== 'string') issue(childPath(childPath(path, 'subtypes'), index), 'type', 'expected a string')
    })
    for (const key of ['controller', 'owner'] as const) if (node[key] !== undefined && node[key] !== 'you') {
      validateReference(node[key], childPath(path, key), env, ['player'])
    }
    for (const key of ['all', 'any'] as const) if (node[key] !== undefined) {
      array(node[key], childPath(path, key), { nonempty: true }).forEach((part, index) =>
        validateObjectFilter(part, childPath(childPath(path, key), index), env, depth + 1))
    }
    if (node.not !== undefined) validateObjectFilter(node.not, childPath(path, 'not'), env, depth + 1)
  }

  const validateStackFilter = (value: unknown, path: string, env: Environment, depth = 0): void => {
    if (depth > MAX_TREE_DEPTH) {
      issue(path, 'depth-limit', `filter nesting is limited to ${MAX_TREE_DEPTH}`)
      return
    }
    const node = object(value, path)
    if (!node) return
    exactKeys(node, path, ['kind', 'other', 'controller', 'all', 'any', 'not'])
    if (node.kind !== undefined) enumeration(node.kind, childPath(path, 'kind'), new Set(['spell', 'ability']), 'stack-item kind')
    if (node.other !== undefined && typeof node.other !== 'boolean') issue(childPath(path, 'other'), 'type', 'expected a boolean')
    if (node.controller !== undefined && node.controller !== 'you') validateReference(node.controller, childPath(path, 'controller'), env, ['player'])
    for (const key of ['all', 'any'] as const) if (node[key] !== undefined) {
      array(node[key], childPath(path, key), { nonempty: true }).forEach((part, index) =>
        validateStackFilter(part, childPath(childPath(path, key), index), env, depth + 1))
    }
    if (node.not !== undefined) validateStackFilter(node.not, childPath(path, 'not'), env, depth + 1)
  }

  const validateSelector = (value: unknown, path: string, env: Environment): Domain | undefined => {
    const node = object(value, path)
    if (!node) return undefined
    exactKeys(node, path, ['kind', 'filter'], ['kind', 'filter'])
    switch (node.kind) {
      case 'players': validatePlayerFilter(node.filter, childPath(path, 'filter')); return 'player'
      case 'objects': validateObjectFilter(node.filter, childPath(path, 'filter'), env); return 'object'
      case 'stackItems': validateStackFilter(node.filter, childPath(path, 'filter'), env); return 'stack'
      default: issue(childPath(path, 'kind'), 'unsupported-kind', `unsupported selector kind: ${String(node.kind)}`); return undefined
    }
  }

  const validateRecipient = (
    value: unknown,
    path: string,
    env: Environment,
    expected: readonly Domain[],
  ): Domain | undefined => {
    const node = object(value, path)
    if (!node) return undefined
    const domain = node.kind === 'players' || node.kind === 'objects' || node.kind === 'stackItems'
      ? validateSelector(node, path, env)
      : validateReference(node, path, env, expected)
    if (domain && !expected.includes(domain)) issue(path, 'domain', `expected ${expected.join(' or ')} recipient, received ${domain}`)
    return domain
  }

  const validateAmount = (value: unknown, path: string, env: Environment, depth = 0): void => {
    if (depth > MAX_EXPRESSION_DEPTH) {
      issue(path, 'depth-limit', `amount expressions are limited to depth ${MAX_EXPRESSION_DEPTH}`)
      return
    }
    const node = object(value, path)
    if (!node) return
    switch (node.kind) {
      case 'constant':
        exactKeys(node, path, ['kind', 'value'], ['kind', 'value'])
        integer(node.value, childPath(path, 'value'))
        return
      case 'variable':
        exactKeys(node, path, ['kind', 'name'], ['kind', 'name'])
        if (node.name !== 'X') issue(childPath(path, 'name'), 'unsupported-variable', `unsupported amount variable: ${String(node.name)}`)
        else if (!env.variables.has('X')) issue(childPath(path, 'name'), 'unresolved-binding', 'X is not declared in this program scope')
        return
      case 'eventAmount':
        exactKeys(node, path, ['kind'], ['kind'])
        if (!env.eventAmount) issue(path, 'unresolved-binding', 'eventAmount is not available in this execution context')
        return
      case 'count':
        exactKeys(node, path, ['kind', 'of'], ['kind', 'of'])
        validateSelector(node.of, childPath(path, 'of'), env)
        return
      case 'characteristic': {
        exactKeys(node, path, ['kind', 'of', 'characteristic', 'information'], ['kind', 'of', 'characteristic', 'information'])
        const domain = validateReference(node.of, childPath(path, 'of'), env)
        const characteristic = enumeration(node.characteristic, childPath(path, 'characteristic'), new Set(['power', 'toughness', 'manaValue', 'life']), 'numeric characteristic')
        enumeration(node.information, childPath(path, 'information'), new Set(['current', 'currentOrLastKnown']), 'information policy')
        if (characteristic === 'life' && domain && domain !== 'player') issue(childPath(path, 'of'), 'domain', 'life requires a player reference')
        if (characteristic && characteristic !== 'life' && domain && domain !== 'object') issue(childPath(path, 'of'), 'domain', `${characteristic} requires an object reference`)
        return
      }
      default: issue(childPath(path, 'kind'), 'unsupported-kind', `unsupported amount kind: ${String(node.kind)}`)
    }
  }

  const validateCondition = (value: unknown, path: string, env: Environment, depth = 0): void => {
    if (depth > MAX_TREE_DEPTH) {
      issue(path, 'depth-limit', `condition nesting is limited to ${MAX_TREE_DEPTH}`)
      return
    }
    const node = object(value, path)
    if (!node) return
    switch (node.kind) {
      case 'resultIsTrue':
        exactKeys(node, path, ['kind', 'value'], ['kind', 'value'])
        if (!isData(node.value) || node.value.kind !== 'resultRef') issue(childPath(path, 'value'), 'binding-kind', 'resultIsTrue requires a resultRef')
        validateReference(node.value, childPath(path, 'value'), env, ['boolean'])
        return
      case 'compareAmount':
        exactKeys(node, path, ['kind', 'left', 'operator', 'right'], ['kind', 'left', 'operator', 'right'])
        validateAmount(node.left, childPath(path, 'left'), env)
        enumeration(node.operator, childPath(path, 'operator'), new Set(['eq', 'gte', 'lte']), 'amount comparison')
        validateAmount(node.right, childPath(path, 'right'), env)
        return
      case 'all':
      case 'any':
        exactKeys(node, path, ['kind', 'conditions'], ['kind', 'conditions'])
        array(node.conditions, childPath(path, 'conditions'), { nonempty: true }).forEach((part, index) =>
          validateCondition(part, childPath(childPath(path, 'conditions'), index), env, depth + 1))
        return
      case 'not':
        exactKeys(node, path, ['kind', 'condition'], ['kind', 'condition'])
        validateCondition(node.condition, childPath(path, 'condition'), env, depth + 1)
        return
      default: issue(childPath(path, 'kind'), 'unsupported-kind', `unsupported condition kind: ${String(node.kind)}`)
    }
  }

  const validateTargetClause = (value: unknown, path: string, env: Environment): Domain | undefined => {
    const node = object(value, path)
    if (!node) return undefined
    exactKeys(node, path, ['filter', 'min', 'max', 'distinct'], ['filter', 'min', 'max', 'distinct'])
    const domain = validateSelector(node.filter, childPath(path, 'filter'), env)
    validateAmount(node.min, childPath(path, 'min'), env)
    validateAmount(node.max, childPath(path, 'max'), env)
    if (node.distinct !== true) issue(childPath(path, 'distinct'), 'constant', 'target clauses require distinct: true')
    const min = isData(node.min) && node.min.kind === 'constant' ? node.min.value : undefined
    const max = isData(node.max) && node.max.kind === 'constant' ? node.max.value : undefined
    if (typeof min === 'number' && typeof max === 'number' && min > max) issue(path, 'bounds', `target minimum ${min} exceeds maximum ${max}`)
    declarations.push({ path, kind: 'targetClause' })
    return domain
  }

  const targetClauseIsSingleton = (value: unknown): boolean => {
    if (!isData(value) || !isData(value.min) || !isData(value.max)) return false
    return value.min.kind === 'constant' && value.min.value === 1
      && value.max.kind === 'constant' && value.max.value === 1
  }

  const validateVariables = (value: unknown, path: string, env: Environment): void => {
    const seen = new Set<string>()
    array(value, path).forEach((entry, index) => {
      const entryPath = childPath(path, index)
      const node = object(entry, entryPath)
      if (!node) return
      exactKeys(node, entryPath, ['name', 'min', 'max'], ['name', 'min', 'max'])
      if (node.name !== 'X') issue(childPath(entryPath, 'name'), 'unsupported-variable', `unsupported decision variable: ${String(node.name)}`)
      else if (seen.has('X') || env.variables.has('X')) issue(childPath(entryPath, 'name'), 'duplicate-binding', 'X is declared more than once in this program scope')
      else {
        seen.add('X')
        ;(env.variables as Set<string>).add('X')
      }
      const min = integer(node.min, childPath(entryPath, 'min'))
      const max = integer(node.max, childPath(entryPath, 'max'))
      if (min !== undefined && max !== undefined && min > max) issue(entryPath, 'bounds', `variable minimum ${min} exceeds maximum ${max}`)
    })
  }

  const validateDecisions = (
    value: unknown,
    path: string,
    baseEnv: Environment,
    allowModes: boolean,
  ): { env: Environment; modeCount?: number; repeatable?: boolean } => {
    const env: Environment = {
      ...cloneEnv(baseEnv),
      variables: new Set(baseEnv.variables),
      targets: [],
      targetSingleton: [],
    }
    const node = object(value, path)
    if (!node) return { env }
    exactKeys(node, path, ['targets', 'constraints', 'modes', 'variables', 'distributions'], ['targets'])
    if (node.variables !== undefined) validateVariables(node.variables, childPath(path, 'variables'), env)
    const targetClauses = array(node.targets, childPath(path, 'targets'))
    const targetDomains: Array<Domain | undefined> = []
    const targetSingletons: boolean[] = []
    targetClauses.forEach((clause, index) => {
      targetDomains.push(validateTargetClause(clause, childPath(childPath(path, 'targets'), index), env))
      targetSingletons.push(targetClauseIsSingleton(clause))
      env.targets = targetDomains
      env.targetSingleton = targetSingletons
    })
    if (node.constraints !== undefined) array(node.constraints, childPath(path, 'constraints')).forEach((entry, index) => {
      const entryPath = childPath(childPath(path, 'constraints'), index)
      const constraint = object(entry, entryPath)
      if (!constraint) return
      exactKeys(constraint, entryPath, ['kind', 'clauseIndices'], ['kind', 'clauseIndices'])
      if (constraint.kind !== 'different') {
        issue(childPath(entryPath, 'kind'), 'unsupported-kind', `unsupported target constraint: ${String(constraint.kind)}`)
        return
      }
      const indices = array(constraint.clauseIndices, childPath(entryPath, 'clauseIndices'), { nonempty: true })
      const seen = new Set<number>()
      indices.forEach((value, clauseIndex) => {
        const parsed = integer(value, childPath(childPath(entryPath, 'clauseIndices'), clauseIndex), { max: MAX_LIST_LENGTH - 1 })
        if (parsed === undefined) return
        if (seen.has(parsed)) issue(childPath(childPath(entryPath, 'clauseIndices'), clauseIndex), 'duplicate-index', `target clause ${parsed} is repeated in this constraint`)
        seen.add(parsed)
        if (parsed >= targetClauses.length) issue(childPath(childPath(entryPath, 'clauseIndices'), clauseIndex), 'target-index', `target clause ${parsed} is not declared`)
      })
      if (seen.size < 2) issue(childPath(entryPath, 'clauseIndices'), 'constraint-bounds', 'different constraints require at least two target clauses')
    })
    let modeCount: number | undefined
    let repeatable: boolean | undefined
    if (node.modes !== undefined) {
      if (!allowModes) issue(childPath(path, 'modes'), 'modal-structure', 'nested mode decisions are not supported in Rule DSL v1')
      const modes = object(node.modes, childPath(path, 'modes'))
      if (modes) {
        exactKeys(modes, childPath(path, 'modes'), ['count', 'repeatable'], ['count', 'repeatable'])
        validateAmount(modes.count, childPath(childPath(path, 'modes'), 'count'), env)
        if (isData(modes.count) && modes.count.kind === 'constant') modeCount = integer(modes.count.value, childPath(childPath(childPath(path, 'modes'), 'count'), 'value'), { min: 1, max: MAX_LIST_LENGTH })
        else issue(childPath(childPath(path, 'modes'), 'count'), 'modal-structure', 'Rule DSL v1 mode count must be a constant amount')
        if (typeof modes.repeatable !== 'boolean') issue(childPath(childPath(path, 'modes'), 'repeatable'), 'type', 'expected a boolean')
        else repeatable = modes.repeatable
      }
    }
    if (node.distributions !== undefined) array(node.distributions, childPath(path, 'distributions')).forEach((entry, index) => {
      const entryPath = childPath(childPath(path, 'distributions'), index)
      const distribution = object(entry, entryPath)
      if (!distribution) return
      exactKeys(distribution, entryPath, ['targetClauseIndex', 'total', 'minEach'], ['targetClauseIndex', 'total', 'minEach'])
      const targetIndex = integer(distribution.targetClauseIndex, childPath(entryPath, 'targetClauseIndex'), { max: MAX_LIST_LENGTH - 1 })
      if (targetIndex !== undefined && !env.targets[targetIndex]) issue(childPath(entryPath, 'targetClauseIndex'), 'target-index', `target clause ${targetIndex} is not declared`)
      validateAmount(distribution.total, childPath(entryPath, 'total'), env)
      validateAmount(distribution.minEach, childPath(entryPath, 'minEach'), env)
    })
    return { env, modeCount, repeatable }
  }

  const validateCost = (value: unknown, path: string, env: Environment): void => {
    const node = object(value, path)
    if (!node) return
    declarations.push({ path, kind: `cost:${String(node.kind)}` })
    switch (node.kind) {
      case 'discard':
      case 'sacrifice':
        exactKeys(node, path, ['kind', 'filter', 'count'], ['kind', 'filter', 'count'])
        if (validateSelector(node.filter, childPath(path, 'filter'), env) !== 'object') issue(childPath(path, 'filter'), 'domain', `${node.kind} costs require an object selector`)
        validateAmount(node.count, childPath(path, 'count'), env)
        return
      case 'life':
        exactKeys(node, path, ['kind', 'amount'], ['kind', 'amount'])
        validateAmount(node.amount, childPath(path, 'amount'), env)
        return
      case 'mana':
        exactKeys(node, path, ['kind', 'amount'], ['kind', 'amount'])
        if (typeof node.amount !== 'string' || node.amount.length === 0 || node.amount.length > 128
          || !/^(?:\{(?:[0-9]+|[WUBRGCX])\})+$/.test(node.amount)) {
          issue(childPath(path, 'amount'), 'mana-cost', 'mana cost must contain only braced generic, W, U, B, R, G, C, or X symbols')
        } else if (node.amount.includes('{X}') && !env.variables.has('X')) {
          issue(childPath(path, 'amount'), 'unresolved-binding', 'mana cost uses X but X is not declared in this program scope')
        }
        return
      default: issue(childPath(path, 'kind'), 'unsupported-kind', `unsupported cost kind: ${String(node.kind)}`)
    }
  }

  const validateInstructionList = (value: unknown, path: string, env: Environment, depth = 0): void => {
    if (depth > MAX_TREE_DEPTH) {
      issue(path, 'depth-limit', `program nesting is limited to ${MAX_TREE_DEPTH}`)
      return
    }
    array(value, path).forEach((entry, index) => validateInstruction(entry, childPath(path, index), env, depth))
  }

  const validateInstruction = (value: unknown, path: string, env: Environment, depth: number): void => {
    const node = object(value, path)
    if (!node) return
    declarations.push({ path, kind: `instruction:${String(node.kind)}` })
    const amountInstruction = (field: 'amount' | 'count', expected: readonly Domain[]): void => {
      exactKeys(node, path, ['kind', field, 'targets'], ['kind', field, 'targets'])
      validateAmount(node[field], childPath(path, field), env)
      validateRecipient(node.targets, childPath(path, 'targets'), env, expected)
    }
    switch (node.kind) {
      case 'loseLife': amountInstruction('amount', ['player']); return
      case 'gainLife': amountInstruction('amount', ['player']); return
      case 'draw': amountInstruction('count', ['player']); return
      case 'mill': amountInstruction('count', ['player']); return
      case 'damage':
        exactKeys(node, path, ['kind', 'amount', 'targets', 'source'], ['kind', 'amount', 'targets', 'source'])
        validateAmount(node.amount, childPath(path, 'amount'), env)
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['player', 'object'])
        validateReference(node.source, childPath(path, 'source'), env, ['object'])
        return
      case 'destroy':
        exactKeys(node, path, ['kind', 'targets'], ['kind', 'targets'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['object'])
        return
      case 'counter': {
        exactKeys(node, path, ['kind', 'targets', 'bindResult'], ['kind', 'targets'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['stack'])
        if (node.bindResult !== undefined && !recipientIsProvablySingle(node.targets, env, 'stack')) {
          issue(childPath(path, 'bindResult'), 'aggregate-result', 'scalar counter results require a provably single stack-item recipient')
        }
        const name = node.bindResult === undefined ? undefined : bindingName(node.bindResult, childPath(path, 'bindResult'))
        declareBinding(env, name, { kind: 'result', domain: 'boolean', fields: new Set<ResultField>(['countered']) }, childPath(path, 'bindResult'))
        return
      }
      case 'discard': {
        const selectedCards = node.by !== undefined
        if (selectedCards && node.count !== undefined) issue(path, 'instruction-shape', 'discard cannot specify both by and count')
        if (!selectedCards && node.count === undefined) issue(path, 'instruction-shape', 'discard requires either by or count')
        exactKeys(node, path, selectedCards ? ['kind', 'targets', 'by', 'bindResult'] : ['kind', 'targets', 'count', 'bindResult'], ['kind', 'targets', selectedCards ? 'by' : 'count'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, selectedCards ? ['object'] : ['player'])
        if (selectedCards) validateReference(node.by, childPath(path, 'by'), env, ['player'])
        else validateAmount(node.count, childPath(path, 'count'), env)
        if (!selectedCards && node.bindResult !== undefined && !recipientIsProvablySinglePlayer(node.targets, env)) {
          issue(childPath(path, 'bindResult'), 'aggregate-result', 'scalar discard results require a provably single player recipient')
        }
        const name = node.bindResult === undefined ? undefined : bindingName(node.bindResult, childPath(path, 'bindResult'))
        declareBinding(env, name, { kind: 'result', domain: 'boolean', fields: new Set<ResultField>(['discarded', 'discardedCount']) }, childPath(path, 'bindResult'))
        return
      }
      case 'chooseCards': {
        exactKeys(node, path, ['kind', 'bindChoice', 'chooser', 'filter', 'min', 'max', 'distinct', 'whenInsufficient'], ['kind', 'bindChoice', 'chooser', 'filter', 'min', 'max', 'distinct', 'whenInsufficient'])
        validateReference(node.chooser, childPath(path, 'chooser'), env, ['player'])
        if (validateSelector(node.filter, childPath(path, 'filter'), env) !== 'object') issue(childPath(path, 'filter'), 'domain', 'chooseCards requires an object selector')
        validateAmount(node.min, childPath(path, 'min'), env)
        validateAmount(node.max, childPath(path, 'max'), env)
        if (node.distinct !== true) issue(childPath(path, 'distinct'), 'constant', 'chooseCards requires distinct: true')
        if (node.whenInsufficient !== 'chooseAvailable') issue(childPath(path, 'whenInsufficient'), 'unsupported-kind', 'Rule DSL v1 supports only chooseAvailable')
        const min = isData(node.min) && node.min.kind === 'constant' ? node.min.value : undefined
        const max = isData(node.max) && node.max.kind === 'constant' ? node.max.value : undefined
        if (typeof min === 'number' && typeof max === 'number' && min > max) issue(path, 'bounds', `choice minimum ${min} exceeds maximum ${max}`)
        declareBinding(env, bindingName(node.bindChoice, childPath(path, 'bindChoice')), { kind: 'choice', domain: 'object' }, childPath(path, 'bindChoice'))
        return
      }
      case 'sequence':
        exactKeys(node, path, ['kind', 'instructions'], ['kind', 'instructions'])
        validateInstructionList(node.instructions, childPath(path, 'instructions'), env, depth + 1)
        return
      case 'chooseInstructions': {
        exactKeys(node, path, ['kind', 'chooser', 'count', 'options', 'whenInsufficient'], ['kind', 'chooser', 'count', 'options', 'whenInsufficient'])
        validateReference(node.chooser, childPath(path, 'chooser'), env, ['player'])
        const choiceCount = object(node.count, childPath(path, 'count'))
        if (choiceCount) {
          exactKeys(choiceCount, childPath(path, 'count'), ['kind', 'value'], ['kind', 'value'])
          if (choiceCount.kind !== 'constant' || choiceCount.value !== 1) issue(childPath(path, 'count'), 'choice-count', 'Rule DSL v1 instruction choices select exactly one option')
        }
        if (node.whenInsufficient !== 'chooseAvailable') issue(childPath(path, 'whenInsufficient'), 'unsupported-kind', 'Rule DSL v1 supports only chooseAvailable')
        // chooseAvailable may legally execute no option, so option-produced locals
        // never become guaranteed bindings outside the choice node.
        const branches: Environment[] = [cloneEnv(env)]
        array(node.options, childPath(path, 'options'), { nonempty: true }).forEach((option, index) => {
          const optionPath = childPath(childPath(path, 'options'), index)
          const optionNode = object(option, optionPath)
          if (!optionNode) return
          exactKeys(optionNode, optionPath, ['instructions'], ['instructions'])
          const branch = cloneEnv(env)
          validateInstructionList(optionNode.instructions, childPath(optionPath, 'instructions'), branch, depth + 1)
          branches.push(branch)
        })
        intersectBranches(env, branches)
        return
      }
      case 'if': {
        exactKeys(node, path, ['kind', 'condition', 'then', 'otherwise'], ['kind', 'condition', 'then', 'otherwise'])
        validateCondition(node.condition, childPath(path, 'condition'), env)
        const whenTrue = cloneEnv(env)
        const otherwise = cloneEnv(env)
        validateInstructionList(node.then, childPath(path, 'then'), whenTrue, depth + 1)
        validateInstructionList(node.otherwise, childPath(path, 'otherwise'), otherwise, depth + 1)
        intersectBranches(env, [whenTrue, otherwise])
        return
      }
      default: issue(childPath(path, 'kind'), 'unsupported-kind', `unsupported instruction kind: ${String(node.kind)}`)
    }
  }

  const recipientIsProvablySingle = (value: unknown, env: Environment, domain: Domain): boolean => {
    if (!isData(value)) return false
    if (value.kind === 'contextRef') {
      return domain === 'player' && (value.name === 'controller' || value.name === 'triggering.player')
    }
    if (value.kind === 'targetRef' && Number.isSafeInteger(value.clauseIndex)) {
      return env.targets[value.clauseIndex as number] === domain && env.targetSingleton[value.clauseIndex as number] === true
    }
    return false
  }

  const recipientIsProvablySinglePlayer = (value: unknown, env: Environment): boolean =>
    recipientIsProvablySingle(value, env, 'player')

  const validateObjectOccurrenceFilter = (value: unknown, path: string, env: Environment, depth = 0): void => {
    if (depth > MAX_TREE_DEPTH) {
      issue(path, 'depth-limit', `occurrence-filter nesting is limited to ${MAX_TREE_DEPTH}`)
      return
    }
    const node = object(value, path)
    if (!node) return
    if (node.kind !== undefined) {
      validateReference(node, path, env, ['object'])
      return
    }
    const hasObjectFields = ['zone', 'type', 'subtypes', 'controller', 'owner', 'token', 'name'].some((key) => key in node)
    if (hasObjectFields) {
      validateObjectFilter(node, path, env, depth)
      return
    }
    exactKeys(node, path, ['all', 'any', 'not'])
    let found = false
    for (const key of ['all', 'any'] as const) if (node[key] !== undefined) {
      found = true
      array(node[key], childPath(path, key), { nonempty: true }).forEach((part, index) =>
        validateObjectOccurrenceFilter(part, childPath(childPath(path, key), index), env, depth + 1))
    }
    if (node.not !== undefined) {
      found = true
      validateObjectOccurrenceFilter(node.not, childPath(path, 'not'), env, depth + 1)
    }
    if (!found) issue(path, 'empty-filter', 'occurrence filter must contain a predicate or reference')
  }

  const validateOccurrence = (value: unknown, path: string, baseEnv: Environment): Environment => {
    const env = cloneEnv(baseEnv)
    const node = object(value, path)
    if (!node) return env
    exactKeys(node, path, ['kind', 'filter'], ['kind', 'filter'])
    declarations.push({ path, kind: `occurrence:${String(node.kind)}` })
    switch (node.kind) {
      case 'enters':
        env.context = new Map([...env.context, ['triggering.object.after', 'object']])
        validateObjectOccurrenceFilter(node.filter, childPath(path, 'filter'), env)
        return env
      case 'dies':
        env.context = new Map([...env.context, ['triggering.object.before', 'object']])
        validateObjectOccurrenceFilter(node.filter, childPath(path, 'filter'), env)
        return env
      case 'draw': {
        env.context = new Map([...env.context, ['triggering.player', 'player']])
        env.eventAmount = true
        const filter = object(node.filter, childPath(path, 'filter'))
        if (filter) {
          exactKeys(filter, childPath(path, 'filter'), ['player', 'firstDrawInOwnDrawStep'])
          if (filter.player !== undefined) validateRecipient(filter.player, childPath(childPath(path, 'filter'), 'player'), env, ['player'])
          if (filter.firstDrawInOwnDrawStep !== undefined && typeof filter.firstDrawInOwnDrawStep !== 'boolean') issue(childPath(childPath(path, 'filter'), 'firstDrawInOwnDrawStep'), 'type', 'expected a boolean')
        }
        return env
      }
      default:
        issue(childPath(path, 'kind'), 'unsupported-kind', `unsupported occurrence kind: ${String(node.kind)}`)
        return env
    }
  }

  const validateProgram = (
    ability: Data,
    path: string,
    decisionsResult: ReturnType<typeof validateDecisions>,
  ): void => {
    const hasInstructions = 'instructions' in ability
    const hasModes = 'modes' in ability
    if (hasInstructions === hasModes) {
      issue(path, 'program-shape', 'ability must contain exactly one of instructions or modes')
      return
    }
    if (hasInstructions) {
      if (decisionsResult.modeCount !== undefined) issue(childPath(path, 'decisions.modes'), 'modal-structure', 'mode decisions require a modal program')
      validateInstructionList(ability.instructions, childPath(path, 'instructions'), decisionsResult.env)
      return
    }
    if (decisionsResult.modeCount === undefined) issue(childPath(path, 'decisions.modes'), 'modal-structure', 'modal programs require decisions.modes')
    const modes = array(ability.modes, childPath(path, 'modes'), { nonempty: true })
    if (decisionsResult.modeCount !== undefined && !decisionsResult.repeatable && decisionsResult.modeCount > modes.length) {
      issue(childPath(path, 'decisions.modes.count'), 'modal-bounds', 'nonrepeatable mode count exceeds the number of modes')
    }
    modes.forEach((mode, index) => {
      const modePath = childPath(childPath(path, 'modes'), index)
      const node = object(mode, modePath)
      if (!node) return
      declarations.push({ path: modePath, kind: 'mode' })
      exactKeys(node, modePath, ['decisions', 'instructions'], ['decisions', 'instructions'])
      const modeDecisions = validateDecisions(node.decisions, childPath(modePath, 'decisions'), decisionsResult.env, false)
      validateInstructionList(node.instructions, childPath(modePath, 'instructions'), modeDecisions.env)
    })
  }

  const baseEnvironment = (): Environment => ({
    context: new Map(CONTEXT_DOMAINS),
    targets: [],
    targetSingleton: [],
    variables: new Set(),
    locals: new Map(),
    declared: new Set(),
    eventAmount: false,
  })

  const validateAbility = (value: unknown, path: string): void => {
    const ability = object(value, path)
    if (!ability) return
    declarations.push({ path, kind: `ability:${String(ability.kind)}` })
    const commonProgramKeys = ['kind', 'decisions', 'costs', 'instructions', 'modes']
    switch (ability.kind) {
      case 'spell': {
        exactKeys(ability, path, commonProgramKeys, ['kind', 'decisions', 'costs'])
        const result = validateDecisions(ability.decisions, childPath(path, 'decisions'), baseEnvironment(), true)
        const costEnv: Environment = { ...cloneEnv(result.env), targets: [], targetSingleton: [], locals: new Map() }
        array(ability.costs, childPath(path, 'costs')).forEach((cost, index) => validateCost(cost, childPath(childPath(path, 'costs'), index), costEnv))
        validateProgram(ability, path, result)
        return
      }
      case 'activated': {
        exactKeys(ability, path, [...commonProgramKeys, 'availableFrom', 'timing'], ['kind', 'availableFrom', 'timing', 'decisions', 'costs'])
        array(ability.availableFrom, childPath(path, 'availableFrom'), { nonempty: true }).forEach((zone, index) =>
          enumeration(zone, childPath(childPath(path, 'availableFrom'), index), ZONES, 'zone'))
        enumeration(ability.timing, childPath(path, 'timing'), new Set(['anyTime', 'sorcery']), 'activation timing')
        const result = validateDecisions(ability.decisions, childPath(path, 'decisions'), baseEnvironment(), true)
        const costEnv: Environment = { ...cloneEnv(result.env), targets: [], targetSingleton: [], locals: new Map() }
        array(ability.costs, childPath(path, 'costs')).forEach((cost, index) => validateCost(cost, childPath(childPath(path, 'costs'), index), costEnv))
        validateProgram(ability, path, result)
        return
      }
      case 'triggered': {
        exactKeys(ability, path, ['kind', 'activeIn', 'on', 'triggerOnlyIf', 'interveningIf', 'frequency', 'decisions', 'instructions', 'modes'], ['kind', 'activeIn', 'on', 'decisions'])
        array(ability.activeIn, childPath(path, 'activeIn'), { nonempty: true }).forEach((zone, index) =>
          enumeration(zone, childPath(childPath(path, 'activeIn'), index), ZONES, 'zone'))
        const occurrenceEnv = validateOccurrence(ability.on, childPath(path, 'on'), baseEnvironment())
        if (ability.triggerOnlyIf !== undefined) validateCondition(ability.triggerOnlyIf, childPath(path, 'triggerOnlyIf'), occurrenceEnv)
        if (ability.interveningIf !== undefined) validateCondition(ability.interveningIf, childPath(path, 'interveningIf'), occurrenceEnv)
        if (ability.frequency !== undefined) {
          const frequency = object(ability.frequency, childPath(path, 'frequency'))
          if (frequency) {
            exactKeys(frequency, childPath(path, 'frequency'), ['kind'], ['kind'])
            enumeration(frequency.kind, childPath(childPath(path, 'frequency'), 'kind'), new Set(['onceEachTurn', 'firstMatchingEachTurn']), 'trigger frequency')
          }
        }
        const result = validateDecisions(ability.decisions, childPath(path, 'decisions'), occurrenceEnv, true)
        validateProgram(ability, path, result)
        return
      }
      case 'static': {
        exactKeys(ability, path, ['kind', 'activeIn', 'effects'], ['kind', 'activeIn', 'effects'])
        array(ability.activeIn, childPath(path, 'activeIn'), { nonempty: true }).forEach((zone, index) =>
          enumeration(zone, childPath(childPath(path, 'activeIn'), index), ZONES, 'zone'))
        array(ability.effects, childPath(path, 'effects'), { nonempty: true }).forEach((effect, index) => {
          const effectPath = childPath(childPath(path, 'effects'), index)
          const node = object(effect, effectPath)
          if (!node) return
          declarations.push({ path: effectPath, kind: `effect:${String(node.kind)}` })
          if (node.kind !== 'prohibitActivation') {
            issue(childPath(effectPath, 'kind'), 'unsupported-kind', `unsupported continuous effect kind: ${String(node.kind)}`)
            return
          }
          exactKeys(node, effectPath, ['kind', 'filter'], ['kind', 'filter'])
          const filter = object(node.filter, childPath(effectPath, 'filter'))
          if (!filter) return
          exactKeys(filter, childPath(effectPath, 'filter'), ['abilitySource', 'activator'])
          if (filter.abilitySource !== undefined) validateObjectFilter(filter.abilitySource, childPath(childPath(effectPath, 'filter'), 'abilitySource'), baseEnvironment())
          if (filter.activator !== undefined) validatePlayerFilter(filter.activator, childPath(childPath(effectPath, 'filter'), 'activator'))
        })
        return
      }
      case 'keyword':
        exactKeys(ability, path, ['kind', 'keyword'], ['kind', 'keyword'])
        enumeration(ability.keyword, childPath(path, 'keyword'), new Set(['defender', 'trample']), 'keyword')
        return
      default: issue(childPath(path, 'kind'), 'unsupported-kind', `unsupported ability kind: ${String(ability.kind)}`)
    }
  }

  const definition = object(root, '$')
  if (!definition) return { diagnostics, declarations }
  exactKeys(definition, '$', ['schemaVersion', 'definitionRevision', 'abilities'], ['schemaVersion', 'definitionRevision', 'abilities'])
  if (definition.schemaVersion !== RULE_DSL_SCHEMA_VERSION) {
    issue('$.schemaVersion', 'unsupported-version', `unsupported Rule DSL schema version: ${String(definition.schemaVersion)}`)
    return { diagnostics, declarations }
  }
  if (typeof definition.definitionRevision !== 'string' || !/^v1-[0-9a-f]{16}$/.test(definition.definitionRevision)) {
    issue('$.definitionRevision', 'definition-revision', 'expected a v1 immutable content revision')
  }
  const abilities = array(definition.abilities, '$.abilities')
  abilities.forEach((ability, index) => validateAbility(ability, childPath('$.abilities', index)))
  const expectedRevision = definitionRevisionFor({ schemaVersion: RULE_DSL_SCHEMA_VERSION, abilities })
  if (definition.definitionRevision !== expectedRevision) {
    issue('$.definitionRevision', 'definition-revision', `revision does not match canonical content; expected ${expectedRevision}`)
  }
  return { diagnostics, declarations }
}

export const asDefinitionV1 = (value: unknown): CardRuleDefinitionV1 => value as CardRuleDefinitionV1
