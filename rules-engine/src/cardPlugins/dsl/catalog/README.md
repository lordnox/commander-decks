# Canonical card catalog

Each card module owns its compiled rule definition and, when already supplied by the catalog, printed characteristics. Add a module and its exact-name entry in `index.ts`; keep imports and entries alphabetical. Use `snapshotFor` to compile canonical DSL abilities once at module load. Do not import the index from card modules.

The public lookups remain in `../cardRuleCatalog.ts`. Template defaults are cloned for each caller; definition lookups retain the compiled snapshot. Entries without printed characteristics intentionally provide only a rule definition. The index uses static imports for both browser and host builds; lazy loading is deferred.
