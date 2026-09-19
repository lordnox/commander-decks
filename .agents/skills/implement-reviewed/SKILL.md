---
name: implement-reviewed
description: >-
  Implement a list of work items with a fresh implementer agent per part,
  then a different reviewer agent, looping until they agree the code does
  the job without too much technical debt. Rebase reviewed part branches
  into one mergeable PR. Use when the user wants implement-then-review
  agents, a multi-part implementation list, isolated temporary branches
  rebased together, or a single PR after several reviewed slices.
---

# Implement reviewed

The parent agent orchestrates. Do not implement the list in this
conversation except to split work, resolve rebase conflicts, and open
the final PR.

## Core loop (verbatim)

Create an agent to implement it. When finished create another, different
agent, to review it. Do this until you agree that the code does what it
has to do and does not create to much technical dept.

When all parts are implemented, in different temporary branches, rebase
them together and publish this as a single mergeable PR.

("dept" means technical debt.)

## 1. Split the list

1. Turn the user's list into ordered **parts**. One part = one
   independently reviewable slice (one concern, one testable outcome).
2. Name each part (`part-1-…`). Record dependencies. Independent parts
   may run in parallel; dependent parts wait on the reviewed predecessor
   branch.
3. Do not open a PR per part.

## 2. Implement one part

Launch a **new** `best-of-n-runner` (isolated worktree). Do not reuse
an implementer from another part. Do not review in the same agent.

Tell it:

- Unique branch `agent/<task>-<part>` from `origin/main`, or from the
  reviewed predecessor when the part depends on it.
- Follow repo skills that own the domain (`plug-deck`, KISS/DRY, tests).
- Commit in that worktree. Do **not** push or open a PR.
- Return: worktree path, branch name, commit range vs base, what changed,
  how to verify.

## 3. Review with a different agent

When the implementer finishes, launch a **new** `generalPurpose` agent.
Never resume the implementer as the reviewer. Never resume a reviewer
as the next implementer.

Give the reviewer the worktree path, branch, base SHA, part goal, and
diff command (`git diff <base>...<head>`). It must:

- Check the part does what it has to do.
- Flag extra abstractions, copies, unused leftovers, and other
  technical debt.
- Reply with exactly one verdict: `ACCEPT` or `REQUEST CHANGES`, plus
  a short list of must-fix items (empty on `ACCEPT`).

On `REQUEST CHANGES`, **resume** the implementer with those items. Then
launch a **new** reviewer on the updated branch. Repeat the implement →
review pair until `ACCEPT`.

Stop and ask the user if a part is still not accepted after four review
rounds.

## 4. Rebase together and publish one PR

After every part has `ACCEPT`:

```bash
git fetch origin
git worktree add -b agent/<task> ../commander-decks-<task> origin/main
cd ../commander-decks-<task>
# in dependency order; use each part's reviewed commit range
git cherry-pick <part1-first>^..<part1-last>
git cherry-pick <part2-first>^..<part2-last>
```

Resolve conflicts in this integration worktree. Do not amend published
commits. Do not force-push part branches.

Then inspect the full combined diff, drop unrelated cache/registry
noise, push, and open one ready-for-review PR (`draft: false`):

```bash
git push -u origin HEAD
gh pr create --base main --head agent/<task>
```

If `gh` is missing, return
`https://github.com/<owner>/<repo>/compare/main...agent/<task>?expand=1`.

Register the PR with `link_pull_request` (full URL). Return that URL.

A PR that changes an existing `decks/<deck>/decklist.txt` must include
`## Cards in / Cards out` from
`python3 .agents/skills/deck-workspace/scripts/deck_change_table.py`.

Do not delete part worktrees unless the user asks.
