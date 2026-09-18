# Stack, actions, events, and triggers

**Status: implemented.**

The stack-and-triggers pipeline is live in the kernel. This file is a short summary;
see [`DESIGN.md`](DESIGN.md) for reducer architecture and `src/rules/` for game-rule
modules. Comprehensive Rules: see [`rules-sources/README.md`](../rules-sources/README.md).

## Vocabulary

| Term | Meaning | CR |
|------|---------|-----|
| **Spell / ability** | `StackItem` from casting or triggering | 405, 601–602, 603 |
| **Action** | Stack item that resolves into events, often after a client choice | 608.2, 701.9 |
| **Event** | Input to `rules(state, event)` — atomic state change | Kernel `GameEvent` |
| **Game rule** | Always-on builtin `Plugin` (`sourceId: null`) | 701.x, 121.x |
| **Card rule** | `RuleInstance` tied to a permanent (`sourceId` set) | 603, static abilities |
| **Trigger** | Card rule: when event X, put ability on stack | 603.1–603.3 |

## Chain

```
Spell/ability resolves → Action(s) on stack → Event(s) apply → Trigger(s) on stack → …
```

Spells and abilities get full priority windows. Actions pause the kernel when a client
choice is required. Events are atomic reductions handled by game-rule plugins (not card
handlers). Triggers listen to events and put abilities on the stack for the same
priority loop.

## Client continuation

When an action needs a choice, the stack item is marked `waiting` and the host returns
state without draining further. The client resumes with **`continueAction`**:

```ts
{ type: 'continueAction', stackId, seat, payload }
```

Do not use `custom` for stack continuations. `StackItem.id` is allocated once via
`draft.allocId('stack')` and stays stable through waiting round-trips and replay.

## Where the code lives

| Area | Location |
|------|----------|
| Architecture | [`DESIGN.md`](DESIGN.md) — stack/actions/events/triggers section |
| Builtin game rules | [`src/rules/`](src/rules/) — `discard.ts`, `draw.ts`, `triggers.ts`, `actions.ts` |
| Registration | [`src/rules/main.ts`](src/rules/main.ts) — `gameRules` export |
| Types | [`src/types.ts`](src/types.ts) — `StackItem`, `GameEvent`, waiting states |
| Declarative triggers | [`src/cardPlugins/cardRules.ts`](src/cardPlugins/cardRules.ts) — `TriggerBinding` |

Draw is one card at a time (CR 121.2). Discard follows CR 701.9. Trigger detection and
APNAP ordering live in `triggers.ts` (CR 603).

## Deferred

- **Player-chosen trigger order** when one player puts many triggers on the stack from a
  single event — v1 uses timestamp / card-rules order; `orderTriggers` UI is not built.
- **Fetchlands** and **secret council** still use `custom` events and `pendingDialog`
  rather than `searchLibrary` / `vote` stack actions.
- **`selectCards` migration** — moving card-selection dialogs (`revealPick`, `putFromHand`,
  and similar) onto stack `continueAction` is in progress; many paths still use
  `pendingDialog`.
