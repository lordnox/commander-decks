import { FINDING_CODE, FINDING_MESSAGE } from './constants'
import { parse } from '@babel/parser'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, posix } from 'node:path'

export const BASELINE_PATH = 'rules-engine/migration/dsl-authoring-baseline.json' as const
const LEGACY_ROOT = 'rules-engine/src/cardPlugins/' as const
const CANONICAL_ROOT = `${LEGACY_ROOT}dsl/` as const
const REGISTRY = `${LEGACY_ROOT}cardRules.ts` as const
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

export const inspectSource = (path: string, source: string) => {
  const ast = parse(source, { sourceType: 'module', plugins: path.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] })
  const findings: Finding[] = []
  const legacyBindings = new Set(['CARD_RULES'])
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') continue
    const target = posix.normalize(posix.join(posix.dirname(path), statement.source.value))
    if (target.startsWith(LEGACY_ROOT) && !target.startsWith(CANONICAL_ROOT)) {
      statement.specifiers.forEach((specifier) => legacyBindings.add(specifier.local.name))
    }
  }
  const add = (code: FindingCode, node: Ast, card?: string) => findings.push({ path, code, digest: digest(node), ...(card === undefined ? {} : { card }) })
  const legacyModule = path.startsWith(LEGACY_ROOT) && !path.startsWith(CANONICAL_ROOT)
  for (const statement of ast.program.body) {
    const node = statement as unknown as Ast
    let registryDeclaration = false
    walk(node, (child) => {
      if (child.type === 'VariableDeclarator' && keyName(child.id) === 'CARD_RULES') registryDeclaration = true
    })
    if (legacyModule && !registryDeclaration && !['ImportDeclaration', 'ExportAllDeclaration', 'TSInterfaceDeclaration', 'TSTypeAliasDeclaration'].includes(node.type)) {
      if (node.type !== 'ExportNamedDeclaration' || node.exportKind !== 'type') add(FINDING_CODE.LEGACY_EXECUTOR, node)
    }
  }
  walk(ast.program as unknown as Ast, (node) => {
    if (path === REGISTRY && node.type === 'VariableDeclarator' && keyName(node.id) === 'CARD_RULES' && isAst(node.init)) {
      for (const property of children(node.init)) add(FINDING_CODE.LEGACY_CARD_REGISTRATION, property, String(keyName(property.key)))
    }
    if (node.type === 'ImportDeclaration' && node.importKind !== 'type' && isAst(node.source)) {
      const target = posix.normalize(posix.join(posix.dirname(path), String(node.source.value)))
      if (target.startsWith(LEGACY_ROOT) && !target.startsWith(CANONICAL_ROOT)) add(FINDING_CODE.LEGACY_RUNTIME_IMPORT, node)
    }
    if (node.type === 'ObjectProperty' && ['effects', 'grantedRules', 'pluginIds', 'handlerIds'].includes(String(keyName(node.key)))) add(FINDING_CODE.LEGACY_BEHAVIOR_PAYLOAD, node)
    if (node.type === 'ObjectExpression') {
      const properties = children(node)
      const custom = properties.some((child) => keyName(child.key) === 'type' && keyName(child.value) === 'custom')
      const picker = properties.some((child) => keyName(child.key) === 'name' && /pick|select|choos|choice|target/i.test(String(keyName(child.value))))
      if (custom && picker) add(FINDING_CODE.CUSTOM_PICKER_EVENT, node)
    }
    if (['CallExpression', 'AssignmentExpression', 'UpdateExpression'].includes(node.type)) {
      let legacyUse = false
      const target = node.callee ?? node.left ?? node.argument
      if (isAst(target)) walk(target, (child) => { if (child.type === 'Identifier' && legacyBindings.has(String(child.name))) legacyUse = true })
      if (legacyUse) add(FINDING_CODE.LEGACY_RUNTIME_USE, node)
    }
    if (['BinaryExpression', 'SwitchStatement', 'CallExpression'].includes(node.type)) {
      let name = false
      let literal = false
      walk(node, (child) => {
        if (['MemberExpression', 'OptionalMemberExpression'].includes(child.type) && keyName(child.property) === 'name' && keyName(child.object) !== 'event') name = true
        if (child.type === 'StringLiteral') literal = true
      })
      if (name && literal) add(FINDING_CODE.LITERAL_NAME_DISPATCH, node)
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
