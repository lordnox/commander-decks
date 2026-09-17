# Stack, actions, events, and triggers — implementation plan

Status: **plan only** — do not start implementation until this document is reviewed and approved.

Authoritative CR snapshot: [`rules-sources/MagicCompRules-20260819.txt`](../rules-sources/MagicCompRules-20260819.txt) (effective 2026-08-07).

---

## 1. Goals

Rebuild the rules-engine trigger and resolution pipeline so it matches Comprehensive Rules stack behavior:

1. **Spells and abilities** on the stack get full priority windows (respond, counter, etc.).
2. **Actions** on the stack (discard N, draw 1, choose targets) pause the kernel until the **client** supplies the choice, then resume.
3. **Events** (discard, draw, move, loseLife) are atomic kernel reductions implemented by **game rules** plugins — cards do not implement 701.9 themselves.
4. **Triggers** listen to events, put triggered **abilities** on the stack (CR 603), and resolve through the same priority loop — no synchronous `enqueue(loseLife)` shortcuts.
5. **Draw** is one card at a time (CR 121.2); triggers from each draw interleave before the next draw action resolves.
6. Existing decks, replays, live table, and ~49 rules-engine test files still pass (updated where behavior intentionally changes).

Target outcome: **rules-perfect, live-play-pauses-correctly** — the most flexible model discussed in design sessions.

---

## 2. Locked vocabulary

| Term | Meaning | CR |
|------|---------|-----|
| **Spell / ability** | `StackItem` from casting or triggering | 405, 601–602, 603 |
| **Action** | Stack item that resolves into one or more **events**, often after a client choice | 608.2 (instructions), 701.9 (discard process) |
| **Event** | Input to `rules(state, event)` — atomic state change | Kernel `GameEvent` |
| **Game rule** | Always-on builtin `Plugin` (`sourceId: null`) — e.g. discard, draw | 701.x, 121.x |
| **Card rule** | `RuleInstance` tied to a permanent (`sourceId` set) | 603, static abilities |
| **Trigger** | Card rule: when event X, put ability on stack | 603.1–603.3 |

**Chain:**

```
Spell/ability resolves → Action(s) on stack → Event(s) apply → Trigger(s) on stack → …
```

**Plugin vs Rule:** reuse existing `Plugin` type. Builtin game rules register at game start; card rules install as `RuleInstance` on ETB and remove on leave.

**Client resolver break:** when an action needs a choice, the kernel marks the stack item `waiting`, returns state to the host, and does **not** drain further events. The client sends the next event (choice made); the kernel resumes.

---

## 3. Target architecture

```
rules-sources/                    ← CR snapshot (done)
rules-engine/src/
  kernel.ts                       ← unchanged reducer loop (may need tiny hooks)
  types.ts                        ← extend StackItem, GameEvent, waiting states
  rules/                          ← NEW: builtin game rules (CR sections)
    main.ts                       ← export & register all builtins
    discard.ts                    ← CR 701.9: discard event
    draw.ts                       ← CR 121.2: one-card draw event
    triggers.ts                   ← CR 603: post-event trigger detection → stack
    actions.ts                    ← action stack items: initiateDiscard, initiateDraw, …
  plugins/                        ← existing turn/priority/combat/… (thin over time)
  cardPlugins/
    cardRules.ts                  ← declarative triggers; fewer handler files
```

**Data flow after refactor:**

```
Host: rules(state, event)
  → replace / legal / apply (game rule plugins + card plugins)
  → if stack top is `waiting`: return (host prompts client)
  → else drain queued events ONLY when not mid-stack-resolution
  → after each event apply: triggers.ts scans → addTriggeredAbility()
  → SBA loop
```

**Card definition example (Caress):**

```typescript
"Liliana's Caress": [
  staticGrant('cardTriggers'),  // or built into trigger scanner
  trigger({
    on: 'discard',
    if: { seat: 'opponent' },
    do: [loseLife(2, 'triggeringPlayer')],
  }),
]
```

No `lilianasCaress.ts` handler file.

---

## 4. Current state (gaps)

| Area | Today | Target |
|------|-------|--------|
| Discard | `discard` event, one card, no choice action | Action on stack → choice → event per card |
| Draw | `draw count: N` synchronous loop | N separate draw actions or N events with trigger pauses between |
| Triggers | `zoneTriggers` / `landfall` call `runInstructions` immediately | `triggers.ts` → stack → resolve → `runInstructions` |
| Caress | Plugin enqueues `loseLife` on `discard` | Declarative `on: 'discard'` trigger on stack |
| Ability resolve | `spells` no-ops for `kind: 'ability'`; planeswalker has own path | Single `resolveAbility` in `actions.ts` or `spells` |
| Activated abilities | `runInstructions` at activation time | Pay costs → stack → resolve |
| Pending dialog | Parallel to stack (`pendingDialog`) | Tied to stack action item (`waiting`) |
| CR reference | Now in `rules-sources/` | Cite rule numbers in game-rule module headers |

**~12 handler plugins** in `cardRules.ts` — some migrate to declarative triggers; ~6–8 stay bespoke (Homer, Pit, Sin, planeswalker loyalty, etc.).

**Frozen files** (per `DESIGN.md`): `kernel.ts`, `types.ts`, `catalog.ts`, `draft.ts`, `newGame.ts` — extending `StackItem` and `GameEvent` requires updating ownership notes in `DESIGN.md` or explicit approval.

---

## 5. Implementation phases

Each phase ends with **`bun test rules-engine`** green and a short commit. Do not start phase N+1 until phase N acceptance criteria pass.

---

### Phase 0 — Design doc & types (1–2 days)

**Work**

- [ ] Update `rules-engine/DESIGN.md` with vocabulary (action / event / trigger) and unfreeze `types.ts` for stack work.
- [ ] Extend `StackItem`:
  - `kind: 'spell' | 'ability' | 'action'`
  - `actionId?: string` — e.g. `'discard'`, `'draw'`, `'chooseTargets'`
  - `waiting?: 'choice' | 'targets' | null`
  - `payload` for action parameters (seat, count, filter, chosen ids)
- [ ] Add `TriggerBinding` type for declarative card triggers (`on`, `if`, `do`).
- [ ] Add `draft.addToStack(item)` and `draft.addTriggeredAbility(source, instructions, meta)` helpers on `Draft`.
- [ ] Document CR citations in module headers (603.3, 701.9, 121.2).

**Acceptance**

- Types compile; no behavior change yet.
- One unit test: construct a `StackItem` action with `waiting: 'choice'`.

---

### Phase 1 — Ability resolution path (2–3 days)

**Work**

- [ ] Centralize `resolveTop` for `kind: 'ability'`: pop item → `runInstructions` → priority to active.
- [ ] Merge planeswalker loyalty resolve into shared path (keep loyalty cost payment at activation).
- [ ] Fix `spells.ts` ability branch (currently pops and returns without effect).
- [ ] Activated non-mana abilities: pay costs → push ability on stack → resolve via shared path (not `runInstructions` at activate time).

**Acceptance**

- Existing `planeswalker.test.ts`, `spells.test.ts` (ability source stays on battlefield) pass.
- New test: activate `{T}: draw 1` → ability on stack → pass → card drawn.

**CR:** 602.2, 608.2.

---

### Phase 2 — Game rule: discard (2–3 days)

**Work**

- [ ] Move `plugins/discard.ts` → `rules/discard.ts` (re-export from old path during migration).
- [ ] Implement **discard event** (701.9a): hand → graveyard for one known `objectId`; distinct from `move`.
- [ ] Implement **discard action** stack item:
  - `initiateDiscard({ seat, count, chooser, random? })`
  - On resolve start: if cards not chosen, set `waiting: 'choice'`, return.
  - Client sends `continueAction` / `custom` with chosen `objectIds`.
  - Fire one `discard` event per card (701.9b — each discard triggers separately).
- [ ] Tests for 701.9a/b: single discard, discard 2 triggers twice.

**Acceptance**

- `lilianasCaress.test.ts` still passes **only after Phase 3**; for Phase 2, discard action → events move cards correctly.
- New: `rules/discard.test.ts` with CR references in test names.

**CR:** 701.9, 701.9a–c.

---

### Phase 3 — Trigger bus (3–4 days)

**Work**

- [ ] Add `rules/triggers.ts` plugin:
  - After each applied event, scan battlefield `RuleInstance`s and object `effects` for matching `on: event.type`.
  - Evaluate `if` conditions (`opponent`, `controller`, etc.).
  - `addTriggeredAbility` for each trigger (APNAP: active player first, then turn order — CR 603.3b).
  - Do **not** run `do` until ability resolves.
- [ ] Extend `CardEffect` trigger union: `on: 'discard' | 'draw' | …` (map `GameEvent.type` → trigger `on`).
- [ ] Add `loseLife` instruction variant: `who: 'triggeringPlayer' | 'controller'`.
- [ ] Migrate **Liliana's Caress** to declarative trigger; delete `lilianasCaress.ts`.
- [ ] Wire `staticGrant` / ETB so card triggers are active while permanent on battlefield.

**Acceptance**

- Caress: opponent discards → trigger on stack → pass → lose 2 life.
- New: respond to Caress trigger (cast instant before life loss) — stack non-empty between discard event and life loss.
- Caress controller discarding does not trigger.
- Caress leaving battlefield stops triggering.

**CR:** 603.1–603.3, 603.4 (intervening-if if needed later).

---

### Phase 4 — Game rule: draw (2–3 days)

**Work**

- [ ] Move draw logic from `hiddenInformation.ts` into `rules/draw.ts` (server still owns library identity).
- [ ] **Draw action**: one card per stack item (`initiateDraw({ seat, count: 1 })`).
- [ ] Spell instruction `draw(N)` expands to N draw actions enqueued on stack (or one action that sequences N stack steps).
- [ ] After each draw **event**, trigger bus runs before next draw action resolves.

**Acceptance**

- New fixture: **Queza** + **Ancestral Reminiscence** (or minimal `{ draw 3; discard 1 }` sorcery + `on: draw` trigger):
  - Order: draw → Queza trigger → resolve → draw → Queza trigger → … → discard action → discard event.
- Turn structure draw step still draws one card.
- Empty library still causes loss.

**CR:** 121.2, 121.2a–c.

---

### Phase 5 — Actions on stack + client resolver break (3–5 days)

**Work**

- [ ] `rules/actions.ts`: resolve `kind: 'action'` in `resolveTop`.
- [ ] Unify `pendingDialog` with stack: dialog opens when action enters `waiting`; `chosenEvent` completes action and fires events.
- [ ] `live-runner/kernelHost.ts`: detect `stack[0].waiting`, publish `lobby.topdeck` / choice UI, dispatch continuation event.
- [ ] `rules-engine/actions.ts` (available actions): expose pass priority, respond, continue waiting action.
- [ ] Priority plugin: do not auto-resolve while `stack[0].waiting`.

**Acceptance**

- Cry of Contrition fixture: cast → resolve → discard action on stack → P2 chooses → discard event → Caress trigger → pass → life loss.
- Live-runner test: kernel pauses with `waiting` until decision dispatched.
- `kernelHost.test.ts` updated; no infinite pass loops.

**CR:** 608.2, 117.3 (priority).

---

### Phase 6 — Unified trigger dispatch (4–5 days)

**Work**

- [ ] Fold `zoneTriggers`, `landfall`, simple `onResolve` triggers into `triggers.ts` + event-type dispatch.
- [ ] Keep separate plugins only where CR needs special timing (cast triggers with modal — `castTriggers.ts`).
- [ ] Landfall / enters / attacks / dies: trigger on stack, then resolve (update ~15 tests that expect synchronous tokens).
- [ ] `extraTriggerCount` (Roaming Throne) still applies at trigger-detection time.

**Acceptance**

- `landfall.test.ts`, `zoneTriggers.test.ts`, `selfMill.test.ts` (Six attacks) pass with stack semantics.
- Six: declare attackers → attack trigger on stack → resolve → mill 3 + revealPick dialog.

**CR:** 603, 510.1 (attack triggers).

---

### Phase 7 — Handler migration wave 1 (3–4 days)

**Declarative (delete handler file):**

- [ ] Liliana's Caress (phase 3)
- [ ] Sygg (may-draw dialog → action + trigger)
- [ ] Rankle (partial — modes may stay in handler)

**Keep bespoke handlers:**

- Homer, Pit of Offerings, Sin, Teferi Sunset, secretCouncil, reinsOfPower, fight, librarySearch, choiceEffects (complex dialogs).

**Acceptance**

- `rankle.test.ts`, `sygg.test.ts` pass.
- `registry.test.ts` / `handlerIdsFromEffects` updated.

---

### Phase 8 — Replay & simulate-table (2–3 days)

**Work**

- [ ] `replay.ts`: emit `continueAction` / discard choices where recorded; stack pauses round-trip.
- [ ] Table games: verify JSON replay still validates.
- [ ] `render-table-replay`: stack display shows actions and waiting state.

**Acceptance**

- Committed example replay in `table-games/` still renders.
- `replay.test.ts` green.

---

### Phase 9 — Integration & regression (2–3 days)

**Work**

- [ ] Full `bun test rules-engine`
- [ ] `live-runner` tests
- [ ] Spot-check `simulate-table` on one stored deck game
- [ ] Update `rules-engine/README.md` and `DESIGN.md` pipeline section
- [ ] Add `rules/main.ts` to `formats.ts` builtin list

**Acceptance**

- All tests green.
- Manual checklist below signed off.

---

## 6. Reference scenarios (acceptance fixtures)

Implement named tests for these — they are the contract for “everything works”:

### A. Cry + Caress

```
P3 controls Caress. P1 casts Cry targeting P2.
→ Cry on stack → all pass → Cry resolves
→ Action: P2 discards 1 (waiting)
→ P2 chooses card → discard event
→ Trigger: Caress (P2 loses 2) on stack
→ all pass → life loss event
```

### B. Ancestral + Queza

```
P1 controls Queza. P1 casts Ancestral Reminiscence.
→ resolve → Draw 1 action → draw event → Queza trigger → resolve
→ Draw 1 → draw event → Queza trigger → resolve
→ Draw 1 → draw event → Queza trigger → resolve
→ Discard 1 action → discard event
```

### C. Response windows

```
After Caress trigger on stack, P3 casts Lightning Bolt before life loss.
Bolt resolves, then Caress resolves.
```

### D. Six attacks

```
Six attacks → attack trigger on stack → resolve → selfMill(3) events
→ revealPick action (waiting) → client picks land
```

### E. Landfall (Scute Swarm)

```
Play land → landfall trigger on stack → pass → create Insect token.
```

---

## 7. Testing strategy

| Layer | What |
|-------|------|
| **Unit** | Each `rules/*.ts` module: discard, draw, triggers, actions in isolation |
| **Integration** | Named scenarios A–E above |
| **Regression** | All 49 existing `rules-engine/**/*.test.ts` — update expectations where stack timing changes |
| **Live** | `kernelHost.test.ts` — waiting stack, dialog continuation |
| **Replay** | Round-trip one committed table game |

**Rule:** any test that encoded wrong behavior (synchronous triggers) gets updated with a comment citing the CR fix.

**CI:** `bun test rules-engine` on every phase commit.

---

## 8. Migration & rollback

- **Parallel paths:** keep `plugins/discard.ts` re-exporting `rules/discard.ts` until Phase 6 complete.
- **Feature flag (optional):** `state.data.stackTriggersV2` for one PR if big-bang is too risky; prefer sequential phases without flag.
- **Rollback:** each phase is one or more commits; revert phase boundary if acceptance fails.

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Frozen `types.ts` / `kernel.ts` | Phase 0 updates DESIGN.md ownership; minimal kernel changes |
| 49 tests break at once | Phase sequentially; landfall migration last among triggers |
| Live-runner desync | Phase 5 dedicated; waiting state in stack snapshot |
| Replay without choices | Phase 8; deterministic choice from replay JSON |
| Handler sprawl returns | Declarative triggers only when no bespoke dialog/randomness |

---

## 10. Effort summary

| Phase | Days (estimate) |
|-------|-----------------|
| 0 Types & docs | 1–2 |
| 1 Ability resolve | 2–3 |
| 2 Discard | 2–3 |
| 3 Trigger bus + Caress | 3–4 |
| 4 Draw one-at-a-time | 2–3 |
| 5 Client resolver break | 3–5 |
| 6 Unified dispatch | 4–5 |
| 7 Handler migration | 3–4 |
| 8 Replay | 2–3 |
| 9 Integration | 2–3 |
| **Total** | **~24–35 days** focused work |

Phases 0–5 deliver the core architecture (Caress + Cry + client pause). Phases 6–9 complete rules-perfect coverage.

---

## 11. Pre-implementation checklist (for reviewer)

- [ ] Vocabulary (action / event / trigger) agreed
- [ ] `Plugin` reused for game rules — agreed
- [ ] Client owns choice resolution for waiting stack items — agreed
- [ ] Draw one-at-a-time (121.2) — agreed
- [ ] CR snapshot location — done (`rules-sources/`)
- [ ] Frozen file policy for `types.ts` — approve extensions
- [ ] Acceptance scenarios A–E sufficient
- [ ] Phase order acceptable (can parallelize 2+4 only after 3)

---

## 12. Open questions (resolve before Phase 5)

1. **`continueAction` event shape** — `{ type: 'continueAction', stackId, payload }` vs extend `custom`?
2. **Stack item identity in replay** — stable `id` for waiting actions across client round-trips?
3. **APNAP for simultaneous triggers** — full CR 603.3b in Phase 3 or defer to Phase 6?

Recommend: decide (1) and (2) in Phase 0; implement full APNAP in Phase 3 (needed for Caress + multiple permanents).

---

## 13. What we are NOT doing in v1

- Full CR coverage (only discard, draw, triggers, stack priority path)
- Rewriting all ~200+ `CARD_RULES` entries at once
- Replacing `CardInstruction` DSL (keep `runInstructions`; change when it runs)
- Splitting `cardRules.ts` into per-card files (future cleanup)
- cEDH-level shortcut rules (unless explicitly tested)

---

*End of plan.*
