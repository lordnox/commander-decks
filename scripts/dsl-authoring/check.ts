import { FINDING_CODE, FINDING_MESSAGE } from './constants'
import { parse } from '@babel/parser'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, posix } from 'node:path'

export const BASELINE_PATH = 'rules-engine/migration/dsl-authoring-baseline.json' as const
const LEGACY_ROOT = 'rules-engine/src/cardPlugins/' as const
const CANONICAL_ROOT = `${LEGACY_ROOT}dsl/` as const
const SOURCE_ROOTS = ['rules-engine/src', 'live-runner/src', 'site/src', 'shared', '.agents'] as const

type Ast = { type: string; [key: string]: unknown }
type FindingCode = typeof FINDING_CODE[keyof typeof FINDING_CODE]
export type Finding = { path: string; code: FindingCode; digest: string; card?: string }
const isAst = (value: unknown): value is Ast =>
  value !== null && typeof value === 'object' && 'type' in value && typeof value.type === 'string'
const children = (node: Ast) => Object.values(node).flatMap((value) =>
  Array.isArray(value) ? value.filter(isAst) : isAst(value) ? [value] : [])
const walk = (node: Ast, visit: (node: Ast) => void) => {
  visit(node)
  children(node).forEach((child) => walk(child, visit))
}
// Ignore formatting, locations and comments, preserving executable AST fields.
const semantic = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(semantic)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['start', 'end', 'loc', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens'].includes(key))
    .map(([key, child]) => [key, semantic(child)]))
  return value
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(semantic(value))).digest('hex')
const keyName = (node: unknown) => isAst(node) ? node.name ?? node.value : undefined

const member = (node: unknown) => isAst(node) && ['MemberExpression', 'OptionalMemberExpression'].includes(node.type)
const isName = (node: unknown) => member(node) && isAst(node) && keyName(node.property) === 'name' && keyName(node.object) !== 'event'
const isString = (node: unknown) => isAst(node) && node.type === 'StringLiteral'
// Resolve both directory barrels and explicit index files before classifying imports.
const modulePath = (path: string, imported: string) =>
  posix.normalize(posix.join(posix.dirname(path), imported)).replace(/\.[cm]?[jt]sx?$/, '').replace(/\/index$/, '')
const inModule = (path: string, root: string) => path === root || path.startsWith(`${root}/`)
const legacyRoot = LEGACY_ROOT.slice(0, -1)
const canonicalRoot = CANONICAL_ROOT.slice(0, -1)
const CANONICAL_RUNTIME = new Set([
  'rules-engine/src/driver.ts',
  'rules-engine/src/replacement/canonical.ts',
])
const skipsNameDispatch = (file: string) => inModule(file, canonicalRoot) || CANONICAL_RUNTIME.has(file)

export const inspectSource = (path: string, source: string) => {
  const ast = parse(source, { sourceType: 'module', plugins: path.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] })
  const findings: Finding[] = []
  const registries = new Set(['CARD_RULES'])
  const registryNamespaces = new Set<string>()
  const constructors = new Set<string>()
  const constructorNamespaces = new Set<string>()
  const literalObjects = new Map<string, Ast>()
  const directWriteTargets = new Set<Ast>()
  const registryProperties = new Set<Ast>()
  const topLevelProperties = new Set<Ast>()
  for (const statement of ast.program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declaration?.type !== 'VariableDeclaration') continue
    for (const variable of declaration.declarations) {
      if (variable.init?.type === 'ObjectExpression') {
        children(variable.init as unknown as Ast).forEach((property) => topLevelProperties.add(property))
      }
    }
  }
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') continue
    const target = modulePath(path, statement.source.value)
    if (!inModule(target, legacyRoot) || inModule(target, canonicalRoot)) continue
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportSpecifier' && specifier.importKind === 'type') continue
      if (target === `${legacyRoot}/cardRules`) {
        if (specifier.type === 'ImportNamespaceSpecifier') registryNamespaces.add(specifier.local.name)
        if (specifier.type === 'ImportSpecifier' && keyName(specifier.imported) === 'CARD_RULES') registries.add(specifier.local.name)
      }
      // Legacy constructors matter when used to author a configuration, not when
      // imported or called inside generic engine implementation.
      if (target === `${legacyRoot}/effects` || target === `${legacyRoot}/effectBuilders`) {
        if (specifier.type === 'ImportNamespaceSpecifier') constructorNamespaces.add(specifier.local.name)
        else constructors.add(specifier.local.name)
      }
    }
  }
  const isRegistry = (node: unknown): boolean => {
    if (!isAst(node)) return false
    if (node.type === 'Identifier') return registries.has(String(node.name))
    return member(node) && (isRegistry(node.object)
      || (keyName(node.property) === 'CARD_RULES' && registryNamespaces.has(String(keyName(node.object)))))
  }
  const usesConstructor = (node: Ast) => {
    let found = false
    walk(node, (child) => {
      if (child.type !== 'CallExpression' || !isAst(child.callee)) return
      if (constructors.has(String(keyName(child.callee)))
        || (member(child.callee) && constructorNamespaces.has(String(keyName(child.callee.object))))) found = true
    })
    return found
  }
  const add = (code: FindingCode, node: Ast, card?: string) => {
    // Canonical compiler/runtime names identify bindings and variables, not card dispatch.
    if (code === FINDING_CODE.LITERAL_NAME_DISPATCH && skipsNameDispatch(path)) return
    findings.push({ path, code, digest: digest(node), ...(card === undefined ? {} : { card }) })
  }
  const program = ast.program as unknown as Ast
  walk(program, (node) => {
    // A simple assignment writes a data-map entry; compound assignments also
    // read it. Keep inspecting the right-hand side for actual dispatch.
    if (node.type === 'AssignmentExpression' && node.operator === '=' && isAst(node.left)) {
      directWriteTargets.add(node.left)
    }
    if (node.type !== 'VariableDeclarator' || !isAst(node.init)) return
    if (isRegistry(node.init)) registries.add(String(keyName(node.id)))
    if (node.init.type === 'ObjectExpression') {
      literalObjects.set(String(keyName(node.id)), node.init)
      if (registries.has(String(keyName(node.id)))) children(node.init).forEach((property) => registryProperties.add(property))
    }
  })
  const nameComparison = (node: Ast) => node.type === 'BinaryExpression'
    && ['===', '!==', '==', '!='].includes(String(node.operator))
    && ((isName(node.left) && isString(node.right)) || (isString(node.left) && isName(node.right)))
  walk(program, (node) => {
    if (node.type === 'VariableDeclarator' && registries.has(String(keyName(node.id))) && isAst(node.init) && node.init.type === 'ObjectExpression') {
      for (const property of children(node.init)) add(FINDING_CODE.LEGACY_CARD_REGISTRATION, property, String(keyName(property.key)))
    }
    if (node.type === 'AssignmentExpression' && isRegistry(node.left)) add(FINDING_CODE.LEGACY_RUNTIME_USE, node)
    if (node.type === 'CallExpression' && isAst(node.callee)) {
      // Registry mutators, including Object.assign and alias/namespace access.
      const args = Array.isArray(node.arguments) ? node.arguments : []
      if ((member(node.callee) && isRegistry(node.callee.object))
        || (keyName(node.callee.property) === 'assign' && isRegistry(args[0]))) add(FINDING_CODE.LEGACY_RUNTIME_USE, node)
      if (member(node.callee) && keyName(node.callee.property) === 'includes'
        && isAst(node.callee.object) && node.callee.object.type === 'ArrayExpression'
        && children(node.callee.object).some(isString) && args.some(isName)) add(FINDING_CODE.LITERAL_NAME_DISPATCH, node)
    }
    if (nameComparison(node)) add(FINDING_CODE.LITERAL_NAME_DISPATCH, node)
    if (node.type === 'IfStatement' && isAst(node.test)) {
      let dispatch = false
      walk(node.test, (child) => { if (nameComparison(child)) dispatch = true })
      if (dispatch) add(FINDING_CODE.LITERAL_NAME_DISPATCH, node)
    }
    if (node.type === 'SwitchStatement' && isName(node.discriminant)
      && children(node).some((child) => child.type === 'SwitchCase' && isString(child.test))) add(FINDING_CODE.LITERAL_NAME_DISPATCH, node)
    if (member(node) && !directWriteTargets.has(node) && isName(node.property) && isAst(node.object)) {
      const table = node.object.type === 'ObjectExpression' ? node.object : literalObjects.get(String(keyName(node.object)))
      if (table) add(FINDING_CODE.LITERAL_NAME_DISPATCH, table)
    }
    // Literal card-keyed legacy configurations, including alternate registries.
    if (node.type === 'ObjectProperty' && topLevelProperties.has(node) && !registryProperties.has(node) && isAst(node.key)
      && (isString(node.key) || (node.key.type === 'Identifier' && !node.computed)) && isAst(node.value)
      && ['ArrayExpression', 'ObjectExpression'].includes(node.value.type) && usesConstructor(node.value)) add(FINDING_CODE.LEGACY_BEHAVIOR_PAYLOAD, node)
    if (node.type === 'ObjectExpression') {
      const properties = children(node)
      const namedCard = properties.find((child) => keyName(child.key) === 'name' && isString(child.value))
      const authoredBehavior = properties.some((child) => ['effects', 'grantedRules', 'pluginIds', 'handlerIds'].includes(String(keyName(child.key)))
        && isAst(child.value) && ['ArrayExpression', 'ObjectExpression'].includes(child.value.type))
      if (namedCard && authoredBehavior) add(FINDING_CODE.LEGACY_BEHAVIOR_PAYLOAD, node, String(keyName(namedCard.value)))
      const custom = properties.some((child) => keyName(child.key) === 'type' && keyName(child.value) === 'custom')
      const picker = properties.some((child) => keyName(child.key) === 'name' && /pick|select|choos|choice|target/i.test(String(keyName(child.value))))
      if (custom && picker) add(FINDING_CODE.CUSTOM_PICKER_EVENT, node)
    }
  })
  return findings
}

const identity = (finding: Finding) => `${finding.path}:${finding.code}:${finding.card ?? ""}:${finding.digest}`

export const compareFindings = (current: Finding[], baseline: Finding[], requirePruned = true) => {
  const remaining = new Map<string, number>()
  baseline.forEach((item) => remaining.set(identity(item), (remaining.get(identity(item)) ?? 0) + 1))
  const errors: string[] = []
  for (const item of current) {
    const key = identity(item)
    const count = remaining.get(key) ?? 0
    if (count > 0) remaining.set(key, count - 1)
    else errors.push(`${item.path}: ${FINDING_MESSAGE[item.code]}${item.card ? ` (${item.card})` : ""} is new or changed. Use cardPlugins/dsl/v1; add missing reusable nodes and behavior tests. Do not expand the migration baseline.`)
  }
  if (requirePruned) for (const [key, count] of remaining) if (count > 0) errors.push(`${key}: stale allowance; remove it from ${BASELINE_PATH}.`)
  return errors
}

export const sourcePaths = (root: string) => {
  const paths: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && /\.tsx?$/.test(path) && !/\.(test|spec)\.tsx?$/.test(path)) paths.push(path)
    }
  }
  SOURCE_ROOTS.forEach(visit)
  return paths.sort()
}
export const inspectRepository = (root: string) => sourcePaths(root).flatMap((path) => inspectSource(path, readFileSync(resolve(root, path), 'utf8')))
