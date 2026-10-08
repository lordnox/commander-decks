import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { CARD_RULES, cardDefinition } from '../src/cardPlugins/cardRules'
import { builtInPlugins } from '../src/plugins'

type EvidenceStatus =
  | 'confirmed-executable-evidence'
  | 'candidate-test-reference'
  | 'registration-only'
  | 'unobserved'

type Disposition = {
  mechanic: string
  currentRegistrations: string[]
  executableCoverageEvidence: string[]
  candidateEvidence: { matches: number; samples: string[] }
  neededCanonicalNode: string
  compatibilityRoute: string
  ownerPart: string
  dependencyParts: string[]
  status: EvidenceStatus
}

type VariantDisposition = Disposition & {
  variant: string
  handlerDiscovered?: boolean
}

type RegistrationDisposition = Disposition & {
  card: string
  effectVariants: string[]
  instructionVariants: string[]
  pluginIds: string[]
  handlerIds: string[]
  embeddedRulePaths: string[]
}

type SiteDisposition = {
  path: string
  lines: number[]
  samples: string[]
  mechanic: string
  neededCanonicalNode: string
  compatibilityRoute: string
  ownerPart: string
  dependencyParts: string[]
  status: 'legacy-route'
}

type RegistrationUse = {
  effects: Map<string, Set<string>>
  instructions: Map<string, Set<string>>
  embedded: Map<string, Set<string>>
  perCard: Map<string, {
    effectVariants: Set<string>
    instructionVariants: Set<string>
    embeddedRulePaths: Set<string>
  }>
}

const repositoryRoot = resolve(import.meta.dir, '../..')
const outputPath = resolve(repositoryRoot, 'rules-engine/migration/rule-dsl-coverage-ledger.json')
const checkOnly = process.argv.includes('--check')

const posix = (path: string) => path.replaceAll('\\', '/')
const repoPath = (path: string) => posix(relative(repositoryRoot, path))
const sorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b))

const walkFiles = (directory: string, predicate: (path: string) => boolean): string[] => {
  const paths: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) paths.push(...walkFiles(path, predicate))
    else if (predicate(path)) paths.push(path)
  }
  return paths
}

const scanRoots = [
  'rules-engine/src',
  'live-runner/src',
  'site/src',
  'shared',
].map((path) => resolve(repositoryRoot, path))
const sourceFiles = scanRoots.flatMap((root) =>
  walkFiles(root, (path) => path.endsWith('.ts') || path.endsWith('.tsx')))
const productionFiles = sourceFiles.filter((path) =>
  !path.endsWith('.test.ts')
  && !path.endsWith('.test.tsx'))
const testFiles = sourceFiles.filter((path) =>
  path.endsWith('.test.ts') || path.endsWith('.test.tsx'))
const testText = new Map(testFiles.map((path) => [path, readFileSync(path, 'utf8')]))

const aliasDiscriminants = (
  path: string,
  aliasName: string,
  discriminant: string,
) => {
  const text = readFileSync(path, 'utf8')
  const start = text.indexOf(`export type ${aliasName} =`)
  if (start < 0) throw new Error(`missing type alias ${aliasName} in ${repoPath(path)}`)
  const next = text.indexOf('\nexport type ', start + 1)
  const body = text.slice(start, next < 0 ? text.length : next)
  return sorted([...body.matchAll(new RegExp(`\\b${discriminant}:\\s*'([^']+)'`, 'g'))]
    .map((match) => match[1]))
}

const nestedPropertyDiscriminants = (
  path: string,
  aliasName: string,
  property: string,
) => {
  const text = readFileSync(path, 'utf8')
  const start = text.indexOf(`export type ${aliasName} =`)
  const propertyStart = text.indexOf(`${property}:`, start)
  if (start < 0 || propertyStart < 0) throw new Error(`missing ${aliasName}.${property}`)
  const propertyEnd = text.indexOf('\n  prompt:', propertyStart)
  const body = text.slice(propertyStart, propertyEnd < 0 ? text.length : propertyEnd)
  return sorted([...body.matchAll(/\|\s*'([^']+)'/g)].map((match) => match[1]))
}

const effectDefinitions = resolve(repositoryRoot, 'rules-engine/src/cardPlugins/effectDefinitions.ts')
const pendingDialog = resolve(repositoryRoot, 'rules-engine/src/pendingDialog.ts')
const instructionVariants = aliasDiscriminants(effectDefinitions, 'CardInstruction', 'kind')
const effectVariants = aliasDiscriminants(effectDefinitions, 'CardEffect', 'op')
const dialogVariants = nestedPropertyDiscriminants(pendingDialog, 'PendingDialog', 'kind')

const handlerKinds = new Set<string>()
for (const path of productionFiles.filter((candidate) =>
  candidate.includes('/rules-engine/src/cardPlugins/'))) {
  const text = readFileSync(path, 'utf8')
  for (const match of text.matchAll(/InstructionHandler<\s*'([^']+)'\s*>/g)) {
    handlerKinds.add(match[1])
  }
}

const emptyUses = (): RegistrationUse => ({
  effects: new Map(),
  instructions: new Map(),
  embedded: new Map(),
  perCard: new Map(),
})
const uses = emptyUses()
const effectSet = new Set(effectVariants)
const instructionSet = new Set(instructionVariants)

const addUse = (map: Map<string, Set<string>>, key: string, value: string) => {
  const values = map.get(key) ?? new Set<string>()
  values.add(value)
  map.set(key, values)
}

const visitRegistration = (
  card: string,
  value: unknown,
  path: string,
  seen: Set<object>,
) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  const record = value as Record<string, unknown>
  const perCard = uses.perCard.get(card) ?? {
    effectVariants: new Set<string>(),
    instructionVariants: new Set<string>(),
    embeddedRulePaths: new Set<string>(),
  }
  uses.perCard.set(card, perCard)
  if (typeof record.op === 'string' && effectSet.has(record.op)) {
    addUse(uses.effects, record.op, `${card}:${path}`)
    perCard.effectVariants.add(record.op)
  }
  if (typeof record.kind === 'string' && instructionSet.has(record.kind)) {
    addUse(uses.instructions, record.kind, `${card}:${path}`)
    perCard.instructionVariants.add(record.kind)
  }
  if (path.includes('.token.effects') || path.includes('.effects')) {
    const embedded = `${card}:${path}`
    addUse(uses.embedded, 'embedded-effects', embedded)
    perCard.embeddedRulePaths.add(path)
  }
  for (const [key, child] of Object.entries(record)) {
    if (typeof child === 'function') continue
    if (Array.isArray(child)) {
      child.forEach((entry, index) => visitRegistration(card, entry, `${path}.${key}[${index}]`, seen))
    } else {
      visitRegistration(card, child, `${path}.${key}`, seen)
    }
  }
}

for (const [card, effects] of Object.entries(CARD_RULES)) {
  effects.forEach((effect, index) =>
    visitRegistration(card, effect, `effects[${index}]`, new Set<object>()))
}

const testReferences = (needles: string[]) => {
  const references = new Map<string, string>()
  for (const [path, text] of testText) {
    const lines = text.split('\n')
    for (const [index, line] of lines.entries()) {
      if (!needles.some((needle) => line.includes(needle))) continue
      const testLine = lines.slice(0, index + 1).toReversed()
        .find((candidate) => /\b(?:test|it)\s*\(/.test(candidate))
        ?.trim()
      const key = `${repoPath(path)}::${testLine ?? index + 1}`
      if (!references.has(key)) {
        references.set(key, `${repoPath(path)}:${index + 1}${testLine ? ` — ${testLine}` : ''}`)
      }
    }
  }
  return sorted(references.values())
}

const registrationCards = (paths: Iterable<string>) => sorted(
  [...paths].map((entry) => entry.slice(0, entry.indexOf(':'))),
)

const candidateSummary = (references: string[]) => ({
  matches: references.length,
  samples: references.slice(0, 8),
})

const candidateEvidenceFor = (variant: string, registrations: Iterable<string>, discriminant: 'kind' | 'op') => {
  const cards = registrationCards(registrations)
  return candidateSummary(testReferences([
    `${discriminant}: '${variant}'`,
    `${discriminant}: "${variant}"`,
    ...cards.map((card) => `'${card}'`),
    ...cards.map((card) => `"${card}"`),
  ]))
}

const statusFor = (
  registrations: string[],
  evidence: string[],
  candidates: Disposition['candidateEvidence'],
): EvidenceStatus => {
  if (evidence.length > 0) return 'confirmed-executable-evidence'
  if (candidates.matches > 0) return 'candidate-test-reference'
  if (registrations.length > 0) return 'registration-only'
  return 'unobserved'
}

type OwnerDisposition = [mechanic: string, node: string, owner: string, dependencies: string[]]

const instructionDisposition = (variant: string): OwnerDisposition => {
  if (/chooseModes/.test(variant)) return ['scoped announcement modes', 'mode decision plus scoped program', '09', ['05', '08']]
  if (/copy|embalm|encore/.test(variant)) return ['copy and token action', 'typed copy/token action', '07', ['02', '05', '09']]
  if (/delay|nextUpkeep/.test(variant)) return ['delayed program', 'durable delayed/reflexive program', '10', ['03', '05', '06', '07']]
  if (/prevent/.test(variant)) return ['damage prevention', 'prevention instruction/effect', '12', ['07', '11']]
  if (/grant|pump|animate|loseAbilities|lifeTotalCannot|noMaximum|extraLand|attackBan|combatDialogue/.test(variant)) {
    return ['continuous or rule-changing effect', 'typed continuous effect with duration', '13', ['02', '07', '10']]
  }
  if (/pay|Mana|Energy|cast|sacrificeSelf|crew|devour/.test(variant)) {
    return ['cost or announcement action', 'typed cost/payment or nested cast node', '08', ['04', '05', '06', '07']]
  }
  if (/choose|vote|search|reveal|lookTop|Piles|surveil|scry|putFromHand|returnChosen|discardCards|may/.test(variant)) {
    return ['resolution choice', 'typed choice instruction and continuation', '07', ['03', '05']]
  }
  if (/target|Target|fight|remove|destroy|bounce|phaseOut/.test(variant)) {
    return ['target-dependent semantic action', 'shared action primitive consuming a canonical target reference', '07', ['04', '05']]
  }
  if (/draw|mill|discard|life|Life|damage|Damage|counter|sacrifice|Sacrifice|create|token|Token|tap|untap|return|exile|pump|counter|move|goad|monarch|counters|Counters/.test(variant)) {
    return ['semantic game action', 'shared typed action primitive and outcome', '07', ['03']]
  }
  if (/if|repeat|forEach/.test(variant)) return ['structured control flow', 'sequence/condition/loop program node', '07', ['03', '05']]
  return ['specialized legacy instruction', 'new reusable canonical node required before migration', '16', []]
}

const effectDisposition = (variant: string): OwnerDisposition => {
  const table: Record<string, OwnerDisposition> = {
    activate: ['activated ability', 'canonical activated ability and cost plan', '08', ['04', '05', '07']],
    alternateCast: ['alternative casting permission', 'typed casting permission and alternative cost', '08', ['05', '07']],
    castCost: ['casting cost modifier', 'typed cost modifier', '08', ['05', '07']],
    castOption: ['casting option', 'typed announcement option', '08', ['05']],
    dredge: ['draw replacement', 'replacement definition over draw proposals', '14', ['05', '07', '11', '13']],
    handler: ['specialized plugin hook', 'canonical capability-derived plugin requirement', '16', []],
    mana: ['mana condition', 'typed mana ability/cost condition', '08', ['07']],
    manaCapability: ['mana capability', 'typed mana production capability', '08', ['07']],
    modal: ['modal spell program', 'scoped announcement modes', '09', ['05', '08']],
    opponentCastRestriction: ['static casting restriction', 'typed rule restriction', '13', ['08', '10']],
    replacement: ['replacement effect', 'canonical replacement definition', '11', ['05', '07', '10']],
    restrictedMana: ['restricted mana', 'typed mana production and spending restriction', '08', ['07']],
    saga: ['Saga chapters', 'chapter occurrence programs', '06', ['02', '03', '05']],
    search: ['library search choice', 'typed search instruction and continuation', '07', ['03', '05']],
    static: ['static/granted rule', 'canonical static effect or ability grant', '13', ['02', '07', '10']],
    targetedResolve: ['legacy positional targets', 'target clauses and whole-item legality', '04', ['03']],
    trigger: ['triggered ability', 'occurrence pattern and pending trigger program', '06', ['02', '03', '05']],
    xMana: ['X announcement', 'shared variable binding and mana cost', '08', ['04', '05', '07']],
  }
  return table[variant] ?? ['specialized legacy effect', 'new canonical ability/effect node', '16', []]
}

const confirmedVariantEvidence: Record<string, string[]> = {
  'instruction:gainLife': [
    'rules-engine/src/cardPlugins/runInstructions.test.ts — runInstructions > gainLife goes through the life event',
  ],
  'instruction:drawAtNextUpkeep': [
    'rules-engine/src/cardPlugins/runInstructions.test.ts — runInstructions > drawAtNextUpkeep draws on the next upkeep',
  ],
  'effect:modal': [
    'rules-engine/src/cardPlugins/modalSpell.test.ts — modalSpell > Bushwhack opens a mode choice before its instructions run',
  ],
  'effect:trigger': [
    'rules-engine/src/cardPlugins/generalizedTriggers.test.ts — shared trigger matching > death watches another white Knight token using pre-death controller and characteristics',
  ],
}

const makeVariantRows = (
  variants: string[],
  discriminant: 'kind' | 'op',
  registrations: Map<string, Set<string>>,
  disposition: (variant: string) => OwnerDisposition,
): VariantDisposition[] => variants.map((variant) => {
  const currentRegistrations = sorted(registrations.get(variant) ?? [])
  const candidateEvidence = candidateEvidenceFor(variant, currentRegistrations, discriminant)
  const executableCoverageEvidence = confirmedVariantEvidence[`${discriminant === 'kind' ? 'instruction' : 'effect'}:${variant}`] ?? []
  const [mechanic, neededCanonicalNode, ownerPart, dependencyParts] = disposition(variant)
  return {
    variant,
    mechanic,
    currentRegistrations,
    executableCoverageEvidence,
    candidateEvidence,
    neededCanonicalNode,
    compatibilityRoute: discriminant === 'kind'
      ? 'Keep the legacy CardInstruction handler reachable; compile registrations through an adapter only after the canonical node has equivalent execution evidence.'
      : 'Keep the legacy CardEffect route reachable; translate through an explicit adapter only after the owning part proves equivalent semantics.',
    ownerPart,
    dependencyParts,
    status: statusFor(currentRegistrations, executableCoverageEvidence, candidateEvidence),
    ...(discriminant === 'kind' ? { handlerDiscovered: handlerKinds.has(variant) } : {}),
  }
})

const instructionRows = makeVariantRows(
  instructionVariants,
  'kind',
  uses.instructions,
  instructionDisposition,
)
const effectRows = makeVariantRows(effectVariants, 'op', uses.effects, effectDisposition)

const pluginRows: VariantDisposition[] = sorted(builtInPlugins.map((plugin) => plugin.id)).map((variant) => {
  const currentRegistrations = sorted(Object.keys(CARD_RULES).flatMap((card) => {
    const definition = cardDefinition(card)
    return definition?.pluginIds.includes(variant) || definition?.handlerIds.includes(variant)
      ? [card]
      : []
  }))
  const candidateEvidence = candidateSummary(testReferences([
    `id: '${variant}'`,
    `'${variant}'`,
    ...currentRegistrations.map((card) => `'${card}'`),
  ]))
  const directPluginTests = testFiles
    .filter((path) => repoPath(path) === `rules-engine/src/plugins/${variant}.test.ts`
      || repoPath(path) === `rules-engine/src/cardPlugins/${variant}.test.ts`)
    .map((path) => `${repoPath(path)} — dedicated plugin/mechanic suite`)
  const ownerPart = /replacement|phial/.test(variant)
    ? '11'
    : /combat|damage|life|state|continuous|phasing|protection/.test(variant)
      ? '13'
      : '16'
  return {
    variant,
    mechanic: 'runtime plugin hook',
    currentRegistrations,
    executableCoverageEvidence: directPluginTests,
    candidateEvidence,
    neededCanonicalNode: 'capability-derived plugin/runtime requirement; plugin behavior remains shared engine code',
    compatibilityRoute: 'Retain the plugin in the catalogue and derive installation from compiled capabilities before removing name registrations.',
    ownerPart,
    dependencyParts: ownerPart === '16' ? [] : ['07'],
    status: statusFor(currentRegistrations, directPluginTests, candidateEvidence),
  }
})

const dialogRows: VariantDisposition[] = dialogVariants.map((variant) => {
  const candidateEvidence = candidateSummary(testReferences([`kind: '${variant}'`, `stage: '${variant}'`]))
  const executableCoverageEvidence = variant === 'choose-modes'
    ? ['rules-engine/src/cardPlugins/modalSpell.test.ts — modalSpell > Bushwhack opens a mode choice before its instructions run']
    : []
  return {
    variant,
    mechanic: 'specialized legacy dialog',
    currentRegistrations: sorted(productionFiles
      .filter((path) => readFileSync(path, 'utf8').includes(`kind: '${variant}'`))
      .map(repoPath)),
    executableCoverageEvidence,
    candidateEvidence,
    neededCanonicalNode: variant === 'choose-modes'
      ? 'announcement-time selectOptions offer with scoped mode identities'
      : 'typed InteractionRequest offer/answer and server-owned continuation',
    compatibilityRoute: 'Preserve pendingDialog saved-state decoding and host routing until a versioned request adapter restores and answers this dialog kind.',
    ownerPart: variant === 'choose-modes' ? '09' : '05',
    dependencyParts: variant === 'choose-modes' ? ['05', '08'] : ['03'],
    status: statusFor([], executableCoverageEvidence, candidateEvidence),
  }
})

const cardRows: RegistrationDisposition[] = Object.keys(CARD_RULES).sort().map((card) => {
  const definition = cardDefinition(card)
  const perCard = uses.perCard.get(card) ?? {
    effectVariants: new Set<string>(),
    instructionVariants: new Set<string>(),
    embeddedRulePaths: new Set<string>(),
  }
  const candidateEvidence = candidateSummary(testReferences([`'${card}'`, `"${card}"`]))
  const executableCoverageEvidence: string[] = []
  const effectKinds = sorted(perCard.effectVariants)
  const instructionKinds = sorted(perCard.instructionVariants)
  const ownerParts = sorted([
    ...effectKinds.map((variant) => effectDisposition(variant)[2]),
    ...instructionKinds.map((variant) => instructionDisposition(variant)[2]),
    '16',
  ])
  return {
    card,
    mechanic: 'CARD_RULES registration',
    currentRegistrations: [`CARD_RULES.${card}`],
    executableCoverageEvidence,
    candidateEvidence,
    neededCanonicalNode: `canonical definition covering effects [${effectKinds.join(', ')}] and instructions [${instructionKinds.join(', ')}]`,
    compatibilityRoute: 'Keep the name-keyed registration active until Part 16 compiles this card to one pinned canonical definition with equivalent gameplay evidence.',
    ownerPart: '16',
    dependencyParts: ownerParts.filter((part) => part !== '16'),
    status: statusFor([`CARD_RULES.${card}`], executableCoverageEvidence, candidateEvidence),
    effectVariants: effectKinds,
    instructionVariants: instructionKinds,
    pluginIds: sorted(definition?.pluginIds ?? []),
    handlerIds: sorted(definition?.handlerIds ?? []),
    embeddedRulePaths: sorted(perCard.embeddedRulePaths),
  }
})

const scanSites = (
  matcher: (line: string) => boolean,
  mechanic: string,
  neededCanonicalNode: string,
  compatibilityRoute: string,
  ownerPart: string,
  dependencyParts: string[] = [],
): SiteDisposition[] => productionFiles.flatMap((path) => {
  if (!path.includes('/rules-engine/src/') && !path.includes('/live-runner/src/')) return []
  const matches = readFileSync(path, 'utf8').split('\n').flatMap((line, index) =>
    matcher(line) ? [{ line: index + 1, code: line.trim() }] : [])
  if (matches.length === 0) return []
  return [{
    path: repoPath(path),
    lines: matches.map((match) => match.line),
    samples: matches.slice(0, 3).map((match) => `${match.line}: ${match.code}`),
    mechanic,
    neededCanonicalNode,
    compatibilityRoute,
    ownerPart,
    dependencyParts,
    status: 'legacy-route' as const,
  }]
})

const cardNameDispatch = scanSites(
  (line) => /\b(?:source|object|item|entered|card)\??\.name\s*(?:===|!==)/.test(line)
    || /\[[^\]]*['"][^'"]+['"][^\]]*\]\.includes\([^)]*\.name\)/.test(line),
  'card-name execution dispatch',
  'typed name predicate only when Oracle text names a card; otherwise reusable rule nodes/capabilities',
  'Retain this explicit legacy handler until its registrations have canonical conformance tests; do not copy the name check into the DSL driver.',
  '16',
  [],
)

const customEventDispatch = scanSites(
  (line) => /event\.type\s*[!=]==?\s*['"]custom['"]/.test(line)
    || /event\.name\s*[!=]==?\s*[A-Z_'"]/.test(line),
  'custom event continuation/dispatch',
  'typed answer or internal event variant plus server-owned continuation',
  'Decode saved custom events through a versioned compatibility adapter until the owning typed request/action path is proven.',
  '05',
  ['16'],
)

const directMutation = scanSites(
  (line) => /\bdraft\.(?:move|enqueue|pushStack|popStack|addToStack|object)\s*\(/.test(line),
  'direct draft mutation or low-level event scheduling',
  'semantic action primitive/event proposal with typed result and occurrence',
  'Keep the current mutation path behind its legacy handler until the owning action primitive preserves replacements, grouping, and replay.',
  '07',
  ['16'],
)

const sourceReferences = (needles: string[]) => sorted(productionFiles.flatMap((path) =>
  readFileSync(path, 'utf8').split('\n').flatMap((line, index) =>
    needles.some((needle) => line.includes(needle))
      ? [`${repoPath(path)}:${index + 1}`]
      : [])))

const embeddedRows: VariantDisposition[] = [
  {
    variant: 'token.effects',
    mechanic: 'rules embedded in token specifications',
    currentRegistrations: sorted(uses.embedded.get('embedded-effects') ?? []),
    executableCoverageEvidence: [
      'rules-engine/src/cardPlugins/tokenCarriedTriggers.test.ts — token-carried triggered abilities > a token stamped with optional mill opens a may dialog when it attacks',
      'rules-engine/src/cardPlugins/tokenCarriedTriggers.test.ts — token-carried triggered abilities > accepting mills one card',
    ],
    candidateEvidence: candidateSummary(testReferences(['token.effects', 'copyTokenTemplate'])),
    neededCanonicalNode: 'token definition reference with pinned canonical abilities',
    compatibilityRoute: 'Preserve serialized TokenSpec.effects and copy them exactly until token definitions resolve through the versioned catalogue.',
    ownerPart: '07',
    dependencyParts: ['09', '16'],
    status: 'confirmed-executable-evidence',
  },
  {
    variant: 'copyTokenTemplate/copyStackItem/becomeCopy',
    mechanic: 'copied object and stack rules',
    currentRegistrations: sourceReferences(['copyTokenTemplate', "type: 'copyStackItem'", 'becomeCopyOfTarget']),
    executableCoverageEvidence: [
      'rules-engine/src/cardPlugins/copyTokenTemplate.test.ts — copy token template > a copy carries the colors and mana value answers key off',
      'rules-engine/src/cardPlugins/becomeCopyOfTarget.test.ts — becomeCopyOfTarget > stamped creature filter copies power and toughness',
    ],
    candidateEvidence: candidateSummary(testReferences(['copyTokenTemplate', "type: 'copyStackItem'", 'becomeCopy'])),
    neededCanonicalNode: 'copy action preserving pinned definition revision, modes, X, and target bindings',
    compatibilityRoute: 'Retain copied effects/grantedRules snapshots and legacy stack-copy payloads until scoped copy conformance lands.',
    ownerPart: '07',
    dependencyParts: ['02', '09', '16'],
    status: 'confirmed-executable-evidence',
  },
  {
    variant: 'frontFace/backFace/roomDoors',
    mechanic: 'face and Room rules embedded in GameObject',
    currentRegistrations: sourceReferences(['frontFace', 'backFace', 'roomDoors']),
    executableCoverageEvidence: [
      'rules-engine/src/plugins/doubleFaced.test.ts — modal double-faced cards > casts the spell face and restores its front face after a land leaves',
      'rules-engine/src/plugins/rooms.test.ts — Room doors > casts either half and unlocks only the cast door as it enters',
    ],
    candidateEvidence: candidateSummary(testReferences(['frontFace', 'backFace', 'roomDoors'])),
    neededCanonicalNode: 'face-aware definition reference and typed casting/room procedures',
    compatibilityRoute: 'Keep persisted face characteristics and legacy commands readable while canonical definitions pin face programs.',
    ownerPart: '02',
    dependencyParts: ['08', '16'],
    status: 'confirmed-executable-evidence',
  },
  {
    variant: 'grantedRules/effects/grantCreatureTrigger',
    mechanic: 'granted runtime rules and abilities',
    currentRegistrations: sourceReferences(['grantedRules', 'grantCreatureTrigger']),
    executableCoverageEvidence: [
      'rules-engine/src/cardPlugins/grantCreatureTrigger.test.ts — grantCreatureTrigger to controlled subtype > leaving the lord removes the grant before another sliver enters',
      'rules-engine/src/cardPlugins/staticKeywordLayer.test.ts — static hexproof layer > removing the source restores printed hexproof and drops the granted hexproof',
    ],
    candidateEvidence: candidateSummary(testReferences(['grantedRules', 'grantCreatureTrigger'])),
    neededCanonicalNode: 'generated/granted ability definition with independent source and version context',
    compatibilityRoute: 'Retain stamped plugin IDs/effects in saved objects until generated definitions and adapters survive copy/replay.',
    ownerPart: '10',
    dependencyParts: ['13', '16'],
    status: 'confirmed-executable-evidence',
  },
]

const siteCount = (groups: SiteDisposition[]) =>
  groups.reduce((total, group) => total + group.lines.length, 0)

const ledger = {
  schema: 'rule-dsl-migration-ledger/v1',
  generatedFrom: {
    gitBase: '20f6da632c26633aae5eb660fa28d81c3c125f78',
    sources: [
      'rules-engine/src/cardPlugins/effectDefinitions.ts',
      'rules-engine/src/cardPlugins/cardRules.ts',
      'rules-engine/src/cardPlugins/instructionHandlers/',
      'rules-engine/src/plugins/index.ts',
      'rules-engine/src/pendingDialog.ts',
      'rules-engine/src/**/*.test.ts',
      'live-runner/src/**/*.test.ts',
    ],
    evidencePolicy: 'Only entries in executableCoverageEvidence are reviewed claims. candidateEvidence is lexical discovery with test name/location and never proves behavior by itself. A registration or handler alone is never coverage.',
    lexicalCoverageLimitations: [
      'Closed TypeScript discriminants, runtime CARD_RULES data, built-in plugins, and PendingDialog kinds are exhaustively compared for this commit.',
      'Card-name/custom-event/direct-mutation sites are lexical migration leads. Dynamic property access, computed names, code generation, and behavior hidden inside callbacks require human review.',
      'Embedded metadata families include runtime registrations plus all literal field references in the scanned engine/host roots; they are not an Oracle-text support claim.',
    ],
  },
  summary: {
    cardRegistrations: cardRows.length,
    cardEffects: effectRows.length,
    cardInstructions: instructionRows.length,
    instructionHandlersDiscovered: handlerKinds.size,
    builtInPlugins: pluginRows.length,
    specializedDialogs: dialogRows.length,
    embeddedRuleFamilies: embeddedRows.length,
    cardNameDispatchSites: siteCount(cardNameDispatch),
    customEventDispatchSites: siteCount(customEventDispatch),
    directMutationSites: siteCount(directMutation),
    instructionRegistrationOnlyGaps: instructionRows.filter((row) => row.status === 'registration-only').length,
    instructionUnobservedGaps: instructionRows.filter((row) => row.status === 'unobserved').length,
    cardRegistrationOnlyGaps: cardRows.filter((row) => row.status === 'registration-only').length,
    candidateOnlyInstructionRows: instructionRows.filter((row) => row.status === 'candidate-test-reference').length,
    candidateOnlyCardRows: cardRows.filter((row) => row.status === 'candidate-test-reference').length,
  },
  cardEffects: effectRows,
  cardInstructions: instructionRows,
  cardRegistrations: cardRows,
  handlerDiscovery: {
    discoveredKinds: sorted(handlerKinds),
    missingForInstructionUnion: instructionVariants.filter((kind) => !handlerKinds.has(kind)),
    extraOutsideInstructionUnion: sorted(handlerKinds).filter((kind) => !instructionSet.has(kind)),
  },
  plugins: pluginRows,
  specializedDialogs: dialogRows,
  embeddedRules: embeddedRows,
  directDispatch: {
    cardName: cardNameDispatch,
    customEvents: customEventDispatch,
    draftMutation: directMutation,
  },
  intentionalCorrections: [
    {
      ownerPart: '03',
      change: 'Move ordinary state-based actions and pending-trigger placement to explicit checkpoints rather than nested reductions.',
      classification: 'intentional-rules-correction',
    },
    {
      ownerPart: '09',
      dependencyParts: ['05'],
      change: 'Move mode selection to announcement/trigger placement and replace label/custom-event identity with typed server-owned offers.',
      classification: 'intentional-rules-correction',
    },
    {
      ownerPart: '11',
      dependencyParts: ['05', '07', '10'],
      change: 'Replace timestamp-first replacement processing with CR 616 choice/precedence and persisted lineage.',
      classification: 'intentional-rules-correction',
    },
    {
      ownerPart: '14',
      dependencyParts: ['06', '07', '11', '13'],
      change: 'Defer failed-draw loss to the applicable SBA and track first draws by draw-step instance.',
      classification: 'intentional-rules-correction',
    },
  ],
}

const rendered = `${JSON.stringify(ledger, null, 2)}\n`
if (checkOnly) {
  const current = readFileSync(outputPath, 'utf8')
  if (current !== rendered) {
    throw new Error('rule-dsl coverage ledger is stale; run bun rules-engine/scripts/ruleDslCoverage.ts')
  }
  if (ledger.handlerDiscovery.missingForInstructionUnion.length > 0) {
    throw new Error(`instruction variants without discovered handlers: ${ledger.handlerDiscovery.missingForInstructionUnion.join(', ')}`)
  }
  console.log(`Rule DSL coverage ledger is current (${cardRows.length} cards, ${instructionRows.length} instructions, ${effectRows.length} effects).`)
} else {
  writeFileSync(outputPath, rendered)
  console.log(`Wrote ${repoPath(outputPath)}`)
}
