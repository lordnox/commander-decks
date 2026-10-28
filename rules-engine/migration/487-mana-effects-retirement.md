# Retire the legacy mana CardEffect routes

Parent: [#487](https://github.com/lordnox/commander-decks/issues/487)

Child: [#646](https://github.com/lordnox/commander-decks/issues/646)

Base: `9f25b453`

This slice removes the `mana`, `manaCapability`, and `restrictedMana` variants
from the legacy `CardEffect` model, along with their `manaIf` / `manaFrom`
builders and runtime readers. Canonical mana abilities and their restricted
mana instructions remain in the Rule DSL. The per-player restricted-mana pool,
its spending rules, cleanup, and persistence behavior remain runtime contracts.

The affected source paths were:

- `cardPlugins/effectDefinitions.ts` and `cardPlugins/abilities.ts`: remove the
  obsolete variants and their only helper producers.
- `plugins/mana.ts`: remove the dynamic capability scan and the restricted
  source-to-player-pool conversion. Canonical mana abilities still run through
  the DSL activation path.
- `cardPlugins/activated.ts`: remove the obsolete `mana` condition reader.
- `actions.ts`: remove the planner's source-`restrictedMana` CardEffect read;
  restricted mana already in the player pool remains available through the
  shared `restrictedManaFits` check.

The separate legacy `activate` mana-ability reader in `manaChoice.ts`, its
activation affordance in `actions.ts`, and the explicit-sacrifice text guard in
`plugins/mana.ts` remain for generated token/activation consumers tracked by
#651 and #649. `plugins/lands.ts` only reads the unrelated
`static.playLandsFromGraveyard` field and remains with #647. This boundary keeps
the issue finite without removing consumers owned by later roadmap tasks.

Existing behavior owners were checked rather than duplicated:

- `cardPlugins/dsl/restrictedMana.test.ts`: canonical legendary and chosen-type
  restrictions, colorless mana, spending eligibility, and uncounterable spells.
- `cardPlugins/dsl/creatureTypeChoices.test.ts`: catalog Cavern of Souls choice,
  private visibility, JSON restore, restricted production, and matching-spell
  payment.
- `cardPlugins/targetingMana.test.ts`: catalog Delighted Halfling colorless vs
  restricted mana, legend-only spending, end-of-step loss, and tap timing. Its
  restricted-mana fixture already uses the catalog DSL definition, so it remains
  intact and passes after the old readers are removed.
- `cardPlugins/dsl/resolutionPayment.test.ts` and `manaLoss.test.ts`: preservation
  of restricted pool state on rejected payment and cleanup on mana loss.
- `cardPlugins/liveTableMana.test.ts`: planner funding and refusal for catalog
  Cavern of Souls and Delighted Halfling.

No card registration or fingerprint baseline allowance changed. The catalog
test remains structural, and the unrelated mana-choice and token fixtures stay
with their owning roadmap slices.
