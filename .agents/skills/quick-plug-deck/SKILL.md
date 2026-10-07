---
name: quick-plug-deck
description: Audit and implement engine support for a resolved Commander deck with compact inventories, targeted source reads, and reusable coverage evidence. Use when the user requests a quick or token-efficient plug or full-deck support check; do not claim complete support from registration alone.
---

# Quick Plug Deck

Reach the same card-behavior coverage as plug-deck with less model context and repeated work. Change engine support, not the deck list. Follow repository Git and rules-choice requirements. Do not automatically load plug-deck's broad inventory instructions.

## Cheap inventory first

Resolve the requested deck and run its existing validator. Reuse the session worktree; create one if needed. Generate a compact inventory without fetching Scryfall or loading the engine tree:

```bash
bun .agents/skills/quick-plug-deck/scripts/inventory.ts decks/<deck> /private/tmp/<deck>-engine-inventory.json
```

The file contains every included unique card, quantities, Oracle text for each face, candidate registrations, effect kinds, handler IDs, and input fingerprints. Console output is counts only. A registration is a search lead, never a supported verdict. No registration can be correct for behavior handled entirely by built-in rules. Tokens and alternate faces still require coverage.

Read rules-engine/DESIGN.md once. Keep a compact coverage file beside the inventory: one row per Oracle ID with `covered`, `gap`, or `unknown`, exact behavior gap, source/test evidence, and dependency. Include basic lands. Do not dump all cache objects, source modules, or passing test output into context. Read inventory in batches, then use `rg` and narrow line ranges to inspect relevant registrations, builders, and tests. Follow only imports needed to establish behavior.

Reuse earlier coverage only when its Oracle fingerprint and relevant implementation/test evidence remain valid. An unchanged deck plus a changed engine revision is a lead for diff inspection, not proof of unchanged support. Verify evidence instead of trusting a previous agent's completion statement. Every Oracle clause must be accounted for, including restrictions, modes, other faces, and printed keywords; group duplicate behaviors instead of auditing the same mechanism per card.

## Close confirmed gaps

Finish the complete inventory before editing. Deduplicate gaps by reusable capability and list dependent cards. Mark uncertain behavior `unknown`; inspect or test it rather than inventing a missing rule. Reuse existing builders and shared handlers; no empty registrations or name checks added solely to satisfy the checklist.

For implementation, use [implement-reviewed](../implement-reviewed/SKILL.md). Give agents only the work item, base/worktree, affected Oracle clauses, and relevant evidence paths. Ask for compact results: commits, changed behavior, tests, unresolved items. Keep reusable-rule changes and card wiring in separate commits, ordered by dependency. Batch related cards sharing a capability into a reviewable slice; do not launch one agent per already-supported card. Reaudit affected rows after each accepted slice and revisit other rows only if shared behavior changed. Use the stricter two-pass [plug-deck](../plug-deck/SKILL.md) workflow if cross-cutting gaps cannot be safely isolated; retain this compact inventory and evidence rather than restarting discovery.

When triggers, priority, state-based actions, or player choices are involved, read rules-sources/README.md and the cited official sections. Choices need complete pending-state, privacy, protocol/UI, resume, and restart behavior. Card pickers use typed `selectCards`, never `custom`. Normal supported paths must not use judge fallback.

## Verify and stop

Use existing behavior tests as evidence when they match current Oracle text. Add focused regression tests for changed behavior and meaningful boundaries, not one ceremonial test per name. Include live host/UI, hidden-information, and restart tests when choices or integration change. Execute dependent tests once per changed slice; keep full logs in temporary files and expose summaries/failures only.

Before publishing engine changes, run the repository's required checks:

```bash
bun test rules-engine live-runner site/src
bun run lint
bun run typecheck
bun run typecheck:live-runner
bunx vite build
```

Run broad checks once after integration; repeat relevant checks only after edits, failures, or unresolved concerns. Report pre-existing failures with baseline evidence. An audit-only run with no changes can use matching existing tests without running the full build.

Finish by checking all inventory rows and produced tokens against fallback/unsupported paths and current evidence. Report quantities and unique cards, covered/gap/unknown counts, implementation commits or PR, checks, and remaining limitations. Only say the whole deck is supported when every included card and required token/face behavior is covered; unknown counts must be zero. Token savings come from compact output, reuse, and deduplication—not skipped clauses, tests, or unresolved behavior. Keep the coverage artifact for resuming unfinished work.
