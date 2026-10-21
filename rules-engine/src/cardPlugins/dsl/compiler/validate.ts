import { STEP_IDS } from '../../../types'
import { LIBRARY_INSTRUCTION_DIAGNOSTIC_CODE, LIBRARY_INSTRUCTION_DIAGNOSTIC_MESSAGE, OPTIONAL_ACTION_DIAGNOSTIC_CODE, OPTIONAL_ACTION_DIAGNOSTIC_MESSAGE } from './constants'
import type {
  CardRuleDefinitionV1,
  ContextBinding,
  DefinitionDeclaration,
  ResultField,
} from '../schema/v1'
import { PLAYER_COMPARISON_METRICS, LIBRARY_VISIBILITY, CARD_COLORS, KEYWORDS, LINKED_EXILE_RETURN, LIFE_LOST_COMBINE, REVEAL_UNTIL_REST, PLAYER_RELATIONS, ROUNDING_MODES, RULE_DSL_SCHEMA_VERSION } from '../schema/v1'
import { definitionRevisionFor } from '../builders/revision'
import type { RuleDslDiagnostic } from './errors'
import { RuleDslValidationError } from './errors'
import { MAX_EXPRESSION_DEPTH, MAX_LITERAL_AMOUNT, MAX_RUNTIME_AMOUNT } from './evaluate'

type Data = Record<string, unknown>
type Domain = 'damage' | 'player' | 'object' | 'stack' | 'boolean' | 'number'
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

  const validatePlayerFilter = (value: unknown, path: string, env: Environment, depth = 0): void => {
    if (depth > MAX_TREE_DEPTH) {
      issue(path, 'depth-limit', `filter nesting is limited to ${MAX_TREE_DEPTH}`)
      return
    }
    const node = object(value, path)
    if (!node) return
    exactKeys(node, path, ['relation', 'all', 'any', 'not'])
    if (node.relation !== undefined) validatePlayerMatch(node.relation, childPath(path, 'relation'), env)
    for (const key of ['all', 'any'] as const) if (node[key] !== undefined) {
      array(node[key], childPath(path, key), { nonempty: true }).forEach((part, index) =>
        validatePlayerFilter(part, childPath(childPath(path, key), index), env, depth + 1))
    }
    if (node.not !== undefined) validatePlayerFilter(node.not, childPath(path, 'not'), env, depth + 1)
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
      case 'relatedPlayer':
        exactKeys(node, path, ['kind', 'relation', 'of'], ['kind', 'relation', 'of'])
        enumeration(node.relation, childPath(path, 'relation'), new Set(['controller', 'owner']), 'player role')
        validateReference(node.of, childPath(path, 'of'), env, node.relation === 'owner' ? ['object'] : ['object', 'stack'])
        domain = 'player'
        break
      case 'resultRef': {
        exactKeys(node, path, ['kind', 'binding', 'field'], ['kind', 'binding', 'field'])
        const name = bindingName(node.binding, childPath(path, 'binding'))
        const field = enumeration(node.field, childPath(path, 'field'), new Set(['player', 'amount', 'discarded', 'discardedCount', 'countered', 'paid', 'moved', 'destroyed', 'sacrificed', 'created', 'copied']), 'result field') as ResultField | undefined
        if (name && field) {
          const binding = env.locals.get(name)
          if (binding && binding.kind !== 'result') issue(childPath(path, 'binding'), 'binding-kind', `${name} is a choice binding, not a result binding`)
          else if (!binding?.fields?.has(field)) issue(childPath(path, 'field'), 'unresolved-binding', `result ${name}.${field} is not produced on every control-flow path`)
          else domain = field === 'player' ? 'player' : ['amount', 'discardedCount', 'created'].includes(field) ? 'number' : 'boolean'
        }
        break
      }
      default:
        issue(childPath(path, 'kind'), 'unsupported-kind', `unsupported reference kind: ${String(kind)}`)
    }
    if (domain && expected && !expected.includes(domain) && !(domain === 'damage' && expected.includes('player') && expected.includes('object'))) {
      issue(path, 'domain', `expected ${expected.join(' or ')} reference, received ${domain}`)
    }
    return domain
  }

  const validatePlayerMatch = (value: unknown, path: string, env: Environment) => {
    if (typeof value === 'string') enumeration(value, path, new Set(Object.values(PLAYER_RELATIONS)), 'player relation')
    else validateReference(value, path, env, ['player'])
  }

  const validateObjectFilter = (value: unknown, path: string, env: Environment, depth = 0): void => {
    if (depth > MAX_TREE_DEPTH) {
      issue(path, 'depth-limit', `filter nesting is limited to ${MAX_TREE_DEPTH}`)
      return
    }
    const node = object(value, path)
    if (!node) return
    exactKeys(node, path, ['zone', 'type', 'subtypes', 'supertypes', 'controller', 'owner', 'token', 'name', 'tapped', 'attacking', 'powerAtLeast', 'other', 'commander', 'manaAbility', 'sameNameAs', 'among', 'all', 'any', 'not'])
    if (node.zone !== undefined) enumeration(node.zone, childPath(path, 'zone'), ZONES, 'zone')
    for (const key of ['type', 'name'] as const) if (node[key] !== undefined && typeof node[key] !== 'string') issue(childPath(path, key), 'type', 'expected a string')
    for (const key of ['commander', 'manaAbility'] as const) if (node[key] !== undefined && typeof node[key] !== 'boolean') issue(childPath(path, key), 'type', 'expected a boolean')
    if (node.sameNameAs !== undefined) validateReference(node.sameNameAs, childPath(path, 'sameNameAs'), env, ['object'])
    if (node.token !== undefined && typeof node.token !== 'boolean') issue(childPath(path, 'token'), 'type', 'expected a boolean')
    if (node.other !== undefined && typeof node.other !== 'boolean') issue(childPath(path, 'other'), 'type', 'expected a boolean')
    if (node.powerAtLeast !== undefined) integer(node.powerAtLeast, childPath(path, 'powerAtLeast'), { min: -MAX_LITERAL_AMOUNT })
    if (node.tapped !== undefined && typeof node.tapped !== 'boolean') issue(childPath(path, 'tapped'), 'type', 'expected a boolean')
    if (node.attacking !== undefined && typeof node.attacking !== 'boolean') issue(childPath(path, 'attacking'), 'type', 'expected a boolean')
    if (node.among !== undefined) validateReference(node.among, childPath(path, 'among'), env, ['object'])
    if (node.subtypes !== undefined) array(node.subtypes, childPath(path, 'subtypes')).forEach((part, index) => {
      if (typeof part !== 'string') issue(childPath(childPath(path, 'subtypes'), index), 'type', 'expected a string')
    })
    if (node.supertypes !== undefined) array(node.supertypes, childPath(path, 'supertypes')).forEach((part, index) => {
      if (typeof part !== 'string') issue(childPath(childPath(path, 'supertypes'), index), 'type', 'expected a string')
    })
    for (const key of ['controller', 'owner'] as const) if (node[key] !== undefined) {
      validatePlayerMatch(node[key], childPath(path, key), env)
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
    exactKeys(node, path, ['kind', 'type', 'color', 'other', 'controller', 'all', 'any', 'not'])
    if (node.kind !== undefined) enumeration(node.kind, childPath(path, 'kind'), new Set(['spell', 'ability']), 'stack-item kind')
    if (node.type !== undefined && typeof node.type !== 'string') issue(childPath(path, 'type'), 'type', 'expected a string')
    if (node.color !== undefined) enumeration(node.color, childPath(path, 'color'), new Set(CARD_COLORS), 'card color')
    if (node.other !== undefined && typeof node.other !== 'boolean') issue(childPath(path, 'other'), 'type', 'expected a boolean')
    if (node.controller !== undefined) validatePlayerMatch(node.controller, childPath(path, 'controller'), env)
    for (const key of ['all', 'any'] as const) if (node[key] !== undefined) {
      array(node[key], childPath(path, key), { nonempty: true }).forEach((part, index) =>
        validateStackFilter(part, childPath(childPath(path, key), index), env, depth + 1))
    }
    if (node.not !== undefined) validateStackFilter(node.not, childPath(path, 'not'), env, depth + 1)
  }

  const validateSelector = (value: unknown, path: string, env: Environment): Domain | undefined => {
    const node = object(value, path)
    if (!node) return undefined
    exactKeys(node, path, ['kind', 'filter'], ['kind'])
    switch (node.kind) {
      case 'anyTarget': exactKeys(node, path, ['kind'], ['kind']); return 'damage'
      case 'players': validatePlayerFilter(node.filter, childPath(path, 'filter'), env); return 'player'
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
    if (domain && !expected.includes(domain) && !(domain === 'damage' && expected.includes('player') && expected.includes('object'))) issue(path, 'domain', `expected ${expected.join(' or ')} recipient, received ${domain}`)
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
      case 'multiply':
      case 'minimum':
      case 'add':
        exactKeys(node, path, ['kind', 'left', 'right'], ['kind', 'left', 'right'])
        validateAmount(node.left, childPath(path, 'left'), env, depth + 1)
        validateAmount(node.right, childPath(path, 'right'), env, depth + 1)
        return
      case 'divide':
        exactKeys(node, path, ['kind', 'value', 'by', 'rounding'], ['kind', 'value', 'by', 'rounding'])
        integer(node.by, childPath(path, 'by'), { min: 1 })
        enumeration(node.rounding, childPath(path, 'rounding'), new Set(Object.values(ROUNDING_MODES)), 'rounding mode')
        validateAmount(node.value, childPath(path, 'value'), env, depth + 1)
        return
      case 'resultRef':
        validateReference(node, path, env, ['number'])
        return
      case 'eventAmount':
        exactKeys(node, path, ['kind'], ['kind'])
        if (!env.eventAmount) issue(path, 'unresolved-binding', 'eventAmount is not available in this execution context')
        return
      case 'manaSpent':
        exactKeys(node, path, ['kind', 'color'], ['kind', 'color'])
        enumeration(node.color, childPath(path, 'color'), new Set(CARD_COLORS), 'card color')
        return
      case 'countDistinctNames':
        exactKeys(node, path, ['kind', 'of'], ['kind', 'of'])
        if (validateSelector(node.of, childPath(path, 'of'), env) !== 'object') issue(childPath(path, 'of'), 'domain', 'countDistinctNames requires an object selector')
        return
      case 'count':
        exactKeys(node, path, ['kind', 'of'], ['kind', 'of'])
        validateSelector(node.of, childPath(path, 'of'), env)
        return
      case 'greatest': {
        exactKeys(node, path, ['kind', 'of', 'characteristic', 'information'], ['kind', 'of', 'characteristic', 'information'])
        if (validateSelector(node.of, childPath(path, 'of'), env) !== 'object') {
          issue(childPath(path, 'of'), 'domain', 'greatest requires an object selector')
        }
        enumeration(node.characteristic, childPath(path, 'characteristic'), new Set(['power', 'toughness', 'manaValue', 'loyalty']), 'numeric characteristic')
        enumeration(node.information, childPath(path, 'information'), new Set(['current', 'currentOrLastKnown']), 'information policy')
        return
      }
      case 'characteristic': {
        exactKeys(node, path, ['kind', 'of', 'characteristic', 'information', 'fallback'], ['kind', 'of', 'characteristic', 'information'])
        const domain = validateReference(node.of, childPath(path, 'of'), env)
        const characteristic = enumeration(node.characteristic, childPath(path, 'characteristic'), new Set(['power', 'toughness', 'manaValue', 'life', 'loyalty']), 'numeric characteristic')
        enumeration(node.information, childPath(path, 'information'), new Set(['current', 'currentOrLastKnown']), 'information policy')
        if (node.fallback !== undefined) {
          integer(node.fallback, childPath(path, 'fallback'), { max: MAX_RUNTIME_AMOUNT })
          if (domain && !['player', 'object', 'stack', 'damage'].includes(domain)) issue(childPath(path, 'of'), 'domain', 'a characteristic fallback requires a player or object reference')
        }
        if (node.fallback === undefined && characteristic === 'life' && domain && domain !== 'player') issue(childPath(path, 'of'), 'domain', 'life requires a player reference')
        if (node.fallback === undefined && characteristic && characteristic !== 'life' && domain && !['object', 'stack'].includes(domain)) {
          issue(childPath(path, 'of'), 'domain', `${characteristic} requires an object reference`)
        }
        return
      }
      case 'lifeLostThisTurn': {
        exactKeys(node, path, ['kind', 'of', 'combine'], ['kind', 'of'])
        const ofNode = object(node.of, childPath(path, 'of'))
        validateRecipient(node.of, childPath(path, 'of'), env, ['player'])
        if (ofNode?.kind === 'players') {
          if (node.combine === undefined) {
            issue(childPath(path, 'combine'), 'constant', 'lifeLostThisTurn over a player selector requires combine')
          } else {
            enumeration(node.combine, childPath(path, 'combine'), new Set(Object.values(LIFE_LOST_COMBINE)), 'life-lost combine')
          }
        } else if (node.combine !== undefined) {
          issue(childPath(path, 'combine'), 'constant', 'lifeLostThisTurn combine is only valid with a player selector')
        }
        return
      }
      default: issue(childPath(path, 'kind'), 'unsupported-kind', `unsupported amount kind: ${String(node.kind)}`)
    }
  }

  const validateStatDelta = (value: unknown, path: string, env: Environment): void => {
    const node = object(value, path)
    if (node?.kind === 'constant') {
      exactKeys(node, path, ['kind', 'value'], ['kind', 'value'])
      integer(node.value, childPath(path, 'value'), { min: -MAX_LITERAL_AMOUNT })
      return
    }
    if (node?.kind === 'negate') {
      exactKeys(node, path, ['kind', 'value'], ['kind', 'value'])
      validateAmount(node.value, childPath(path, 'value'), env, 1)
      return
    }
    validateAmount(value, path, env)
  }

  const validatePreventionCapacity = (value: unknown, path: string, env: Environment): void => {
    const node = object(value, path)
    if (!node) return
    if (node.kind === 'unlimited') {
      exactKeys(node, path, ['kind'], ['kind'])
      return
    }
    validateAmount(value, path, env)
  }

  const validatePreventionFilter = (value: unknown, path: string, env: Environment): void => {
    const node = object(value, path)
    if (!node) return
    exactKeys(node, path, ['recipient', 'source', 'combat'], [])
    if (node.combat !== undefined && typeof node.combat !== 'boolean') {
      issue(childPath(path, 'combat'), 'type', 'expected a boolean')
    }
    if (node.recipient !== undefined) {
      validateRecipient(node.recipient, childPath(path, 'recipient'), env, ['player', 'object'])
    }
    if (node.source !== undefined) {
      validateRecipient(node.source, childPath(path, 'source'), env, ['object'])
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
      case 'somePlayerHasMore':
        exactKeys(node, path, ['kind', 'players', 'than', 'metric'], ['kind', 'players', 'than', 'metric'])
        if (validateSelector(node.players, childPath(path, 'players'), env) !== 'player') issue(childPath(path, 'players'), 'domain', 'comparison requires a player selector')
        validateReference(node.than, childPath(path, 'than'), env, ['player'])
        enumeration(node.metric, childPath(path, 'metric'), new Set(PLAYER_COMPARISON_METRICS), 'player comparison metric')
        return

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
      case 'choiceIs':
        exactKeys(node, path, ['kind', 'binding', 'option'], ['kind', 'binding', 'option'])
        bindingName(node.binding, childPath(path, 'binding'))
        if (typeof node.option !== 'string' || node.option.length === 0) {
          issue(childPath(path, 'option'), 'binding-name', 'choiceIs requires a nonempty option id')
        }
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
    if (domain === 'damage' && max !== 1) issue(path, 'bounds', 'anyTarget clauses currently require a maximum of one target')
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
      exactKeys(node, entryPath, ['name', 'min', 'max', 'manaColor'], ['name', 'min', 'max'])
      if (node.name !== 'X') issue(childPath(entryPath, 'name'), 'unsupported-variable', `unsupported decision variable: ${String(node.name)}`)
      else if (seen.has('X') || env.variables.has('X')) issue(childPath(entryPath, 'name'), 'duplicate-binding', 'X is declared more than once in this program scope')
      else {
        seen.add('X')
        ;(env.variables as Set<string>).add('X')
      }
      if (node.manaColor !== undefined) enumeration(node.manaColor, childPath(entryPath, 'manaColor'), new Set(['W', 'U', 'B', 'R', 'G', 'C']), 'mana color')
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
  ): { env: Environment; modeCount?: number; repeatable?: boolean; modeDeclared?: boolean } => {
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
    let modeDeclared = false
    if (node.modes !== undefined) {
      modeDeclared = true
      if (!allowModes) issue(childPath(path, 'modes'), 'modal-structure', 'nested mode decisions are not supported in Rule DSL v1')
      const modes = object(node.modes, childPath(path, 'modes'))
      if (modes) {
        exactKeys(modes, childPath(path, 'modes'), ['count', 'repeatable'], ['count', 'repeatable'])
        validateAmount(modes.count, childPath(childPath(path, 'modes'), 'count'), env)
        if (isData(modes.count) && modes.count.kind === 'constant') modeCount = integer(modes.count.value, childPath(childPath(childPath(path, 'modes'), 'count'), 'value'), { min: 1, max: MAX_LIST_LENGTH })
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
    return { env, modeCount, repeatable, modeDeclared }
  }

  const validateCost = (value: unknown, path: string, env: Environment): void => {
    const node = object(value, path)
    if (!node) return
    declarations.push({ path, kind: `cost:${String(node.kind)}` })
    switch (node.kind) {
      case 'tapSource':
        exactKeys(node, path, ['kind'], ['kind'])
        return
      case 'discard':
      case 'sacrifice':
        exactKeys(node, path, ['kind', 'filter', 'count'], ['kind', 'filter', 'count'])
        if (validateRecipient(node.filter, childPath(path, 'filter'), env, ['object']) !== 'object') {
          issue(childPath(path, 'filter'), 'domain', `${node.kind} costs require an object recipient`)
        }
        validateAmount(node.count, childPath(path, 'count'), env)
        return
      case 'life':
        exactKeys(node, path, ['kind', 'amount'], ['kind', 'amount'])
        validateAmount(node.amount, childPath(path, 'amount'), env)
        return
      case 'draw':
        exactKeys(node, path, ['kind', 'count'], ['kind', 'count'])
        validateAmount(node.count, childPath(path, 'count'), env)
        return
      case 'delve':
        exactKeys(node, path, ['kind'], ['kind'])
        return
      case 'mana':
        exactKeys(node, path, ['kind', 'amount'], ['kind', 'amount'])
        if (typeof node.amount !== 'string' || node.amount.length === 0 || node.amount.length > 128
          || !/^(?:\{(?:[0-9]+|[WUBRGCX]|[WUBRGC]\/P)\})+$/.test(node.amount)) {
          issue(childPath(path, 'amount'), 'mana-cost', 'mana cost must contain only braced generic, W, U, B, R, G, C, X, or Phyrexian {W/P}{U/P}{B/P}{R/P}{G/P}{C/P} symbols')
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
    const withEventPlayer = (base: Environment) => {
      const next = cloneEnv(base)
      next.context = new Map([...next.context, ['event.player', 'player']])
      return next
    }
    const amountInstruction = (field: 'amount' | 'count', expected: readonly Domain[]): void => {
      exactKeys(node, path, ['kind', field, 'targets'], ['kind', field, 'targets'])
      validateAmount(node[field], childPath(path, field), env)
      validateRecipient(node.targets, childPath(path, 'targets'), env, expected)
    }
    switch (node.kind) {
      case 'inspectTop':
        exactKeys(node, path, ['kind', 'player', 'count', 'bindChoice', 'visibility'], ['kind', 'player', 'count', 'bindChoice', 'visibility'])
        validateReference(node.player, childPath(path, 'player'), env, ['player'])
        validateAmount(node.count, childPath(path, 'count'), env)
        enumeration(node.visibility, childPath(path, 'visibility'), new Set(Object.values(LIBRARY_VISIBILITY)), 'library visibility')
        declareBinding(env, bindingName(node.bindChoice, childPath(path, 'bindChoice')), { kind: 'choice', domain: 'object' }, childPath(path, 'bindChoice'))
        return
      case 'capturePlayer':
        exactKeys(node, path, ['kind', 'player', 'bindResult'], ['kind', 'player', 'bindResult'])
        validateReference(node.player, childPath(path, 'player'), env, ['player'])
        declareBinding(env, bindingName(node.bindResult, childPath(path, 'bindResult')), { kind: 'result', domain: 'player', fields: new Set<ResultField>(['player']) }, childPath(path, 'bindResult'))
        return
      case 'captureAmount':
        exactKeys(node, path, ['kind', 'amount', 'bindResult'], ['kind', 'amount', 'bindResult'])
        validateAmount(node.amount, childPath(path, 'amount'), env)
        declareBinding(env, bindingName(node.bindResult, childPath(path, 'bindResult')), { kind: 'result', domain: 'number', fields: new Set<ResultField>(['amount']) }, childPath(path, 'bindResult'))
        return
      case 'captureCopy':
        exactKeys(node, path, ['kind', 'targets', 'bindResult'], ['kind', 'targets', 'bindResult'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['object'])
        declareBinding(env, bindingName(node.bindResult, childPath(path, 'bindResult')), { kind: 'result', domain: 'boolean', fields: new Set<ResultField>(['copied']) }, childPath(path, 'bindResult'))
        return
      case 'addManaFrom':
        exactKeys(node, path, ['kind', 'of', 'colorsOnly', 'amount', 'targets'], ['kind', 'of', 'colorsOnly', 'amount', 'targets'])
        if (validateSelector(node.of, childPath(path, 'of'), env) !== 'object') issue(childPath(path, 'of'), 'type', 'expected an object selector')
        if (typeof node.colorsOnly !== 'boolean') issue(childPath(path, 'colorsOnly'), 'type', 'expected a boolean')
        validateAmount(node.amount, childPath(path, 'amount'), env)
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['player'])
        return
      case 'addMana': {
        exactKeys(node, path, ['kind', 'amount', 'targets'], ['kind', 'amount', 'targets'])
        const amount = object(node.amount, childPath(path, 'amount'))
        if (amount) for (const [symbol, value] of Object.entries(amount)) {
          if (!['W', 'U', 'B', 'R', 'G', 'C'].includes(symbol)) issue(childPath(path, 'amount'), 'mana-symbol', `invalid mana symbol ${symbol}`)
          validateAmount(value, childPath(childPath(path, 'amount'), symbol), env)
        }
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['player'])
        return
      }
      case 'loseLife':
        exactKeys(node, path, ['kind', 'amount', 'targets', 'bindResult'], ['kind', 'amount', 'targets'])
        validateAmount(node.amount, childPath(path, 'amount'), withEventPlayer(env))
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['player'])
        if (node.bindResult !== undefined) declareBinding(env, bindingName(node.bindResult, childPath(path, 'bindResult')), { kind: 'result', domain: 'number', fields: new Set<ResultField>(['amount']) }, childPath(path, 'bindResult'))
        return
      case 'gainLife':
        exactKeys(node, path, ['kind', 'amount', 'targets'], ['kind', 'amount', 'targets'])
        validateAmount(node.amount, childPath(path, 'amount'), withEventPlayer(env))
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['player'])
        return
      case 'setLife':
        exactKeys(node, path, ['kind', 'amount', 'targets', 'bindResult'], ['kind', 'amount', 'targets'])
        validateAmount(node.amount, childPath(path, 'amount'), withEventPlayer(env))
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['player'])
        if (node.bindResult !== undefined) declareBinding(env, bindingName(node.bindResult, childPath(path, 'bindResult')), { kind: 'result', domain: 'number', fields: new Set<ResultField>(['amount']) }, childPath(path, 'bindResult'))
        return
      case 'exchangeLife':
        exactKeys(node, path, ['kind', 'first', 'second', 'bindResult'], ['kind', 'first', 'second'])
        validateRecipient(node.first, childPath(path, 'first'), env, ['player'])
        validateRecipient(node.second, childPath(path, 'second'), env, ['player'])
        if (node.bindResult !== undefined) declareBinding(env, bindingName(node.bindResult, childPath(path, 'bindResult')), { kind: 'result', domain: 'number', fields: new Set<ResultField>(['amount']) }, childPath(path, 'bindResult'))
        return
      case 'winGame':
        exactKeys(node, path, ['kind', 'targets'], ['kind', 'targets'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['player'])
        return
      case 'draw':
        exactKeys(node, path, ['kind', 'count', 'targets'], ['kind', 'count', 'targets'])
        validateAmount(node.count, childPath(path, 'count'), withEventPlayer(env))
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['player'])
        return
      case 'grantLandPlays': amountInstruction('count', ['player']); return
      case 'grantNoMaximumHandSize':
        exactKeys(node, path, ['kind', 'targets'], ['kind', 'targets'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['player'])
        return
      case 'linkExile':
        exactKeys(node, path, ['kind', 'targets', 'untilSourceLeaves', 'returnTo'], ['kind', 'targets'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['object'])
        if (node.untilSourceLeaves !== undefined && node.untilSourceLeaves !== true) {
          issue(childPath(path, 'untilSourceLeaves'), 'constant', 'untilSourceLeaves must be true when present')
        }
        if (node.returnTo !== undefined) enumeration(node.returnTo, childPath(path, 'returnTo'), new Set(LINKED_EXILE_RETURN), 'linked exile return')
        return
      case 'returnLinkedExile':
        exactKeys(node, path, ['kind', 'returnTo'])
        if (node.returnTo !== undefined) enumeration(node.returnTo, childPath(path, 'returnTo'), new Set(LINKED_EXILE_RETURN), 'linked exile return')
        return
      case 'scry':
      case 'surveil':
      case 'mill': amountInstruction('count', ['player']); return
      case 'damage':
        exactKeys(node, path, ['kind', 'amount', 'targets', 'source', 'bindResult'], ['kind', 'amount', 'targets', 'source'])
        validateAmount(node.amount, childPath(path, 'amount'), env)
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['player', 'object'])
        validateReference(node.source, childPath(path, 'source'), env, ['object'])
        if (node.bindResult !== undefined) declareBinding(env, bindingName(node.bindResult, childPath(path, 'bindResult')), { kind: 'result', domain: 'number', fields: new Set<ResultField>(['amount']) }, childPath(path, 'bindResult'))
        return
      case 'blink':
        exactKeys(node, path, ['kind', 'targets', 'returnController', 'tapped'], ['kind', 'targets'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['object'])
        if (node.returnController !== undefined && node.returnController !== 'owner') {
          validateReference(node.returnController, childPath(path, 'returnController'), env, ['player'])
        }
        if (node.tapped !== undefined && typeof node.tapped !== 'boolean') issue(childPath(path, 'tapped'), 'type', 'expected a boolean')
        return
      case 'fight':
        exactKeys(node, path, ['kind', 'left', 'right'], ['kind', 'left', 'right'])
        validateReference(node.left, childPath(path, 'left'), env, ['object'])
        validateReference(node.right, childPath(path, 'right'), env, ['object'])
        return
      case 'reveal':
      case 'tap':
      case 'untap':
        exactKeys(node, path, ['kind', 'targets'], ['kind', 'targets'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['object'])
        return
      case 'destroy':
        exactKeys(node, path, ['kind', 'targets', 'bindResult', 'bindChoice'], ['kind', 'targets'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['object'])
        if (node.bindResult !== undefined) {
          const name = bindingName(node.bindResult, childPath(path, 'bindResult'))
          declareBinding(env, name, { kind: 'result', domain: 'boolean', fields: new Set<ResultField>(['destroyed']) }, childPath(path, 'bindResult'))
        }
        if (node.bindChoice !== undefined) {
          declareBinding(env, bindingName(node.bindChoice, childPath(path, 'bindChoice')), { kind: 'choice', domain: 'object' }, childPath(path, 'bindChoice'))
        }
        return
      case 'sacrifice':
      case 'move': {
        exactKeys(node, path, node.kind === 'move' ? ['kind', 'targets', 'to', 'controller', 'bindResult', 'bindChoice', 'tapped', 'enterCounters', 'position', 'order'] : ['kind', 'targets', 'bindResult', 'bindCount'], ['kind', 'targets'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['object'])
        if (node.kind === 'move' && !ZONES.has(String(node.to))) issue(childPath(path, 'to'), 'enum', `unsupported destination: ${String(node.to)}`)
        if (node.kind === 'move' && node.tapped !== undefined && typeof node.tapped !== 'boolean') {
          issue(childPath(path, 'tapped'), 'type', 'expected a boolean')
        }
        if (node.kind === 'move' && node.controller !== undefined) {
          if (node.to !== 'battlefield') issue(childPath(path, 'controller'), 'domain', 'move controller requires a battlefield destination')
          validateReference(node.controller, childPath(path, 'controller'), env, ['player'])
        }
        if (node.kind === 'move' && node.enterCounters !== undefined) {
          const countersPath = childPath(path, 'enterCounters')
          if (node.to !== 'battlefield') issue(countersPath, 'domain', 'entry counters require a battlefield destination')
          const counters = object(node.enterCounters, countersPath)
          if (counters) for (const [counter, count] of Object.entries(counters)) {
            if (counter.trim().length === 0) issue(countersPath, 'type', 'expected a nonempty counter name')
            validateAmount(count, childPath(countersPath, counter), env)
          }
        }
        if (node.bindResult !== undefined) {
          const name = bindingName(node.bindResult, childPath(path, 'bindResult'))
          declareBinding(env, name, node.kind === 'move'
            ? { kind: 'result', domain: 'number', fields: new Set<ResultField>(['amount']) }
            : { kind: 'result', domain: 'boolean', fields: new Set<ResultField>(['sacrificed']) }, childPath(path, 'bindResult'))
        }
        if (node.kind === 'sacrifice' && node.bindCount !== undefined) {
          declareBinding(env, bindingName(node.bindCount, childPath(path, 'bindCount')), { kind: 'result', domain: 'number', fields: new Set<ResultField>(['amount']) }, childPath(path, 'bindCount'))
        }
        if (node.kind === 'move' && node.order !== undefined) {
          if (node.order !== 'random') issue(childPath(path, 'order'), 'enum', 'unsupported move order')
          if (node.to !== 'library' || node.position !== 'bottom') issue(childPath(path, 'order'), LIBRARY_INSTRUCTION_DIAGNOSTIC_CODE.MOVE_ORDER, LIBRARY_INSTRUCTION_DIAGNOSTIC_MESSAGE.MOVE_ORDER)
        }
        if (node.kind === 'move' && node.position !== undefined) {
          enumeration(node.position, childPath(path, 'position'), new Set(['top', 'bottom']), 'library position')
          if (node.to !== 'library') issue(childPath(path, 'position'), 'move-position', 'position requires the library destination')
        }
        if (node.kind === 'move' && node.bindChoice !== undefined) {
          if (!new Set(['battlefield', 'graveyard', 'exile', 'command']).has(String(node.to))) issue(childPath(path, 'bindChoice'), 'move-binding-zone', 'move bindings require a public destination')
          declareBinding(env, bindingName(node.bindChoice, childPath(path, 'bindChoice')), { kind: 'choice', domain: 'object' }, childPath(path, 'bindChoice'))
        }
        return
      }
      case 'phase':
        exactKeys(node, path, ['kind', 'targets', 'out'], ['kind', 'targets', 'out'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['object'])
        if (typeof node.out !== 'boolean') issue(childPath(path, 'out'), 'type', 'expected a boolean')
        return
      case 'proliferate':
        exactKeys(node, path, ['kind', 'targets'], ['kind', 'targets'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['player'])
        return
      case 'shuffle':
        exactKeys(node, path, ['kind', 'targets'], ['kind', 'targets'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['player'])
        return
      case 'createToken': {
        exactKeys(node, path, ['kind', 'count', 'targets', 'token', 'bindResult'], ['kind', 'count', 'targets', 'token'])
        validateAmount(node.count, childPath(path, 'count'), env)
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['player'])
        const token = object(node.token, childPath(path, 'token'))
        if (token) {
          exactKeys(token, childPath(path, 'token'), ['name', 'types', 'subtypes', 'colors', 'power', 'toughness', 'oracleText', 'abilities'], ['name', 'types'])
          if (token.abilities !== undefined) array(token.abilities, `${path}.token.abilities`).forEach((ability, index) => validateAbility(ability, `${path}.token.abilities[${index}]`))
          if (typeof token.name !== 'string' || !Array.isArray(token.types)) issue(childPath(path, 'token'), 'type', 'token requires name and types')
        }
        if (node.bindResult !== undefined) {
          const name = bindingName(node.bindResult, childPath(path, 'bindResult'))
          declareBinding(env, name, { kind: 'result', domain: 'number', fields: new Set<ResultField>(['created']) }, childPath(path, 'bindResult'))
        }
        return
      }
      case 'copy': {
        const hasTargets = node.targets !== undefined
        const hasSnapshot = node.snapshot !== undefined
        if (hasTargets === hasSnapshot) issue(path, 'instruction-shape', 'copy requires exactly one of targets or snapshot')
        exactKeys(node, path, ['kind', 'targets', 'snapshot', 'controller', 'bindResult'], hasTargets ? ['kind', 'targets'] : ['kind', 'snapshot'])
        if (hasTargets) validateRecipient(node.targets, childPath(path, 'targets'), env, ['object'])
        if (hasSnapshot) {
          const name = bindingName(node.snapshot, childPath(path, 'snapshot'))
          if (name && !env.locals.get(name)?.fields?.has('copied')) {
            issue(childPath(path, 'snapshot'), 'unresolved-binding', `copy snapshot ${name} is not bound`)
          }
        }
        if (node.controller !== undefined) validateRecipient(node.controller, childPath(path, 'controller'), env, ['player'])
        if (node.bindResult !== undefined) {
          const name = bindingName(node.bindResult, childPath(path, 'bindResult'))
          declareBinding(env, name, { kind: 'result', domain: 'number', fields: new Set<ResultField>(['created']) }, childPath(path, 'bindResult'))
        }
        return
      }
      case 'copySpell':
        exactKeys(node, path, ['kind', 'targets', 'controller', 'retarget', 'bindResult'], ['kind', 'targets'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['stack'])
        if (node.controller !== undefined) validateRecipient(node.controller, childPath(path, 'controller'), env, ['player'])
        if (node.retarget !== undefined) {
          const retarget = object(node.retarget, childPath(path, 'retarget'))
          if (retarget) {
            exactKeys(retarget, childPath(path, 'retarget'), ['kind'], ['kind'])
            if (retarget.kind !== 'keep' && retarget.kind !== 'chooseNewTargets') {
              issue(childPath(childPath(path, 'retarget'), 'kind'), 'enum', `unsupported copy retargeting procedure: ${String(retarget.kind)}`)
            }
          }
        }
        if (node.bindResult !== undefined) {
          const name = bindingName(node.bindResult, childPath(path, 'bindResult'))
          declareBinding(env, name, { kind: 'result', domain: 'number', fields: new Set<ResultField>(['created']) }, childPath(path, 'bindResult'))
        }
        return
      case 'putCounters':
        exactKeys(node, path, ['kind', 'targets', 'counter', 'count', 'bindResult'], ['kind', 'targets', 'counter', 'count'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['object'])
        if (typeof node.counter !== 'string') issue(childPath(path, 'counter'), 'type', 'expected a counter name')
        validateAmount(node.count, childPath(path, 'count'), env)
        if (node.bindResult !== undefined) {
          const name = bindingName(node.bindResult, childPath(path, 'bindResult'))
          declareBinding(env, name, { kind: 'result', domain: 'number', fields: new Set<ResultField>(['created']) }, childPath(path, 'bindResult'))
        }
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
      case 'createEffect': {
        exactKeys(node, path, ['kind', 'targets', 'effect', 'duration'], ['kind', 'targets', 'effect', 'duration'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['object'])
        const duration = object(node.duration, childPath(path, 'duration'))
        if (duration) {
          exactKeys(duration, childPath(path, 'duration'), ['kind', 'step', 'active', 'count'], ['kind'])
          enumeration(duration.kind, childPath(childPath(path, 'duration'), 'kind'), new Set(['untilCleanup', 'permanent', 'untilStep', 'forTurns', 'whileSourceOnBattlefield']), 'effect duration')
          if (duration.kind === 'untilStep') {
            if (typeof duration.step !== 'string' || duration.step.length === 0) issue(childPath(childPath(path, 'duration'), 'step'), 'type', 'untilStep requires a step name')
            if (duration.active !== undefined) validateReference(duration.active, childPath(childPath(path, 'duration'), 'active'), env, ['player'])
          }
          if (duration.kind === 'forTurns') validateAmount(duration.count, childPath(childPath(path, 'duration'), 'count'), env)
        }
        const effect = object(node.effect, childPath(path, 'effect'))
        if (effect) {
          exactKeys(effect, childPath(path, 'effect'), ['kind', 'power', 'toughness', 'keyword', 'ability', 'filter', 'capacity', 'additionalEffects', 'colors'], ['kind'])
          switch (effect.kind) {
            case 'goad':
              exactKeys(effect, childPath(path, 'effect'), ['kind'], ['kind'])
              break
            case 'setColors':
              array(effect.colors, childPath(childPath(path, 'effect'), 'colors')).forEach((color, index) =>
                enumeration(color, childPath(childPath(childPath(path, 'effect'), 'colors'), index), new Set(CARD_COLORS), 'card color'))
              break
            case 'pump':
              validateStatDelta(effect.power, childPath(childPath(path, 'effect'), 'power'), env)
              validateStatDelta(effect.toughness, childPath(childPath(path, 'effect'), 'toughness'), env)
              break
            case 'grantKeyword':
              enumeration(effect.keyword, childPath(childPath(path, 'effect'), 'keyword'), new Set(Object.values(KEYWORDS)), 'granted keyword')
              break
            case 'grantAbility': {
              const ability = object(effect.ability, childPath(childPath(path, 'effect'), 'ability'))
              if (ability) {
                exactKeys(ability, childPath(childPath(path, 'effect'), 'ability'), ['kind', 'on', 'decisions', 'instructions'], ['kind', 'on', 'instructions'])
                if (ability.kind !== 'triggered') issue(childPath(childPath(childPath(path, 'effect'), 'ability'), 'kind'), 'unsupported-kind', 'generated abilities must be triggered')
                else {
                  const occurrenceEnv = validateOccurrence(ability.on, childPath(childPath(childPath(path, 'effect'), 'ability'), 'on'), cloneEnv(env))
                  const decisionsResult = ability.decisions === undefined
                    ? { env: occurrenceEnv }
                    : validateDecisions(ability.decisions, childPath(childPath(childPath(path, 'effect'), 'ability'), 'decisions'), occurrenceEnv, true)
                  validateInstructionList(ability.instructions, childPath(childPath(childPath(path, 'effect'), 'ability'), 'instructions'), decisionsResult.env, depth + 1)
                }
              }
              break
            }
            case 'prevention':
              validatePreventionFilter(effect.filter, childPath(childPath(path, 'effect'), 'filter'), env)
              validatePreventionCapacity(effect.capacity, childPath(childPath(path, 'effect'), 'capacity'), env)
              if (effect.additionalEffects !== undefined) {
                validateInstructionList(
                  effect.additionalEffects,
                  childPath(childPath(path, 'effect'), 'additionalEffects'),
                  preventionFollowUpEnvironment(env),
                  depth + 1,
                )
              }
              break
            default: issue(childPath(childPath(path, 'effect'), 'kind'), 'unsupported-kind', `unsupported created effect: ${String(effect.kind)}`)
          }
        }
        return
      }
      case 'payOptional': {
        exactKeys(node, path, ['kind', 'payer', 'cost', 'bindResult', 'whenPaidDecisions', 'ifPaid', 'ifDeclined', 'whenPaid'], ['kind', 'payer', 'cost', 'bindResult'])
        validateReference(node.payer, childPath(path, 'payer'), env, ['player'])
        validateCost(node.cost, childPath(path, 'cost'), env)
        const name = bindingName(node.bindResult, childPath(path, 'bindResult'))
        declareBinding(env, name, { kind: 'result', domain: 'boolean', fields: new Set<ResultField>(['paid']) }, childPath(path, 'bindResult'))
        const whenPaidEnv = node.whenPaidDecisions === undefined
          ? env
          : validateDecisions(node.whenPaidDecisions, childPath(path, 'whenPaidDecisions'), env, true).env
        if (node.ifPaid !== undefined) validateInstructionList(node.ifPaid, childPath(path, 'ifPaid'), env, depth + 1)
        if (node.ifDeclined !== undefined) validateInstructionList(node.ifDeclined, childPath(path, 'ifDeclined'), env, depth + 1)
        if (node.whenPaid !== undefined) validateInstructionList(node.whenPaid, childPath(path, 'whenPaid'), whenPaidEnv, depth + 1)
        return
      }
      case 'createDelayed': {
        if (node.notThisTurn !== undefined && node.notThisTurn !== true) issue(childPath(path, 'notThisTurn'), 'type', 'notThisTurn must be true')
        exactKeys(node, path, ['kind', 'condition', 'instructions', 'inheritTargets', 'notThisTurn'], ['kind', 'condition', 'instructions'])
        if (node.inheritTargets !== undefined && typeof node.inheritTargets !== 'boolean') issue(childPath(path, 'inheritTargets'), 'type', 'expected a boolean')
        const condition = object(node.condition, childPath(path, 'condition'))
        if (condition) {
          exactKeys(condition, childPath(path, 'condition'), ['kind', 'type', 'objectId', 'from', 'to', 'step', 'active'], ['kind'])
          enumeration(condition.kind, childPath(childPath(path, 'condition'), 'kind'), new Set(['event', 'step']), 'delayed pattern')
          if (condition.kind === 'event') {
            if (typeof condition.type !== 'string' || condition.type.length === 0) issue(childPath(childPath(path, 'condition'), 'type'), 'type', 'delayed event requires an event type')
            if (condition.objectId !== undefined) validateReference(condition.objectId, childPath(childPath(path, 'condition'), 'objectId'), env, ['object'])
            if (condition.from !== undefined) enumeration(condition.from, childPath(childPath(path, 'condition'), 'from'), ZONES, 'source zone')
            if (condition.to !== undefined) enumeration(condition.to, childPath(childPath(path, 'condition'), 'to'), ZONES, 'destination zone')
          } else {
            validateStepList(condition.step, childPath(childPath(path, 'condition'), 'step'))
            if (condition.active !== undefined) validateReference(condition.active, childPath(childPath(path, 'condition'), 'active'), env, ['player'])
          }
        }
        const callbackEnv = node.inheritTargets === false ? { ...cloneEnv(env), targets: [], targetSingleton: [] } : env
        validateInstructionList(node.instructions, childPath(path, 'instructions'), callbackEnv, depth + 1)
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
        exactKeys(node, path, ['kind', 'bindChoice', 'chooser', 'filter', 'viewLibrary', 'viewCards', 'min', 'max', 'distinct', 'whenInsufficient'], ['kind', 'bindChoice', 'chooser', 'filter', 'min', 'max', 'distinct', 'whenInsufficient'])
        validateReference(node.chooser, childPath(path, 'chooser'), env, ['player'])
        if (validateSelector(node.filter, childPath(path, 'filter'), env) !== 'object') issue(childPath(path, 'filter'), 'domain', 'chooseCards requires an object selector')
        if (node.viewCards !== undefined) validateReference(node.viewCards, childPath(path, 'viewCards'), env, ['object'])
        if (node.viewCards !== undefined && node.viewLibrary !== undefined) issue(path, LIBRARY_INSTRUCTION_DIAGNOSTIC_CODE.VIEW_SCOPE, LIBRARY_INSTRUCTION_DIAGNOSTIC_MESSAGE.VIEW_SCOPE)
        if (node.viewLibrary !== undefined && node.viewLibrary !== true) issue(childPath(path, 'viewLibrary'), 'constant', 'chooseCards viewLibrary must be true when present')
        if (node.viewLibrary === true && !(isData(node.filter) && isData(node.filter.filter) && node.filter.filter.zone === 'library')) {
          issue(childPath(path, 'viewLibrary'), 'zone', 'chooseCards viewLibrary requires a library filter')
        }
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
      case 'distributeControl':
        exactKeys(node, path, ['kind', 'targets', 'chooser', 'recipients', 'distinct'], ['kind', 'targets', 'chooser', 'recipients', 'distinct'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['object'])
        validateReference(node.chooser, childPath(path, 'chooser'), env, ['player'])
        validateRecipient(node.recipients, childPath(path, 'recipients'), env, ['player'])
        if (typeof node.distinct !== 'boolean') issue(childPath(path, 'distinct'), 'type', 'expected a boolean')
        return
      case 'revealUntil': {
        exactKeys(node, path, ['kind', 'targets', 'match', 'count', 'bindFound', 'bindRest', 'foundTo', 'rest'], ['kind', 'targets', 'match', 'foundTo', 'rest'])
        validateRecipient(node.targets, childPath(path, 'targets'), env, ['player'])
        if (validateSelector(node.match, childPath(path, 'match'), env) !== 'object') {
          issue(childPath(path, 'match'), 'domain', 'revealUntil requires an object selector')
        }
        if (node.count !== undefined) validateAmount(node.count, childPath(path, 'count'), env)
        if (!Object.values(REVEAL_UNTIL_REST).some(destination => destination === node.rest)) issue(childPath(path, 'rest'), 'unsupported-kind', 'Rule DSL v1 revealUntil requires a supported rest destination')
        if (node.bindFound !== undefined) {
          declareBinding(env, bindingName(node.bindFound, childPath(path, 'bindFound')), { kind: 'choice', domain: 'object' }, childPath(path, 'bindFound'))
        }
        if (node.bindRest !== undefined) {
          declareBinding(env, bindingName(node.bindRest, childPath(path, 'bindRest')), { kind: 'choice', domain: 'object' }, childPath(path, 'bindRest'))
        }
        return
      }
      case 'sequence':
        exactKeys(node, path, ['kind', 'instructions'], ['kind', 'instructions'])
        validateInstructionList(node.instructions, childPath(path, 'instructions'), env, depth + 1)
        return
      case 'choosePlayer':
        exactKeys(node, path, ['kind', 'chooser', 'filter', 'bindChoice'], ['kind', 'chooser', 'filter', 'bindChoice'])
        validateRecipient(node.chooser, childPath(path, 'chooser'), env, ['player'])
        if (validateSelector(node.filter, childPath(path, 'filter'), env) !== 'player') issue(childPath(path, 'filter'), 'domain', 'choosePlayer requires a player selector')
        declareBinding(env, bindingName(node.bindChoice, childPath(path, 'bindChoice')), { kind: 'choice', domain: 'player' }, childPath(path, 'bindChoice'))
        return
      case 'forEachPlayer':
        exactKeys(node, path, ['kind', 'of', 'instructions'], ['kind', 'of', 'instructions'])
        validateRecipient(node.of, childPath(path, 'of'), env, ['player'])
        validateInstructionList(node.instructions, childPath(path, 'instructions'), withEventPlayer(env), depth + 1)
        return
      case 'forEach':
        exactKeys(node, path, ['kind', 'of', 'instructions'], ['kind', 'of', 'instructions'])
        validateRecipient(node.of, childPath(path, 'of'), env, ['object'])
        validateInstructionList(node.instructions, childPath(path, 'instructions'), withEventPlayer(env), depth + 1)
        return
      case 'chooseInstructions': {
        exactKeys(node, path, ['kind', 'chooser', 'count', 'options', 'whenInsufficient', 'prompt', 'optional'], ['kind', 'chooser', 'count', 'options', 'whenInsufficient'])
        validateReference(node.chooser, childPath(path, 'chooser'), env, ['player'])
        if (node.prompt !== undefined
          && (typeof node.prompt !== 'string' || node.prompt.length === 0 || node.prompt.length > 256)) {
          issue(childPath(path, 'prompt'), 'type', 'instruction choice prompt must be a nonempty string of at most 256 characters')
        }
        if (node.optional !== undefined) {
          if (node.optional !== true) issue(childPath(path, 'optional'), OPTIONAL_ACTION_DIAGNOSTIC_CODE.MARKER, OPTIONAL_ACTION_DIAGNOSTIC_MESSAGE.MARKER)
          const options = Array.isArray(node.options) ? node.options : []
          if (options.length !== 2 || !Array.isArray(options[0]?.instructions)
            || options[0].instructions.length === 0 || !Array.isArray(options[1]?.instructions)
            || options[1].instructions.length !== 0) {
            issue(childPath(path, 'options'), OPTIONAL_ACTION_DIAGNOSTIC_CODE.OPTIONS, OPTIONAL_ACTION_DIAGNOSTIC_MESSAGE.OPTIONS)
          }
        }
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
          exactKeys(optionNode, optionPath, ['instructions', 'label'], ['instructions'])
          if (optionNode.label !== undefined
            && (typeof optionNode.label !== 'string' || optionNode.label.length === 0 || optionNode.label.length > 128)) {
            issue(childPath(optionPath, 'label'), 'type', 'instruction choice label must be a nonempty string of at most 128 characters')
          }
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
      return domain === 'player' && (
        value.name === 'controller'
        || value.name === 'triggering.player'
        || value.name === 'triggering.object.controller'
      )
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
    const hasObjectFields = Object.keys(node).some(key => !['all', 'any', 'not'].includes(key))
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

  const validateStepList = (value: unknown, path: string) => {
    const steps = Array.isArray(value) ? value : [value]
    if (steps.length === 0) {
      issue(path, 'type', 'delayed step requires a step name')
      return
    }
    steps.forEach((step, index) => {
      enumeration(step, Array.isArray(value) ? childPath(path, index) : path, new Set(STEP_IDS), 'step')
    })
  }

  const validateOccurrence = (value: unknown, path: string, baseEnv: Environment): Environment => {
    const env = cloneEnv(baseEnv)
    const node = object(value, path)
    if (!node) return env
    switch (node.kind) {
      case 'event':
        exactKeys(node, path, ['kind', 'type', 'objectId', 'from', 'to'], ['kind', 'type'])
        break
      case 'stepBegins':
        exactKeys(node, path, ['kind', 'step', 'player'], ['kind', 'step'])
        break
      case 'step':
        exactKeys(node, path, ['kind', 'step', 'active'], ['kind', 'step'])
        break
      default:
        exactKeys(node, path, ['kind', 'filter'], ['kind'])
    }
    declarations.push({ path, kind: `occurrence:${String(node.kind)}` })
    switch (node.kind) {
      case 'attacks':
      case 'cast':
        if (node.filter === undefined) issue(childPath(path, 'filter'), 'missing-field', 'required field is missing')
        env.context = new Map([...env.context, ['triggering.object.after', 'object'], ['triggering.player', 'player']])
        validateObjectOccurrenceFilter(node.filter, childPath(path, 'filter'), env)
        return env
      case 'enters':
        if (node.filter === undefined) issue(childPath(path, 'filter'), 'missing-field', 'required field is missing')
        env.context = new Map([...env.context, ['triggering.object.after', 'object']])
        validateObjectOccurrenceFilter(node.filter, childPath(path, 'filter'), env)
        return env
      case 'dies':
        if (node.filter === undefined) issue(childPath(path, 'filter'), 'missing-field', 'required field is missing')
        env.context = new Map([...env.context, ['triggering.object.before', 'object'], ['triggering.object.after', 'object']])
        validateObjectOccurrenceFilter(node.filter, childPath(path, 'filter'), env)
        return env
      case 'leaves':
        if (node.filter === undefined) issue(childPath(path, 'filter'), 'missing-field', 'required field is missing')
        env.context = new Map([...env.context, ['triggering.object.before', 'object']])
        validateObjectOccurrenceFilter(node.filter, childPath(path, 'filter'), env)
        return env
      case 'playLand':
      case 'discard':
      case 'cycle':
      case 'draw': {
        if (node.filter === undefined) issue(childPath(path, 'filter'), 'missing-field', 'required field is missing')
        env.context = new Map([...env.context, ['triggering.player', 'player'], ...(node.kind === 'cycle' ? [['triggering.object.after', 'object'] as const] : [])])
        if (node.kind === 'draw') env.eventAmount = true
        const filter = object(node.filter, childPath(path, 'filter'))
        if (filter) {
          exactKeys(filter, childPath(path, 'filter'), node.kind === 'draw' ? ['player', 'firstDrawInOwnDrawStep'] : node.kind === 'cycle' ? ['player', 'object'] : ['player'])
          if (filter.player !== undefined) validateRecipient(filter.player, childPath(childPath(path, 'filter'), 'player'), env, ['player'])
          if (filter.firstDrawInOwnDrawStep !== undefined && typeof filter.firstDrawInOwnDrawStep !== 'boolean') issue(childPath(childPath(path, 'filter'), 'firstDrawInOwnDrawStep'), 'type', 'expected a boolean')
          if (filter.object !== undefined) validateObjectOccurrenceFilter(filter.object, childPath(childPath(path, 'filter'), 'object'), env)
        }
        return env
      }
      case 'manaAdded':
      case 'manaAbilityActivated':
      case 'manaAbilityResolved':
        return env
      case 'event':
        exactKeys(node, path, ['kind', 'type', 'objectId', 'from', 'to'], ['kind', 'type'])
        if (typeof node.type !== 'string' || node.type.length === 0) issue(childPath(path, 'type'), 'type', 'event occurrence requires an event type')
        if (node.objectId !== undefined) validateReference(node.objectId, childPath(path, 'objectId'), env, ['object'])
        if (node.from !== undefined) enumeration(node.from, childPath(path, 'from'), ZONES, 'source zone')
        if (node.to !== undefined) enumeration(node.to, childPath(path, 'to'), ZONES, 'destination zone')
        return env
      case 'stepBegins':
        enumeration(node.step, childPath(path, 'step'), new Set(STEP_IDS), 'step')
        env.context = new Map([...env.context, ['triggering.player', 'player']])
        if (node.player !== undefined) validateRecipient(node.player, childPath(path, 'player'), env, ['player'])
        return env
      case 'step':
        exactKeys(node, path, ['kind', 'step', 'active'], ['kind', 'step'])
        validateStepList(node.step, childPath(path, 'step'))
        if (node.active !== undefined) {
          validateReference(node.active, childPath(path, 'active'), env, ['player'])
          env.context = new Map([...env.context, ['triggering.player', 'player']])
        }
        return env
      default:
        issue(childPath(path, 'kind'), 'unsupported-kind', `unsupported occurrence kind: ${String(node.kind)}`)
        return env
    }
  }

  const validateEventFieldChanges = (value: unknown, path: string, env: Environment): void => {
    const node = object(value, path)
    if (!node) return
    exactKeys(node, path, ['to', 'tapped', 'amount', 'enterCounters'], [])
    if (node.enterCounters !== undefined) {
      const counters = object(node.enterCounters, childPath(path, 'enterCounters'))
      if (counters) for (const [name, counterAmount] of Object.entries(counters)) {
        if (!name) issue(childPath(path, 'enterCounters'), 'type', 'counter names must be nonempty')
        validateAmount(counterAmount, childPath(childPath(path, 'enterCounters'), name), env)
      }
    }
    if (node.to !== undefined) enumeration(node.to, childPath(path, 'to'), ZONES, 'zone')
    if (node.tapped !== undefined && typeof node.tapped !== 'boolean') {
      issue(childPath(path, 'tapped'), 'type', 'expected a boolean')
    }
  }

  const validateReplacementProgram = (value: unknown, path: string, env: Environment, depth = 0): void => {
    if (depth > MAX_TREE_DEPTH) {
      issue(path, 'depth-limit', `program nesting is limited to ${MAX_TREE_DEPTH}`)
      return
    }
    const optionBindings = new Set<string>()
    const validateList = (list: unknown, listPath: string, bindings: Set<string>, nested: number, programEnv = cloneEnv(env)): void => {
      if (nested > MAX_TREE_DEPTH) {
        issue(listPath, 'depth-limit', `program nesting is limited to ${MAX_TREE_DEPTH}`)
        return
      }
      array(list, listPath).forEach((entry, index) => {
        const entryPath = childPath(listPath, index)
        const node = object(entry, entryPath)
        if (!node) return
        declarations.push({ path: entryPath, kind: `replacementProgram:${String(node.kind)}` })
        switch (node.kind) {
          case 'chooseCards':
          case 'reveal':
          case 'captureAmount':
            validateInstruction(node, entryPath, programEnv, nested)
            return

          case 'choose': {
            exactKeys(node, entryPath, ['kind', 'bindChoice', 'options', 'prompt'], ['kind', 'bindChoice', 'options'])
            const binding = bindingName(node.bindChoice, childPath(entryPath, 'bindChoice'))
            if (binding) {
              if (bindings.has(binding)) issue(childPath(entryPath, 'bindChoice'), 'duplicate-binding', `binding ${binding} is already declared in this program scope`)
              else bindings.add(binding)
            }
            if (node.prompt !== undefined && (typeof node.prompt !== 'string' || node.prompt.length === 0)) {
              issue(childPath(entryPath, 'prompt'), 'type', 'expected a nonempty string')
            }
            const options = array(node.options, childPath(entryPath, 'options'), { nonempty: true })
            const seen = new Set<string>()
            options.forEach((option, optionIndex) => {
              const optionPath = childPath(childPath(entryPath, 'options'), optionIndex)
              const optionNode = object(option, optionPath)
              if (!optionNode) return
              exactKeys(optionNode, optionPath, ['id', 'label'], ['id', 'label'])
              if (typeof optionNode.id !== 'string' || !IDENTIFIER.test(optionNode.id)) {
                issue(childPath(optionPath, 'id'), 'binding-name', 'option ids must start with a letter and contain at most 64 letters, digits, dots, underscores, or hyphens')
              } else if (seen.has(optionNode.id)) {
                issue(childPath(optionPath, 'id'), 'duplicate-binding', `option ${optionNode.id} is already declared`)
              } else seen.add(optionNode.id)
              if (typeof optionNode.label !== 'string' || optionNode.label.length === 0) {
                issue(childPath(optionPath, 'label'), 'type', 'expected a nonempty string')
              }
            })
            return
          }
          case 'branch': {
            exactKeys(node, entryPath, ['kind', 'condition', 'then', 'otherwise'], ['kind', 'condition', 'then'])
            validateCondition(node.condition, childPath(entryPath, 'condition'), programEnv)
            validateList(node.then, childPath(entryPath, 'then'), new Set(bindings), nested + 1, cloneEnv(programEnv))
            if (node.otherwise !== undefined) validateList(node.otherwise, childPath(entryPath, 'otherwise'), new Set(bindings), nested + 1, cloneEnv(programEnv))
            return
          }
          case 'modifyEvent':
            exactKeys(node, entryPath, ['kind', 'changes'], ['kind', 'changes'])
            validateEventFieldChanges(node.changes, childPath(entryPath, 'changes'), programEnv)
            return
          case 'payLife':
            exactKeys(node, entryPath, ['kind', 'amount'], ['kind', 'amount'])
            validateAmount(node.amount, childPath(entryPath, 'amount'), programEnv)
            return
          case 'emit':
            exactKeys(node, entryPath, ['kind', 'instructions'], ['kind', 'instructions'])
            validateInstructionList(node.instructions, childPath(entryPath, 'instructions'), programEnv)
            return
          default:
            issue(childPath(entryPath, 'kind'), 'unsupported-kind', `unsupported replacement program kind: ${String(node.kind)}`)
        }
      })
    }
    validateList(value, path, optionBindings, depth)
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
      if (decisionsResult.modeDeclared) issue(childPath(path, 'decisions.modes'), 'modal-structure', 'mode decisions require a modal program')
      validateInstructionList(ability.instructions, childPath(path, 'instructions'), decisionsResult.env)
      return
    }
    if (!decisionsResult.modeDeclared) issue(childPath(path, 'decisions.modes'), 'modal-structure', 'modal programs require decisions.modes')
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

  const preventionFollowUpEnvironment = (env: Environment) => {
    const next = cloneEnv(env)
    next.eventAmount = true
    next.context = new Map([
      ...next.context,
      ['triggering.player', 'player'],
      ['triggering.object.after', 'object'],
      ['triggering.object.controller', 'player'],
    ])
    return next
  }

  const validateAbility = (value: unknown, path: string): void => {
    const ability = object(value, path)
    if (!ability) return
    declarations.push({ path, kind: `ability:${String(ability.kind)}` })
    const commonProgramKeys = ['kind', 'decisions', 'costs', 'optionalCosts', 'alternativeCosts', 'costIncreases', 'costReductions', 'instructions', 'modes']
    const validateCostPlan = (node: Record<string, unknown>, nodePath: string, env: Environment) => {
      if (node.optionalCosts !== undefined) array(node.optionalCosts, childPath(nodePath, 'optionalCosts')).forEach((cost, index) => validateCost(cost, `${nodePath}.optionalCosts[${index}]`, env))
      if (node.alternativeCosts !== undefined) array(node.alternativeCosts, childPath(nodePath, 'alternativeCosts')).forEach((alternative, alternativeIndex) =>
        array(alternative, `${nodePath}.alternativeCosts[${alternativeIndex}]`).forEach((cost, index) => validateCost(cost, `${nodePath}.alternativeCosts[${alternativeIndex}][${index}]`, env)))
      if (node.costIncreases !== undefined) array(node.costIncreases, childPath(nodePath, 'costIncreases')).forEach((increase, index) => {
        const entry = object(increase, `${nodePath}.costIncreases[${index}]`)
        if (entry) exactKeys(entry, `${nodePath}.costIncreases[${index}]`, ['amount', 'reason'], ['amount'])
      })
      if (node.costReductions !== undefined) array(node.costReductions, childPath(nodePath, 'costReductions')).forEach((reduction, index) => {
        const entry = object(reduction, `${nodePath}.costReductions[${index}]`)
        if (entry) exactKeys(entry, `${nodePath}.costReductions[${index}]`, ['generic', 'reason'], ['generic'])
      })
    }
    switch (ability.kind) {
      case 'spell': {
        exactKeys(ability, path, commonProgramKeys, ['kind', 'decisions', 'costs'])
        const result = validateDecisions(ability.decisions, childPath(path, 'decisions'), baseEnvironment(), true)
        const costEnv: Environment = { ...cloneEnv(result.env), targets: [], targetSingleton: [], locals: new Map() }
        array(ability.costs, childPath(path, 'costs')).forEach((cost, index) => validateCost(cost, childPath(childPath(path, 'costs'), index), costEnv))
        validateCostPlan(ability, path, costEnv)
        validateProgram(ability, path, result)
        return
      }
      case 'activated': {
        exactKeys(ability, path, [...commonProgramKeys, 'availableFrom', 'timing', 'cycling'], ['kind', 'availableFrom', 'timing', 'decisions', 'costs'])
        array(ability.availableFrom, childPath(path, 'availableFrom'), { nonempty: true }).forEach((zone, index) =>
          enumeration(zone, childPath(childPath(path, 'availableFrom'), index), ZONES, 'zone'))
        enumeration(ability.timing, childPath(path, 'timing'), new Set(['anyTime', 'sorcery']), 'activation timing')
        if (ability.cycling !== undefined && ability.cycling !== true) issue(childPath(path, 'cycling'), 'constant', 'cycling must be true when present')
        const result = validateDecisions(ability.decisions, childPath(path, 'decisions'), baseEnvironment(), true)
        const costEnv: Environment = { ...cloneEnv(result.env), targets: [], targetSingleton: [], locals: new Map() }
        array(ability.costs, childPath(path, 'costs')).forEach((cost, index) => validateCost(cost, childPath(childPath(path, 'costs'), index), costEnv))
        validateCostPlan(ability, path, costEnv)
        validateProgram(ability, path, result)
        return
      }
      case 'triggered': {
        exactKeys(ability, path, ['kind', 'generated', 'capturedBindings', 'activeIn', 'on', 'triggerOnlyIf', 'interveningIf', 'frequency', 'manaAbility', 'decisions', 'instructions', 'modes'], ['kind', 'activeIn', 'on', 'decisions'])
        if (ability.generated !== undefined && ability.generated !== true) issue(childPath(path, 'generated'), 'constant', 'generated must be true when present')
        if (ability.capturedBindings !== undefined && ability.generated !== true) issue(childPath(path, 'capturedBindings'), 'unsupported-kind', 'captured bindings are reserved for generated programs')
        array(ability.activeIn, childPath(path, 'activeIn'), { nonempty: true }).forEach((zone, index) =>
          enumeration(zone, childPath(childPath(path, 'activeIn'), index), ZONES, 'zone'))
        const occurrenceBase = baseEnvironment()
        if (ability.capturedBindings !== undefined) {
          const captured = object(ability.capturedBindings, childPath(path, 'capturedBindings'))
          if (captured) {
            exactKeys(captured, childPath(path, 'capturedBindings'), ['choices', 'playerChoices', 'results', 'occurrence'])
            const playerChoices = captured.playerChoices === undefined ? [] : array(captured.playerChoices, `${path}.capturedBindings.playerChoices`)
            for (const entry of playerChoices) {
              if (!Array.isArray(captured.choices) || !captured.choices.includes(entry)) issue(`${path}.capturedBindings.playerChoices`, 'unresolved-binding', 'player choices must be declared captured choices')
            }
            if (captured.choices !== undefined) array(captured.choices, childPath(childPath(path, 'capturedBindings'), 'choices')).forEach((entry, index) => {
              const name = bindingName(entry, `${path}.capturedBindings.choices[${index}]`)
              if (name) declareBinding(occurrenceBase, name, { kind: 'choice', domain: playerChoices.includes(name) ? 'player' : 'object' }, `${path}.capturedBindings.choices[${index}]`)
            })
            const capturedResults = captured.results === undefined
              ? undefined
              : object(captured.results, childPath(childPath(path, 'capturedBindings'), 'results'))
            if (capturedResults) for (const [name, fields] of Object.entries(capturedResults)) {
              const resultName = bindingName(name, `${path}.capturedBindings.results.${name}`)
              const fieldList = array(fields, `${path}.capturedBindings.results.${name}`)
                .map((field, index) => enumeration(field, `${path}.capturedBindings.results.${name}[${index}]`, new Set(['player', 'amount', 'discarded', 'discardedCount', 'countered', 'paid', 'moved', 'destroyed', 'sacrificed', 'created']), 'result field') as ResultField | undefined)
                .filter((field): field is ResultField => field !== undefined)
              if (resultName) declareBinding(occurrenceBase, resultName, {
                kind: 'result',
                domain: fieldList.includes('player') ? 'player' : fieldList.some((field) => field === 'discardedCount' || field === 'created') ? 'number' : 'boolean',
                fields: new Set(fieldList),
              }, `${path}.capturedBindings.results.${name}`)
            }
            if (captured.occurrence !== undefined) array(captured.occurrence, `${path}.capturedBindings.occurrence`).forEach((entry, index) => {
              enumeration(entry, `${path}.capturedBindings.occurrence[${index}]`, new Set(['player', 'object.before', 'object.after']), 'captured occurrence binding')
              switch (entry) {
                case 'player': occurrenceBase.context = new Map([...occurrenceBase.context, ['triggering.player', 'player']]); break
                case 'object.before': occurrenceBase.context = new Map([...occurrenceBase.context, ['triggering.object.before', 'object']]); break
                case 'object.after': occurrenceBase.context = new Map([...occurrenceBase.context, ['triggering.object.after', 'object']]); break
              }
            })
          }
        }
        const occurrenceEnv = ability.generated === true
          ? preventionFollowUpEnvironment(validateOccurrence(ability.on, childPath(path, 'on'), occurrenceBase))
          : validateOccurrence(ability.on, childPath(path, 'on'), occurrenceBase)
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
          switch (node.kind) {
            case 'prohibitActivation': {
              exactKeys(node, effectPath, ['kind', 'filter'], ['kind', 'filter'])
              const filter = object(node.filter, childPath(effectPath, 'filter'))
              if (!filter) return
              exactKeys(filter, childPath(effectPath, 'filter'), ['abilitySource', 'activator'])
              if (filter.abilitySource !== undefined) validateObjectFilter(filter.abilitySource, childPath(childPath(effectPath, 'filter'), 'abilitySource'), baseEnvironment())
              if (filter.activator !== undefined) validatePlayerFilter(filter.activator, childPath(childPath(effectPath, 'filter'), 'activator'), baseEnvironment())
              return
            }
            case 'noMaximumHandSize': {
              exactKeys(node, effectPath, ['kind'], ['kind'])
              return
            }
            case 'extraLandPlays': {
              exactKeys(node, effectPath, ['kind', 'count'], ['kind', 'count'])
              const count = node.count
              if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
                issue(childPath(effectPath, 'count'), 'domain', 'extraLandPlays count must be a positive integer')
              }
              return
            }
            case 'modifyStats': {
              exactKeys(node, effectPath, ['kind', 'targets', 'power', 'toughness', 'set'], ['kind', 'targets', 'power', 'toughness'])
              if (validateSelector(node.targets, childPath(effectPath, 'targets'), baseEnvironment()) !== 'object') {
                issue(childPath(effectPath, 'targets'), 'domain', 'modifyStats targets require an object selector')
              }
              validateStatDelta(node.power, childPath(effectPath, 'power'), baseEnvironment())
              validateStatDelta(node.toughness, childPath(effectPath, 'toughness'), baseEnvironment())
              if (node.set !== undefined && typeof node.set !== 'boolean') {
                issue(childPath(effectPath, 'set'), 'type', 'expected a boolean')
              }
              return
            }
            case 'replacement': {
              exactKeys(node, effectPath, ['kind', 'event', 'transform', 'when', 'optional', 'program'], ['kind', 'event', 'transform'])
              if (isData(node.transform) && node.transform.kind === 'modifyEvent' && isData(node.transform.changes) && node.transform.changes.enterCounters !== undefined) validateEventFieldChanges(node.transform.changes, `${effectPath}.transform.changes`, baseEnvironment())
              if (node.when !== undefined) validateCondition(node.when, childPath(effectPath, 'when'), baseEnvironment())
              if (node.program !== undefined) validateReplacementProgram(node.program, childPath(effectPath, 'program'), baseEnvironment())
              return
            }
            case 'prevention': {
              exactKeys(node, effectPath, ['kind', 'filter', 'capacity', 'transform', 'additionalEffects'], ['kind', 'filter', 'capacity', 'transform'])
              validatePreventionFilter(node.filter, childPath(effectPath, 'filter'), baseEnvironment())
              validatePreventionCapacity(node.capacity, childPath(effectPath, 'capacity'), baseEnvironment())
              const transform = object(node.transform, childPath(effectPath, 'transform'))
              if (transform && transform.kind !== 'preventDamage') {
                issue(childPath(effectPath, 'transform'), 'unsupported-kind', 'prevention requires preventDamage transform')
              }
              if (node.additionalEffects !== undefined) {
                validateInstructionList(
                  node.additionalEffects,
                  childPath(effectPath, 'additionalEffects'),
                  preventionFollowUpEnvironment(baseEnvironment()),
                )
              }
              return
            }
            default:
              issue(childPath(effectPath, 'kind'), 'unsupported-kind', `unsupported continuous effect kind: ${String(node.kind)}`)
          }
        })
        return
      }
      case 'keyword':
        exactKeys(ability, path, ['kind', 'keyword', 'when'], ['kind', 'keyword'])
        enumeration(ability.keyword, childPath(path, 'keyword'), new Set(Object.values(KEYWORDS)), 'keyword')
        if (ability.when !== undefined) validateCondition(ability.when, childPath(path, 'when'), baseEnvironment())
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

export function assertDefinitionV1(
  value: unknown,
  diagnostics: readonly RuleDslDiagnostic[],
): asserts value is CardRuleDefinitionV1 {
  if (diagnostics.length > 0) throw new RuleDslValidationError(diagnostics)
}
