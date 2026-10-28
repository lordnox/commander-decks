# Pull request titles

Titles must be:

```text
<area>: <imperative summary>
```

Numbered Rule DSL plan work uses `Part N` after the area:

```text
dsl: Part 11 resumable replacement processing
dsl: Part 13 static modifiers and activation restrictions
dsl: Part 15 partial conformance tests
```

| Area | Use for |
| --- | --- |
| `dsl` | Rule DSL schema, compiler, driver, and plan parts |
| `rules` | Other rules-engine behavior |
| `decks` | Stored deck lists, primers, tags, rankings |
| `live` | Live host / protocol |
| `server` | Game server package |
| `site` | Replay UI |
| `docs` | Documentation-only changes |
| `ci` | Workflows and repo checks |
| `chore` | Tooling and cleanup that is none of the above |

Do not end the title with a period. GitHub Actions workflow **PR title** rejects other shapes. Mark that check required on `main` if new PRs should be blocked until they match.

Rename an existing PR with `gh pr edit <n> --title 'dsl: Part 11 resumable replacement processing'`.

## Area labels

Every issue and PR must have at least one area label from the table above. Add
other area labels for areas it substantially concerns. Preserve other labels such
as `bug`, `epic`, or `step`. Milestones group project work separately and do not
choose the area labels.

A PR must include the label matching its title prefix. For example,
`server: persist accepted events` needs `server`; a substantial frontend change
also needs `site`. Apply labels when opening the PR, for example:

```bash
gh pr create --base main --head <branch> --title 'server: persist accepted events' --label server --body-file <description-file>
```

The **PR title** workflow checks the title and current labels, including on
`labeled` and `unlabeled` events. Mark its `title` check required on `main` to
block merging until both checks pass.

Issues use the same area labels, chosen by scope, without requiring a title
prefix. The issue form's required Area selection is applied as labels by the
**Issue area** workflow after creation. For API/CLI-created issues, supply labels
explicitly, for example `gh issue create --label server ...`. On opening,
reopening, or label changes, the workflow reports a missing area label in one
maintained comment and marks that comment resolved once a label is added. It
does not restore form selections when a label is deliberately removed. Workflows
for issues become active when their definitions reach the default branch.
