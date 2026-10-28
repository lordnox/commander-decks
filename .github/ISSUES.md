# Defect reporting

GitHub Issues is the repository's record of known code defects:
[commander-decks issues](https://github.com/lordnox/commander-decks/issues).

Whenever you find or investigate a possible code defect, check that record first.
Search open issues by the affected file or subsystem, failing test name, and
observed symptom. Check relevant closed issues for previous fixes or recurrence.
Read matching issues before deciding that a failure is new, unrelated, or safe to
defer. Link existing reports rather than creating duplicates.

## Area labels

Give every issue at least one area label from the
[shared issue/PR area table](PULL_REQUESTS.md#area-labels), plus any other area it
substantially concerns. Keep existing type, priority, and hierarchy labels.
Milestones are separate; choose areas from the issue's scope, not its milestone.
Issue titles do not need PR-style area prefixes.

Pass `--label <area>` to `gh issue create`. Agents must check and add relevant
area labels before creating or updating an issue. This is an agent/contributor
rule, without automated label enforcement.

## Choose the right place

- A defect introduced by, or specific to, an open PR belongs in that PR's review
  comments. Give the author a precise location, reproduction, and expected versus
  actual behavior. Do not create a duplicate issue for the same finding.
- A defect already present on the PR's base branch, or independent of the PR,
  belongs in a GitHub issue. Reproduce it on the base before calling it an existing
  failure. Link the issue from the PR when it affects review or validation.
- If the origin is uncertain, state that uncertainty and the revisions tested.
  Do not label a failure pre-existing merely because it appears unrelated.

Use the current task's authorization when posting reports. Checking existing
issues is read-only; a reporting rule does not authorize unrelated external posts.

## Keep each issue focused

One issue describes one independently actionable problem. Do not use "and" in
issue titles. If the title needs "and", split the report
rather than just changing its wording. Multiple failing tests may be evidence for
one problem, but a shared subsystem or discovery session is not proof of a shared
root cause. Separate independently reproducible defects when their causes or fixes
differ. Use links between related reports.

Keep PR findings in the PR even if the same review also uncovers baseline defects.
When correcting a mixed report, remove the PR findings from the issue and link to
their review comments; retain the issue's history where practical.

## Make the defect reproducible

Include enough information for another contributor to reproduce the failure
without access to the discovering agent's workspace:

- Exact commit, affected files, failing test names, and relevant runtime versions.
- Setup steps, dependencies, commands, and required fixtures or input data.
- A minimal sequence of actions or a focused test command for each symptom.
- Expected and actual results, including relevant error output or observed state.
- Whether it reproduces on the base branch, PR head, or both, with their revisions.
- Clear completion criteria. Distinguish verified facts from suspected causes.

Do not rely on temporary local paths or missing private logs. Put essential
reproduction data in the report or reference committed fixtures. Exclude secrets.
Do not silently weaken assertions to make a conformance test pass; document and
justify intentional behavior changes.

Before dismissing a failure as known, verify that the existing issue describes the
same reproduction and record its link in the review or validation summary.
