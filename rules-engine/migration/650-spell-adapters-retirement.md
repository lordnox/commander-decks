# Spell adapter retirement — #650

Parent: #487 / #473. Starting tree: `b9ee8790`.

## Finite checklist

- [x] Retire `alternateCast` effect authoring, discovery, generic legacy conditions,
  and the obsolete Warp plugin and delayed instruction (this checkpoint).
- [ ] Retire `targetedResolve` authoring, action enumeration, executor and legacy
  stack-copy target validation; migrate its explicit-effects fixtures.
- [ ] Retire remaining noncanonical spell dispatch/completion and residual
  `handler` consumers in `plugins/spells.ts` and stack-copy adapters. Keep any
  temporary legacy-frame completion dependency explicit for #653.

This checkpoint does not close #650. The interpreter, legacy driver frames,
old-format persistence decoding and final residual model audit remain owned by
#652–#655. The active activation/search work in PR #683 is separate.

## Alternate casting checkpoint

Removed the `alternateCast` member of `CardEffect`, its builders (`alternateCast`,
`cleave`, `flashback`, `escape`, `warp`), `effectsOf` discovery and cost fallback,
and the legacy Adventure-option guard. Canonical Adventure legality continues
through its face and permission machinery.

`AlternateCastOption` is a server-derived choice contract, not an executable
legacy effect: it has no `op`, and only canonical zone mechanics, active printed
modifiers and spell permissions produce it. The action planner, spell admission,
Foretell and live host now consume this contract directly. Legacy-only subtype
conditions, the `__printed__` sentinel and the old Warp-exile turn flag are gone.
Canonical conditional alternative costs still belong to announcement compilation.

Removed `plugins/warp.ts`, its format/registry wiring, `finishWarpExile` and its
handler. Canonical Warp already captures a delayed canonical program and grants
an incarnation-pinned, later-turn spell permission; it needs neither legacy
execution nor an old `warp-from-exile` casting option.

## Coverage crosswalk

All three callbacks (17 pinned assertion sites) in the retained mechanic owner
`plugins/warp.test.ts` move into `cardPlugins/dsl/warp.test.ts`, with a minimal
canonical fixture. The pinned ownership inventory is unchanged.

| Retired source callback | Canonical destination / equivalent assertions |
| --- | --- |
| casts for warp or normal mana from hand and only warped spells schedule end-step exile | Same title under `canonical warp casting lifecycle`: legal action label, normal and Warp stack/battlefield behavior, zero versus one delayed trigger, end-step condition, canonical captured program. Existing `warp creates its delayed exile during resolution, then permits only the captured exile incarnation on later turns` retains exact generic Warp payment and source-ability-loss coverage. |
| exiles the permanent at the next end step and forbids same-turn recast from exile | Same title: end-step ability source, resulting exile, canonical permission creation, no offered same-turn cast, and direct same-turn rejection even after restoring an otherwise legal main-phase timing window. The obsolete `warpExiledTurn` assertion is replaced by the current permission contract. |
| allows casting from exile on a later turn for the printed mana cost | Same title: later-turn legal action is translated to a cast and succeeds after JSON restore; exact printed `{3}{G}` payment, consumed permission, battlefield completion and no second delayed trigger. Old option ID/label and turn-flag persistence assertions are superseded by the canonical permission contract. |

Other existing canonical mechanic owners remain unchanged:

- `dsl/preparedCasting.test.ts`: Foretell/Plot preparation, visibility, timing,
  later-turn casting and costs.
- `dsl/flashback.test.ts`: sacrifice cost admission/payment, targets, hand casting,
  countering/exile and journal restoration.
- `dsl/escape.test.ts`: exact exile/mana payment, invalid picks, targets and recovery.
- `dsl/castSpells.test.ts`: Retrace discard admission and life-equal-mana-value
  exile permissions, controller scope and private choices.
- `dsl/counter.test.ts` and catalog composition tests: canonical Cleave costs and
  target restrictions. No canonical card definitions change here.

The coverage ledger is regenerated. DSL authoring passes with zero allowances;
no baseline allowance is added. Rules-source reference: the official file linked
from `rules-sources/README.md`, especially 601.2, 603.7 and 608.3, for casting costs,
captured delayed abilities and permanent-spell completion.
