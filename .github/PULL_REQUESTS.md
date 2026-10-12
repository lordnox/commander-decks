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
| `site` | Replay UI |
| `docs` | Documentation-only changes |
| `ci` | Workflows and repo checks |
| `chore` | Tooling and cleanup that is none of the above |

Do not end the title with a period. GitHub Actions workflow **PR title** rejects other shapes. Mark that check required on `main` if new PRs should be blocked until they match.

Rename an existing PR with `gh pr edit <n> --title 'dsl: Part 11 resumable replacement processing'`.
