# Attached-copy legacy retirement

This is child issue [#632](https://github.com/lordnox/commander-decks/issues/632) under DSL retirement parent #487, based on `origin/main` at `71771882`. It removes the remaining legacy `attachedCopyOrToken` instruction and its custom `may-pay-mana` dialog handler. There is no catalog registration for this instruction; the old suite used only a manually mutated Springheart fixture. The canonical Springheart-style program already lives in `cardPlugins/dsl/bestow.test.ts`.

| Retired legacy assertion | Canonical owner and retained evidence |
| --- | --- |
| `cardPlugins/bestow.test.ts`: landfall creates a copy of the enchanted creature when the optional `{1}{G}` payment is accepted; no Insect is made; the exact mana pool is spent | `cardPlugins/dsl/bestow.test.ts`: the canonical landfall test selects `pay`, checks two Grizzly Bears, no Insect, and the exact depleted mana pool. The pending typed choice asserts that `p1` owns the choice, its source id is the Bestow spell, and the requested mana cost is `{1}{G}`. |
| `cardPlugins/bestow.test.ts`: the custom dialog exposes `kind: may-pay-mana`, cost `{1}{G}`, and Bestow source id | Superseded by the canonical typed request in `cardPlugins/dsl/bestow.test.ts`, which retains the chooser, source id, and `{1}{G}` cost. Prompt wording, option labels, and the old `may-pay-mana` dialog kind were protocol details; generic payment choice behavior is owned by `cardPlugins/dsl/resolutionPayment.test.ts`, and the unused dialog kind is removed. |
| `cardPlugins/bestow.test.ts`: declining the optional payment leaves the original creature and creates one Insect | `cardPlugins/dsl/bestow.test.ts`: the same canonical landfall test selects `decline` and checks one Grizzly Bears and one Insect. |
| The old fixture was hand-attached to a creature before triggering the instruction | `cardPlugins/dsl/bestow.test.ts`: the canonical suite casts Bestow through the normal alternative-cost path before testing attached copy. Its separate unattached case verifies the fallback without opening a payment choice. |

Official Comprehensive Rules references: 603.2 (triggering), 117.2e and 608.2d (choices during resolution do not use priority), and 117.1d (mana abilities may be activated when a resolving effect asks for mana payment). The linked official rules snapshot is documented in `rules-sources/README.md`.

No card registrations, authoring allowances, pinned test inventories, or coverage ownership records are changed by this retirement.
