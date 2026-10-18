# Canonical card modules

Each supported canonical card owns its printed characteristics and compiled Rule DSL definition in `rules-engine/src/cards/<card-name>.ts`. Add its exact-name entry in `index.ts`; keep imports and entries alphabetical. Keep reusable mechanics in `cardPlugins/dsl`, rather than adding card-specific executors here.

Use lowercase kebab-case filenames: remove apostrophes and punctuation, normalize accented letters to their ASCII spelling, and separate words with hyphens. For a multifaced card, use the front face name and keep its face definitions together. If names produce the same slug, append enough of the remaining exact card name to distinguish them; never overwrite an existing module. The index preserves exact Unicode card names for lookup.

Use `snapshotFor` to compile canonical DSL abilities once at module load. Do not import the index from card modules. Public lookups remain in `../cardPlugins/dsl/cardRuleCatalog.ts`: template defaults are cloned for each caller, while definition lookups retain the compiled snapshot. Static imports support browser and host builds; lazy loading is deferred.

This directory is the destination for remaining cards migrated through #383. Existing legacy registrations stay in `cardPlugins/cardRules.ts` until their canonical mechanics and behavior coverage are ready; moving their legacy configurations here is not a migration. See #414 for complete ownership across all supported cards.
