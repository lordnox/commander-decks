import type {
  CardRuleDefinitionSnapshotV1,
  CardRuleDefinitionV1,
  CompiledCardRuleDefinitionV1,
} from '../schema/v1'
import { RULE_DSL_SCHEMA_VERSION } from '../schema/v1'
import { cloneJsonData, deepFreezeData, inspectJsonData } from './data'
import { RuleDslValidationError } from './errors'
import { asDefinitionV1, validateDefinitionV1 } from './validate'

export { evaluateAmount, evaluateTargetBounds, MAX_EXPRESSION_DEPTH, MAX_LITERAL_AMOUNT, MAX_RUNTIME_AMOUNT } from './evaluate'
export * from './runtime'
export { RuleDslEvaluationError, RuleDslValidationError } from './errors'
export type { RuleDslDiagnostic } from './errors'

export const RULE_DSL_V1_CAPABILITIES = Object.freeze({
  canonicalLoad: true as const,
  serialization: true as const,
  runtimeExecution: Object.freeze({
    abilityKinds: Object.freeze(['spell'] as const),
    instructionKinds: Object.freeze(['counter', 'damage', 'destroy', 'draw', 'gainLife', 'loseLife', 'sequence'] as const),
    decisions: 'fullySuppliedTargets' as const,
  }),
})

export const compileCardRuleDefinition = (input: unknown): CompiledCardRuleDefinitionV1 => {
  const dataDiagnostics = inspectJsonData(input)
  if (dataDiagnostics.length > 0) throw new RuleDslValidationError(dataDiagnostics)
  const copy = cloneJsonData(input)
  const { diagnostics, declarations } = validateDefinitionV1(copy)
  if (diagnostics.length > 0) throw new RuleDslValidationError(diagnostics)
  const definition = deepFreezeData(asDefinitionV1(copy))
  return Object.freeze({
    schemaVersion: RULE_DSL_SCHEMA_VERSION,
    definitionRevision: definition.definitionRevision,
    definition,
    declarations: Object.freeze(declarations.map((entry) => Object.freeze({ ...entry }))),
    capabilities: RULE_DSL_V1_CAPABILITIES,
  })
}

export const createDefinitionSnapshot = (
  compiled: CompiledCardRuleDefinitionV1,
): CardRuleDefinitionSnapshotV1 => deepFreezeData(cloneJsonData({
  schemaVersion: compiled.schemaVersion,
  definitionRevision: compiled.definitionRevision,
  definition: compiled.definition,
}))

export const loadDefinitionSnapshot = (input: unknown): CompiledCardRuleDefinitionV1 => {
  const diagnostics = inspectJsonData(input)
  if (diagnostics.length > 0) throw new RuleDslValidationError(diagnostics)
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new RuleDslValidationError([{ path: '$', code: 'type', message: 'expected a definition snapshot object' }])
  }
  const snapshot = input as Record<string, unknown>
  const snapshotDiagnostics = [] as Array<{ path: string; code: string; message: string }>
  for (const key of Object.keys(snapshot)) if (!['schemaVersion', 'definitionRevision', 'definition'].includes(key)) {
    snapshotDiagnostics.push({ path: `$.${key}`, code: 'unknown-field', message: 'field is not part of a Rule DSL v1 snapshot' })
  }
  for (const key of ['schemaVersion', 'definitionRevision', 'definition']) if (!(key in snapshot)) {
    snapshotDiagnostics.push({ path: `$.${key}`, code: 'missing-field', message: 'required field is missing' })
  }
  if (snapshot.schemaVersion !== RULE_DSL_SCHEMA_VERSION) {
    snapshotDiagnostics.push({ path: '$.schemaVersion', code: 'unsupported-version', message: `unsupported Rule DSL schema version: ${String(snapshot.schemaVersion)}` })
  }
  const compiled = compileCardRuleDefinition(snapshot.definition)
  if (snapshot.definitionRevision !== compiled.definitionRevision) {
    snapshotDiagnostics.push({ path: '$.definitionRevision', code: 'definition-revision', message: 'snapshot revision does not match its bundled definition' })
  }
  if (snapshot.schemaVersion !== compiled.schemaVersion) {
    snapshotDiagnostics.push({ path: '$.schemaVersion', code: 'unsupported-version', message: 'snapshot schema version does not match its bundled definition' })
  }
  if (snapshotDiagnostics.length > 0) throw new RuleDslValidationError(snapshotDiagnostics)
  return compiled
}

export const serializeCardRuleDefinition = (definition: CardRuleDefinitionV1): string =>
  JSON.stringify(compileCardRuleDefinition(definition).definition)
