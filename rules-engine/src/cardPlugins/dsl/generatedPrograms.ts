import { definitionRevisionFor } from './builders/revision'
import { RULE_DSL_SCHEMA_VERSION, type GeneratedAbility, type Instruction, type TriggeredAbilityDefinition } from './schema/v1'

/**
 * Generated abilities are stored outside a card definition because their
 * recipient is the source permanent.  The canonical driver still expects a
 * definition snapshot, so give each generated program a small, content pinned
 * wrapper.  A delayed program's event/step condition is already matched by
 * the delayed-trigger registry; its wrapper only needs a valid trigger shape.
 */
export const generatedAbilitySnapshot = (
  ability: GeneratedAbility,
  inheritedDecisions: GeneratedAbility['decisions'] = ability.decisions,
  capturedBindings?: {
    choices?: readonly string[]
    results?: Readonly<Record<string, readonly import('./schema/v1').ResultField[]>>
  },
) => {
  let on: TriggeredAbilityDefinition['on']
  switch (ability.on.kind) {
    case 'enters':
    case 'dies':
    case 'draw':
    case 'manaAdded':
    case 'manaAbilityActivated':
    case 'manaAbilityResolved':
      on = ability.on
      break
    default:
      on = { kind: 'draw', filter: {} }
  }
  const generated: TriggeredAbilityDefinition = {
    kind: 'triggered',
    generated: true,
    ...(capturedBindings ?? ability.capturedBindings ? { capturedBindings: capturedBindings ?? ability.capturedBindings } : {}),
    activeIn: ['battlefield'],
    on,
    decisions: {
      targets: inheritedDecisions?.targets ?? [],
      ...(inheritedDecisions?.constraints ? { constraints: inheritedDecisions.constraints } : {}),
      ...(inheritedDecisions?.variables ? { variables: inheritedDecisions.variables } : {}),
      ...(inheritedDecisions?.distributions ? { distributions: inheritedDecisions.distributions } : {}),
    },
    instructions: ability.instructions,
  }
  const definitionRevision = definitionRevisionFor({
    schemaVersion: RULE_DSL_SCHEMA_VERSION,
    abilities: [generated],
  })
  return {
    schemaVersion: RULE_DSL_SCHEMA_VERSION,
    definitionRevision,
    definition: {
      schemaVersion: RULE_DSL_SCHEMA_VERSION,
      definitionRevision,
      abilities: [generated],
    },
  }
}

type CapturedChoice = readonly ({ kind: 'object' } & { objectId: string; incarnation?: number; zone?: import('../../types').ZoneId })[]

type CapturedBindingAliases = {
  choiceAliases: Record<string, string>
  resultAliases: Record<string, string>
}

type RewrittenInstructions = {
  instructions: Instruction[]
  shadowed: Set<string>
}

const bindingAlias = (kind: 'choice' | 'result', binding: string, used: Set<string>) => {
  const safe = binding.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'binding'
  let candidate = `captured${kind === 'choice' ? 'Choice' : 'Result'}_${safe}`
  let suffix = 2
  while (used.has(candidate)) candidate = `captured${kind === 'choice' ? 'Choice' : 'Result'}_${safe}_${suffix++}`
  used.add(candidate)
  return candidate
}

const inspectBindings = (value: unknown, choices: Set<string>, results: Map<string, Set<string>>, used: Set<string>) => {
  if (Array.isArray(value)) {
    value.forEach((part) => inspectBindings(part, choices, results, used))
    return
  }
  if (!value || typeof value !== 'object') return
  const node = value as Record<string, unknown>
  if (node.kind === 'choiceRef' && typeof node.binding === 'string') choices.add(node.binding)
  if (node.kind === 'resultRef' && typeof node.binding === 'string') {
    const fields = results.get(node.binding) ?? new Set<string>()
    if (typeof node.field === 'string') fields.add(node.field)
    results.set(node.binding, fields)
  }
  if (typeof node.bindChoice === 'string') used.add(node.bindChoice)
  if (typeof node.bindResult === 'string') used.add(node.bindResult)
  Object.values(node).forEach((part) => inspectBindings(part, choices, results, used))
}

const rewriteInstructions = (
  instructions: readonly Instruction[],
  choiceAliases: Readonly<Record<string, string>>,
  resultAliases: Readonly<Record<string, string>>,
  inheritedShadowed = new Set<string>(),
): RewrittenInstructions => {
  const shadowed = new Set(inheritedShadowed)
  const rewriteValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewriteValue)
    if (!value || typeof value !== 'object') return value
    const node = value as Record<string, unknown>
    if (node.kind === 'choiceRef' && typeof node.binding === 'string') {
      const alias = choiceAliases[node.binding]
      return alias && !shadowed.has(node.binding) ? { ...node, binding: alias } : node
    }
    if (node.kind === 'resultRef' && typeof node.binding === 'string') {
      const alias = resultAliases[node.binding]
      return alias && !shadowed.has(node.binding) ? { ...node, binding: alias } : node
    }
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, rewriteValue(child)]))
  }
  const rewritten = instructions.map((instruction) => {
    if (instruction.kind === 'sequence') {
      const nested = rewriteInstructions(instruction.instructions, choiceAliases, resultAliases, shadowed)
      nested.shadowed.forEach((name) => shadowed.add(name))
      return { ...instruction, instructions: nested.instructions }
    }
    if (instruction.kind === 'if') {
      return {
        ...instruction,
        condition: rewriteValue(instruction.condition) as typeof instruction.condition,
        then: rewriteInstructions(instruction.then, choiceAliases, resultAliases, new Set(shadowed)).instructions,
        otherwise: rewriteInstructions(instruction.otherwise, choiceAliases, resultAliases, new Set(shadowed)).instructions,
      }
    }
    if (instruction.kind === 'chooseInstructions') {
      return {
        ...instruction,
        chooser: rewriteValue(instruction.chooser) as typeof instruction.chooser,
        options: instruction.options.map((option) => ({
          ...option,
          instructions: rewriteInstructions(option.instructions, choiceAliases, resultAliases, new Set(shadowed)).instructions,
        })),
      }
    }
    const rewrittenInstruction = rewriteValue(instruction) as Instruction
    if ('bindChoice' in instruction && typeof instruction.bindChoice === 'string') shadowed.add(instruction.bindChoice)
    if ('bindResult' in instruction && typeof instruction.bindResult === 'string') shadowed.add(instruction.bindResult)
    return rewrittenInstruction
  })
  return { instructions: rewritten, shadowed }
}

export const rewriteCapturedReferences = (
  value: unknown,
  choiceAliases: Readonly<Record<string, string>>,
  resultAliases: Readonly<Record<string, string>>,
) => {
  const rewrite = (part: unknown): unknown => {
    if (Array.isArray(part)) return part.map(rewrite)
    if (!part || typeof part !== 'object') return part
    const node = part as Record<string, unknown>
    if (node.kind === 'choiceRef' && typeof node.binding === 'string' && choiceAliases[node.binding]) {
      return { ...node, binding: choiceAliases[node.binding] }
    }
    if (node.kind === 'resultRef' && typeof node.binding === 'string' && resultAliases[node.binding]) {
      return { ...node, binding: resultAliases[node.binding] }
    }
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, rewrite(child)]))
  }
  return rewrite(value)
}

/** Capture parent lexical bindings as ordinary generated-program locals.
 *
 * Choices remain choice references throughout compilation and resolution.  The
 * declarations are internal generated instructions which validate their type
 * and leave the captured frame value untouched at runtime.  Aliases isolate
 * parent locals from bindings declared by the generated program itself.
 */
export const captureLexicalBindings = (
  instructions: readonly Instruction[],
  choices: Readonly<Record<string, CapturedChoice>> = {},
  results: Readonly<Record<string, boolean | number>> = {},
  additionalValues: readonly unknown[] = [],
) => {
  const referencedChoices = new Set<string>()
  const referencedResults = new Map<string, Set<string>>()
  const usedBindings = new Set<string>([...Object.keys(choices), ...Object.keys(results)])
  inspectBindings(instructions, referencedChoices, referencedResults, usedBindings)
  additionalValues.forEach((value) => inspectBindings(value, referencedChoices, referencedResults, usedBindings))
  const choiceAliases: Record<string, string> = {}
  const resultAliases: Record<string, string> = {}
  referencedChoices.forEach((binding) => {
    if (choices[binding] !== undefined) choiceAliases[binding] = bindingAlias('choice', binding, usedBindings)
  })
  referencedResults.forEach((_fields, binding) => {
    if (results[binding] !== undefined) resultAliases[binding] = bindingAlias('result', binding, usedBindings)
  })
  const rewritten = rewriteInstructions(instructions, choiceAliases, resultAliases)
  const rewrittenAdditionalValues = additionalValues.map((value) => rewriteCapturedReferences(value, choiceAliases, resultAliases))
  const declarations: Instruction[] = [
    ...Object.values(choiceAliases).map((binding) => ({ kind: 'captureChoice' as const, binding })),
    ...Object.entries(resultAliases).flatMap(([original, binding]) => {
      const fields = referencedResults.get(original)
      const field = fields?.values().next().value as import('./schema/v1').ResultField | undefined
      return [{ kind: 'captureResult' as const, binding, field: field ?? 'paid' }]
    }),
  ]
  return {
    instructions: [...declarations, ...rewritten.instructions],
    choiceAliases,
    resultAliases,
    rewrittenAdditionalValues,
    capturedBindings: {
      ...(Object.keys(choiceAliases).length > 0 ? { choices: Object.values(choiceAliases) } : {}),
      ...(Object.keys(resultAliases).length > 0
        ? {
            results: Object.fromEntries(Object.entries(resultAliases).map(([original, alias]) => [
              alias,
              [...(referencedResults.get(original) ?? new Set<string>())] as import('./schema/v1').ResultField[],
            ])),
          }
        : {}),
    },
  }
}
