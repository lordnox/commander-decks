import { describe, expect, test } from 'bun:test'
import {
  RULE_DSL_V2_CAPABILITIES,
  RuleDslEvaluationError,
  RuleDslValidationError,
  ability,
  actions,
  activated,
  and as allActions,
  amount,
  card,
  cardRuleDefinition,
  choice,
  chooseCards,
  chooseInstructions,
  choose,
  chooseModes,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  delve,
  discard,
  draw,
  draws,
  evaluateAmount,
  evaluateTargetBounds,
  gainLife,
  ifThen,
  keyword,
  lifeCost,
  loadDefinitionSnapshot,
  objects,
  or as eitherAction,
  players,
  ref,
  result,
  select,
  self,
  serializeCardRuleDefinition,
  spell,
  staticAbility,
  target,
  variable,
  whenever,
  withTargets,
  prohibitActivation,
  modifyStats,
  type CardRuleDefinitionV2,
  type Instruction,
} from './index'
import { definitionRevisionFor } from '../builders/revision'
import { RULE_DSL_SCHEMA_VERSION } from '../schema/v2'

const diagnosticCodes = (run: () => unknown): string[] => {
  try {
    run()
    throw new Error('expected RuleDslValidationError')
  } catch (error) {
    if (!(error instanceof RuleDslValidationError)) throw error
    return error.diagnostics.map(({ code }) => code)
  }
}

const diagnosticPaths = (run: () => unknown): string[] => {
  try {
    run()
    throw new Error('expected RuleDslValidationError')
  } catch (error) {
    if (!(error instanceof RuleDslValidationError)) throw error
    return error.diagnostics.map(({ path }) => path)
  }
}

const revise = (definition: CardRuleDefinitionV2): CardRuleDefinitionV2 => {
  const copy = structuredClone(definition)
  copy.definitionRevision = definitionRevisionFor({
    schemaVersion: copy.schemaVersion,
    abilities: copy.abilities,
  })
  return copy
}

describe('Rule DSL v1 canonical authoring', () => {
  test('explicit and compact Wall of Omens lower to identical canonical data and paths', () => {
    const explicit = cardRuleDefinition(RULE_DSL_SCHEMA_VERSION, {
      abilities: [
        keyword.defender,
        whenever(self.enters, { instructions: [actions.draw.self.one] }),
      ],
    })
    const compact = card([
      keyword.defender,
      ability.whenever(self.enters, actions.draw.self.one),
    ])

    expect(compact).toEqual(explicit)
    const explicitCompiled = compileCardRuleDefinition(explicit)
    const compactCompiled = compileCardRuleDefinition(compact)
    expect(compactCompiled.declarations).toEqual(explicitCompiled.declarations)
    expect(compactCompiled.capabilities).toEqual({
      canonicalLoad: true,
      serialization: true,
      runtimeExecution: {
        abilitiesWithSuppliedContext: ['activated', 'spell', 'triggered'],
        instructionKinds: ['addMana', 'counter', 'copySpell', 'createDelayed', 'createEffect', 'damage', 'destroy', 'draw', 'gainEnergy', 'gainLife', 'loseLife', 'payOptional', 'sequence'],
        decisions: 'fullySuppliedTargets',
      },
    })
    expect(compactCompiled.definition.abilities[1]).toEqual({
      kind: 'triggered',
      activeIn: ['battlefield'],
      on: { kind: 'enters', filter: { kind: 'contextRef', name: 'source' } },
      decisions: { targets: [] },
      instructions: [{
        kind: 'draw',
        count: { kind: 'constant', value: 1 },
        targets: { kind: 'contextRef', name: 'controller' },
      }],
    })
  })

  test('canonical definitions and bundled replay snapshots round-trip as immutable JSON', () => {
    const definition = card([keyword.trample])
    const serialized = serializeCardRuleDefinition(definition)
    const roundTripped = compileCardRuleDefinition(JSON.parse(serialized))
    const snapshot = createDefinitionSnapshot(roundTripped)
    const restored = loadDefinitionSnapshot(JSON.parse(JSON.stringify(snapshot)))

    expect(restored.definition).toEqual(definition)
    expect(restored.definitionRevision).toBe(definition.definitionRevision)
    expect(Object.isFrozen(restored.definition)).toBe(true)
    expect(Object.isFrozen(restored.definition.abilities)).toBe(true)
    expect(JSON.stringify(restored.definition)).toBe(serialized)
  })

  test('old persisted schema versions are rejected with an actionable message', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([])))
    expect(() => loadDefinitionSnapshot({ ...snapshot, schemaVersion: 1 })).toThrow(
      'unsupported Rule DSL schema version: 1; recreate the game with current card definitions',
    )
  })

  test('definition revision is content-derived and distinct from schema version', () => {
    const defender = card([keyword.defender])
    const trample = card([keyword.trample])
    expect(defender.schemaVersion).toBe(RULE_DSL_SCHEMA_VERSION)
    expect(trample.schemaVersion).toBe(RULE_DSL_SCHEMA_VERSION)
    expect(defender.definitionRevision).not.toBe(trample.definitionRevision)

    const staleSnapshot = structuredClone(createDefinitionSnapshot(compileCardRuleDefinition(defender)))
    staleSnapshot.definitionRevision = trample.definitionRevision
    expect(diagnosticCodes(() => loadDefinitionSnapshot(staleSnapshot))).toContain('definition-revision')
  })

  test('authoring getters save only data and do not share mutable templates', () => {
    const first = actions.draw.self.one
    const second = actions.draw.self.one
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(Object.isFrozen(first)).toBe(true)

    const authored = card([ability.whenever(self.enters, first)])
    const values: unknown[] = [authored]
    while (values.length > 0) {
      const value = values.pop()
      expect(typeof value).not.toBe('function')
      if (value !== null && typeof value === 'object') values.push(...Object.values(value))
    }

    const mutable = JSON.parse(JSON.stringify(authored)) as CardRuleDefinitionV2
    const one = compileCardRuleDefinition(mutable)
    const two = compileCardRuleDefinition(mutable)
    expect(one.definition).not.toBe(two.definition)
    expect(one.definition.abilities).not.toBe(two.definition.abilities)
  })

  test('targeting and composition sugar retain declaration-time semantics', () => {
    const definition = card([
      ability.whenever(self.enters, withTargets([
        select({ filter: players({ relation: 'any' }), count: 1 }),
      ], actions.draw.target.one)),
    ])
    expect(compileCardRuleDefinition(definition).definition).toEqual(definition)
  })

  test('and, choose, and or lower to distinct canonical control-flow nodes', () => {
    const first = actions.draw.self.one
    const second = { kind: 'gainLife' as const, amount: amount(2), targets: ref('controller') }
    expect(allActions(first, second)).toEqual({
      kind: 'sequence',
      instructions: [first, second],
    })
    expect(choose({
      chooser: ref('controller'),
      count: 1,
      options: [{ instructions: [first] }, { instructions: [second] }],
    })).toEqual(eitherAction(first, second))
  })

  test('loads the first-slice ability union without advertising execution support', () => {
    const definition = card([
      keyword.trample,
      activated({
        costs: [lifeCost(1)],
        instructions: [actions.draw.self.one],
      }),
      staticAbility(prohibitActivation({
        abilitySource: { zone: 'battlefield', type: 'Artifact' },
      })),
      ability.whenever(self.dies, actions.draw.self.one),
    ])
    const compiled = compileCardRuleDefinition(definition)
    expect(compiled.definition.abilities.map(({ kind }) => kind)).toEqual([
      'keyword', 'activated', 'static', 'triggered',
    ])
    expect(compiled.capabilities.runtimeExecution).toEqual({
      abilitiesWithSuppliedContext: ['activated', 'spell', 'triggered'],
      instructionKinds: ['addMana', 'counter', 'copySpell', 'createDelayed', 'createEffect', 'damage', 'destroy', 'draw', 'gainEnergy', 'gainLife', 'loseLife', 'payOptional', 'sequence'] as readonly string[],
      decisions: 'fullySuppliedTargets',
    })
  })

  test('canonical player-effect builders match compact sugar for ETB draw and controller gainLife', () => {
    expect(gainLife({ amount: 2, targets: ref('controller') })).toEqual({
      kind: 'gainLife',
      amount: { kind: 'constant', value: 2 },
      targets: { kind: 'contextRef', name: 'controller' },
    })
    expect(whenever(self.enters, {
      instructions: [draw({ count: 1, targets: ref('controller') })],
    })).toEqual(ability.whenever(self.enters, actions.draw.self.one))
  })

  test('draw occurrence player filters keep you, opponent, and any relations', () => {
    const relation = (player: 'you' | 'opponent' | 'any') => {
      const pattern = draws({ player: players({ relation: player }) })
      if (pattern.kind !== 'draw') throw new Error('expected a draw pattern')
      const selector = pattern.filter.player
      if (!selector || selector.kind !== 'players') throw new Error('expected a player selector')
      return selector.filter.relation
    }
    expect(relation('any')).toBe('any')
    expect(relation('you')).toBe('you')
    expect(relation('opponent')).toBe('opponent')
  })
})

describe('Rule DSL v1 structural and domain validation', () => {
  test('rejects unsupported versions and node kinds at their declaration paths', () => {
    const unsupportedVersion = structuredClone(card([])) as unknown as Record<string, unknown>
    unsupportedVersion.schemaVersion = 1
    expect(diagnosticPaths(() => compileCardRuleDefinition(unsupportedVersion))).toEqual(['$.schemaVersion'])

    const unsupportedNode = structuredClone(card([keyword.defender])) as unknown as CardRuleDefinitionV2
    ;(unsupportedNode.abilities[0] as unknown as { kind: string }).kind = 'oracleText'
    expect(diagnosticPaths(() => compileCardRuleDefinition(revise(unsupportedNode)))).toContain('$.abilities[0].kind')
  })

  test('rejects wrong recipient domains and local target indices', () => {
    const objectTargetDraw = card([spell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield' }), count: 1 })] },
      instructions: [{ kind: 'draw', count: amount(1), targets: target(0) }],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(objectTargetDraw))).toContain('domain')

    const missingTarget = card([spell({
      instructions: [{ kind: 'draw', count: amount(1), targets: target(0) }],
    })])
    expect(diagnosticPaths(() => compileCardRuleDefinition(missingTarget))).toContain('$.abilities[0].instructions[0].targets.clauseIndex')
  })

  test('limits full-library visibility to library card choices', () => {
    const fullLibraryChoice = card([spell({
      instructions: [chooseCards({
        bindChoice: 'found',
        chooser: ref('controller'),
        filter: objects({ zone: 'library', owner: 'you' }),
        count: 1,
        viewLibrary: true,
      })],
    })])
    expect(compileCardRuleDefinition(fullLibraryChoice).definition).toEqual(fullLibraryChoice)

    const multiZone = card([spell({
      instructions: [chooseCards({
        bindChoice: 'found',
        chooser: ref('controller'),
        filter: objects({ owner: 'you', any: [{ zone: 'library' }, { zone: 'graveyard' }] }),
        count: 1,
        viewLibrary: true,
      })],
    })])
    expect(compileCardRuleDefinition(multiZone).definition).toEqual(multiZone)

    const wrongZone = structuredClone(fullLibraryChoice) as unknown as Record<string, unknown>
    const firstInstruction = (definition: Record<string, unknown>) =>
      ((definition.abilities as Array<Record<string, unknown>>)[0].instructions as Array<Record<string, unknown>>)[0]
    ;((firstInstruction(wrongZone).filter as Record<string, unknown>).filter as Record<string, unknown>).zone = 'hand'
    expect(diagnosticPaths(() => compileCardRuleDefinition(revise(wrongZone as unknown as CardRuleDefinitionV2)))).toContain('$.abilities[0].instructions[0].viewLibrary')

    const invalidFlag = structuredClone(fullLibraryChoice) as unknown as Record<string, unknown>
    firstInstruction(invalidFlag).viewLibrary = false
    expect(diagnosticCodes(() => compileCardRuleDefinition(revise(invalidFlag as unknown as CardRuleDefinitionV2)))).toContain('constant')
  })

  test('rejects unresolved X and bounds while accepting explicitly declared X', () => {
    const unresolved = card([spell({ instructions: [actions.draw.self.X] })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(unresolved))).toContain('unresolved-binding')

    const resolved = card([spell({
      decisions: { variables: [{ name: 'X', min: 0, max: 20 }] },
      instructions: [actions.draw.self.X],
    })])
    expect(compileCardRuleDefinition(resolved).definition).toEqual(resolved)

    const invalidBounds = structuredClone(resolved)
    ;(invalidBounds.abilities[0] as unknown as {
      decisions: { variables: Array<{ name: 'X'; min: number; max: number }> }
    }).decisions.variables[0] = { name: 'X', min: 4, max: 2 }
    expect(diagnosticCodes(() => compileCardRuleDefinition(revise(invalidBounds)))).toContain('bounds')

    const modeRedeclaration = card([spell({
      decisions: {
        variables: [{ name: 'X', min: 0, max: 10 }],
        modes: chooseModes({ count: 1 }),
      },
      modes: [{
        decisions: { variables: [{ name: 'X', min: 0, max: 10 }] },
        instructions: [],
      }],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(modeRedeclaration))).toContain('duplicate-binding')
  })

  test('keeps event and trigger references scoped to compatible occurrences', () => {
    const ordinaryEventPlayer = card([spell({
      instructions: [{ kind: 'draw', count: amount(1), targets: ref('event.player') }],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(ordinaryEventPlayer))).toContain('unresolved-binding')

    const drawTrigger = card([whenever(draws({ player: players({ relation: 'any' }) }), {
      instructions: [{ kind: 'draw', count: { kind: 'eventAmount' }, targets: ref('triggering.player') }],
    })])
    expect(compileCardRuleDefinition(drawTrigger).definition).toEqual(drawTrigger)

    const wrongTriggerObject = card([whenever(draws(), {
      instructions: [{ kind: 'destroy', targets: ref('triggering.object.before') }],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(wrongTriggerObject))).toContain('unresolved-binding')
  })

  test('generated programs may read grant.source while printed triggers may not', () => {
    const fightGrant = chooseCards({
      chooser: ref('controller'),
      bindChoice: 'granter',
      filter: objects({ among: ref('grant.source') }),
      min: 0,
      max: 1,
    })
    const generated = {
      ...whenever(self.attacks, { instructions: [fightGrant] }),
      generated: true as const,
    }
    expect(compileCardRuleDefinition(card([generated])).definition.abilities[0]).toMatchObject({ generated: true })

    const printed = whenever(self.attacks, { instructions: [fightGrant] })
    expect(diagnosticCodes(() => compileCardRuleDefinition(card([printed])))).toContain('unresolved-binding')
  })

  test('rejects nonboolean modifyStats.set on a revisioned definition', () => {
    const valid = card([staticAbility(modifyStats({
      targets: objects({ zone: 'battlefield', type: 'Creature' }),
      power: { kind: 'constant', value: 1 },
      toughness: { kind: 'constant', value: 1 },
      set: true,
    }))])
    const malformed = structuredClone(valid) as typeof valid & {
      abilities: Array<{ effects?: Array<Record<string, unknown>> }>
    }
    malformed.abilities[0].effects![0].set = 'false'
    malformed.definitionRevision = definitionRevisionFor({
      schemaVersion: valid.schemaVersion,
      abilities: malformed.abilities,
    })
    expect(diagnosticCodes(() => compileCardRuleDefinition(malformed))).toContain('type')
    expect(diagnosticPaths(() => compileCardRuleDefinition(malformed))).toContain('$.abilities[0].effects[0].set')
  })

  test('rejects malformed modal structure and mode-local target scope leaks', () => {
    const missingModeSpec = card([spell({
      modes: [{ instructions: [actions.draw.self.one] }],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(missingModeSpec))).toContain('modal-structure')

    const localLeak = card([spell({
      decisions: { modes: chooseModes({ count: 1 }) },
      modes: [
        {
          decisions: { targets: [select({ filter: players(), count: 1 })] },
          instructions: [actions.draw.target.one],
        },
        { instructions: [actions.draw.target.one] },
      ],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(localLeak))).toContain('target-index')
  })

  test('preserves labeled instruction choices and validates prompt and label text', () => {
    const valid = card([spell({
      instructions: [chooseInstructions({
        chooser: ref('controller'),
        prompt: 'Return the target card?',
        options: [
          { label: 'Return it', instructions: [] },
          { label: 'Decline', instructions: [] },
        ],
      })],
    })])
    const compiled = compileCardRuleDefinition(valid)
    expect(compiled.definition).toEqual(valid)

    const invalidLabel = card([spell({
      instructions: [{
        kind: 'chooseInstructions', chooser: ref('controller'), count: { kind: 'constant', value: 1 },
        whenInsufficient: 'chooseAvailable', options: [{ label: '', instructions: [] }],
      } as never],
    })])
    expect(diagnosticPaths(() => compileCardRuleDefinition(invalidLabel))).toContain('$.abilities[0].instructions[0].options[0].label')
  })

  test('validates distribution target indices and nonrepeatable mode cardinality', () => {
    const badDistribution = card([spell({
      decisions: {
        targets: [select({ filter: players(), count: 1 })],
        distributions: [{ targetClauseIndex: 1, total: amount(2), minEach: amount(0) }],
      },
      instructions: [],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(badDistribution))).toContain('target-index')

    const tooManyModes = card([spell({
      decisions: { modes: chooseModes({ count: 2 }) },
      modes: [{ instructions: [] }],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(tooManyModes))).toContain('modal-bounds')
  })

  test('rejects ambiguous authored program and cardinality shorthand', () => {
    expect(() => spell({
      instructions: [],
      modes: [],
    } as never)).toThrow('exactly one')
    expect(() => chooseCards({
      bindChoice: 'cards',
      chooser: ref('controller'),
      filter: objects({ zone: 'hand', owner: 'you' }),
      count: 1,
      min: 0,
      max: 1,
    })).toThrow('never both')
  })

  test('validates mana grammar, scoped X, and cost filters before target bindings exist', () => {
    const invalidMana = card([spell({
      costs: [{ kind: 'mana', amount: 'potato' }],
      instructions: [],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(invalidMana))).toContain('mana-cost')

    const phyrexianMana = card([spell({
      costs: [{ kind: 'mana', amount: '{1}{B/P}{B/P}' }],
      instructions: [],
    })])
    expect(() => compileCardRuleDefinition(phyrexianMana)).not.toThrow()
    expect(() => compileCardRuleDefinition(card([spell({ costs: [delve()], instructions: [] })]))).not.toThrow()

    const hybridMana = card([spell({
      costs: [{ kind: 'mana', amount: '{W/U}' }],
      instructions: [],
    })])
    expect(() => compileCardRuleDefinition(hybridMana)).not.toThrow()

    const unresolvedManaX = card([spell({
      costs: [{ kind: 'mana', amount: '{X}{U}' }],
      instructions: [],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(unresolvedManaX))).toContain('unresolved-binding')

    const targetDependentCost = card([spell({
      decisions: { targets: [select({ filter: players(), count: 1 })] },
      costs: [{
        kind: 'discard',
        filter: objects({ zone: 'hand', owner: target(0) }),
        count: amount(1),
      }],
      instructions: [],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(targetDependentCost))).toContain('target-index')
  })
})

describe('Rule DSL v1 binding data flow', () => {
  const trueCondition = {
    kind: 'compareAmount' as const,
    left: amount(1),
    operator: 'eq' as const,
    right: amount(1),
  }

  test('rejects duplicate locals and result fields from the wrong producer', () => {
    const pick = () => chooseCards({
      bindChoice: 'picked',
      chooser: ref('controller'),
      filter: objects({ zone: 'hand', owner: 'you' }),
      count: 1,
    })
    const duplicate = card([spell({ instructions: [pick(), pick()] })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(duplicate))).toContain('duplicate-binding')

    const wrongField = card([spell({
      decisions: { targets: [select({ filter: { kind: 'stackItems', filter: { kind: 'spell' } }, count: 1 })] },
      instructions: [
        { kind: 'counter', targets: target(0), bindResult: 'answer' },
        ifThen(result('answer', 'discarded'), { then: [], otherwise: [] }),
      ],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(wrongField))).toContain('unresolved-binding')

    const emptyBinding = card([spell({
      instructions: [discard({ targets: ref('controller'), count: 1, bindResult: '' })],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(emptyBinding))).toContain('binding-name')
  })

  test('keeps choice and result binding namespaces semantically typed', () => {
    const choiceAsResult = card([spell({
      instructions: [
        chooseCards({
          bindChoice: 'picked',
          chooser: ref('controller'),
          filter: objects({ zone: 'hand', owner: 'you' }),
          count: 1,
        }),
        {
          kind: 'if',
          condition: { kind: 'resultIsTrue', value: choice('picked') as never },
          then: [],
          otherwise: [],
        },
      ],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(choiceAsResult))).toContain('binding-kind')

    const resultAsChoice = card([spell({
      decisions: {
        targets: [select({ filter: { kind: 'stackItems', filter: { kind: 'spell' } }, count: 1 })],
      },
      instructions: [
        { kind: 'counter', targets: target(0), bindResult: 'countered' },
        discard({
          targets: { kind: 'choiceRef', binding: 'countered' },
          by: ref('controller'),
        }),
      ],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(resultAsChoice))).toContain('binding-kind')
  })

  test('rejects branch-only reads outside the branch', () => {
    const branchOnly: Instruction = {
      kind: 'if',
      condition: trueCondition,
      then: [discard({
        targets: ref('controller'),
        count: 1,
        bindResult: 'discard',
      })],
      otherwise: [],
    }
    const definition = card([spell({
      instructions: [
        branchOnly,
        ifThen(result('discard', 'discarded'), { then: [], otherwise: [] }),
      ],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(definition))).toContain('unresolved-binding')
  })

  test('does not leak bindings from a resolution choice that may choose no available option', () => {
    const choosing = choose({
      chooser: ref('controller'),
      count: 1,
      options: [{
        instructions: [discard({
          targets: ref('controller'),
          count: 1,
          bindResult: 'optionDiscard',
        })],
      }],
    })
    const definition = card([spell({
      instructions: [
        choosing,
        ifThen(result('optionDiscard', 'discarded'), { then: [], otherwise: [] }),
      ],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(definition))).toContain('unresolved-binding')
  })

  test('allows a local produced on every branch and guaranteed empty card-choice bindings', () => {
    const bothBranches: Instruction = {
      kind: 'if',
      condition: trueCondition,
      then: [discard({ targets: ref('controller'), count: 1, bindResult: 'discard' })],
      otherwise: [discard({ targets: ref('controller'), count: 1, bindResult: 'discard' })],
    }
    const guaranteedChoice = chooseCards({
      bindChoice: 'picked',
      chooser: ref('controller'),
      filter: objects({ zone: 'hand', owner: 'you' }),
      min: 0,
      max: 1,
    })
    const definition = card([spell({
      instructions: [
        bothBranches,
        ifThen(result('discard', 'discarded'), { then: [], otherwise: [] }),
        guaranteedChoice,
        discard({ targets: choice('picked'), by: ref('controller') }),
      ],
    })])
    expect(compileCardRuleDefinition(definition).definition).toEqual(definition)
  })

  test('rejects scalar result bindings for aggregate player discard', () => {
    const aggregate = card([spell({
      instructions: [discard({
        targets: players({ relation: 'opponent' }),
        count: 1,
        bindResult: 'discard',
      })],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(aggregate))).toContain('aggregate-result')

    const aggregateCounter = card([spell({
      decisions: {
        targets: [select({
          filter: { kind: 'stackItems', filter: { kind: 'spell' } },
          min: 1,
          max: 2,
        })],
      },
      instructions: [{ kind: 'counter', targets: target(0), bindResult: 'countered' }],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(aggregateCounter))).toContain('aggregate-result')
  })
})

describe('Rule DSL v1 hostile data and numeric contracts', () => {
  test('rejects accessors without evaluating them in compiler or root builders', () => {
    let reads = 0
    const hostile = Object.defineProperty({}, 'kind', {
      enumerable: true,
      get() { reads += 1; return 'keyword' },
    })
    const root = {
      schemaVersion: RULE_DSL_SCHEMA_VERSION,
      definitionRevision: 'v2-0000000000000000',
      abilities: [hostile],
    }
    expect(diagnosticCodes(() => compileCardRuleDefinition(root))).toContain('accessor')
    expect(reads).toBe(0)
    expect(() => cardRuleDefinition(RULE_DSL_SCHEMA_VERSION, { abilities: [hostile as never] })).toThrow('accessors')
    expect(reads).toBe(0)

    const hostileRoot = Object.defineProperty({}, 'abilities', {
      enumerable: true,
      get() { reads += 1; return [] },
    })
    expect(() => cardRuleDefinition(RULE_DSL_SCHEMA_VERSION, hostileRoot as never)).toThrow('accessors')
    expect(reads).toBe(0)
  })

  test('rejects functions, cycles, non-enumerable data, array properties, and excessive depth', () => {
    const functionRoot = structuredClone(card([])) as unknown as Record<string, unknown>
    functionRoot.extra = () => undefined
    expect(diagnosticCodes(() => compileCardRuleDefinition(functionRoot))).toContain('executable-value')

    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(diagnosticCodes(() => compileCardRuleDefinition(cycle))).toContain('cyclic-data')

    const hidden = structuredClone(card([]))
    Object.defineProperty(hidden, 'hidden', { value: 1, enumerable: false })
    expect(diagnosticCodes(() => compileCardRuleDefinition(hidden))).toContain('non-enumerable')

    const arrayProperty = structuredClone(card([]))
    Object.defineProperty(arrayProperty.abilities, '4294967295', { value: keyword.defender, enumerable: true })
    expect(diagnosticCodes(() => compileCardRuleDefinition(arrayProperty))).toContain('array-property')

    let deep: Record<string, unknown> = {}
    const deepRoot = deep
    for (let index = 0; index < 100; index += 1) {
      deep.next = {}
      deep = deep.next as Record<string, unknown>
    }
    expect(diagnosticCodes(() => compileCardRuleDefinition(deepRoot))).toContain('data-depth-limit')

    const sparseAbilities: unknown[] = []
    sparseAbilities.length = 1_000_000_000
    const sparse = {
      schemaVersion: RULE_DSL_SCHEMA_VERSION,
      definitionRevision: 'v2-0000000000000000',
      abilities: sparseAbilities,
    }
    expect(diagnosticCodes(() => compileCardRuleDefinition(sparse))).toContain('data-node-limit')
  })

  test('enforces literal and evaluation-time amount limits', () => {
    const oversized = card([spell({
      instructions: [{ kind: 'draw', count: amount(1_000_001), targets: ref('controller') }],
    })])
    expect(diagnosticCodes(() => compileCardRuleDefinition(oversized))).toContain('numeric-limit')

    expect(() => evaluateAmount(variable('X'), {
      variables: { X: 2_147_483_648 },
      count: () => 0,
      greatest: () => 0,
      characteristic: () => 0,
    })).toThrow(RuleDslEvaluationError)

    expect(() => evaluateTargetBounds({
      filter: players(),
      min: amount(2),
      max: amount(1),
      distinct: true,
    }, {
      count: () => 0,
      greatest: () => 0,
      characteristic: () => 0,
    })).toThrow('minimum 2 exceeds maximum 1')
  })

  test('advertises the canonical target-aware runtime slice implemented by Part 04', () => {
    expect(RULE_DSL_V2_CAPABILITIES.runtimeExecution).toEqual({
      abilitiesWithSuppliedContext: ['activated', 'spell', 'triggered'],
      instructionKinds: ['addMana', 'counter', 'copySpell', 'createDelayed', 'createEffect', 'damage', 'destroy', 'draw', 'gainEnergy', 'gainLife', 'loseLife', 'payOptional', 'sequence'],
      decisions: 'fullySuppliedTargets',
    })
    expect(compileCardRuleDefinition(card([])).capabilities.runtimeExecution)
      .toEqual(RULE_DSL_V2_CAPABILITIES.runtimeExecution)
  })
})
