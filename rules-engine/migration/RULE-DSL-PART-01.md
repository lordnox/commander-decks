# Rule DSL Part 01 implementation note

Part 01 adds the version-1 canonical schema, compiler, explicit builders, fluent
authoring helpers, and pure legacy adapters under
`rules-engine/src/cardPlugins/dsl/`. It is additive: no card registration or
runtime instruction handler consumes these definitions yet.

## Version and replay decision

`schemaVersion` identifies the serialized node grammar. `definitionRevision` is
a separate deterministic content revision over the schema version and canonical
abilities. A compiler result pins both values.

Saved execution and replay state will bundle a `CardRuleDefinitionSnapshotV1`:
the two pins plus the exact immutable canonical definition. Restore validates
the outer pins against the bundled definition. This avoids making a replay depend
on whichever mutable definition catalogue happens to be installed later. Future
runtime frames can store this snapshot or a durable reference to equivalent
persisted snapshot storage; schema version alone is never treated as a content
revision.

The exported capability descriptor intentionally says `runtimeExecution: false`.
Part 01 proves loading, validation, immutable compilation, and serialization; the
authoritative execution driver begins in later parts.

## Closed first slice

The v1 entry point contains:

- root, spell, activated, triggered, static, keyword, plain-program, and modal
  program unions;
- separate player, object, and stack selector/filter domains;
- context, target, choice, and typed result references;
- constant, X, event, selector-count, and characteristic amounts with literal
  and evaluation-time bounds;
- target, variable, mode, and distribution decisions;
- discard, sacrifice, life, and basic braced mana costs;
- typed conditions and the first action/control-flow instructions needed by the
  authoring contract;
- the pinned `card`, `ability.whenever`, `self`, `keyword`, `actions.draw`,
  `and`, `choose`/`or`, `withTargets`, and `ifThen` helpers; and
- strict adapters for the representable fixed player instructions and simple
  entry, death, and draw triggers in the legacy model.

Validation inspects property descriptors before reading authored data. It rejects
accessors, executable or symbolic values, non-plain objects, cycles, sparse or
oversized trees, unsupported fields/kinds/versions, invalid domains and bounds,
unavailable event context, target-scope leaks, ambiguous modal programs, and
locals that are duplicated or unavailable on every control-flow path. Compiler
diagnostics carry canonical declaration paths. Unsupported legacy options remain
on the legacy route and fail adapter translation at their legacy source path.

`evaluateAmount` bounds every supplied runtime value, but a future announcement
driver must also validate an X value against the active `VariableSpec.min` and
`VariableSpec.max` before putting it in the evaluation context. The generic
runtime limit is not a substitute for that declaration-specific check.

The generated Part 00 ledger remains an inventory of the live legacy runtime.
Part 01 test references may change lexical candidate counts when the generator is
run, but they do not change executable evidence, migration status, or runtime
dispatch.
