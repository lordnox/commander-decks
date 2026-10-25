---
name: start-issue
description: Start implementation of a GitHub issue after checking existing ownership and active work, claim available work, and split oversized issues into linked sub-issues before implementing the first. Use for requests to take, tackle, pick up, or work on an issue; not for read-only issue triage.
---

# Start an issue

Carry the requested issue into implementation, following the repository's instructions and delivery requirements. Claiming or decomposing the issue is preparation, not the final deliverable. Invoking this workflow authorizes issue claims, progress comments, and necessary sub-issue creation for the requested work; it does not authorize messaging unrelated people, merging, or deployment.

## Check availability before changing anything

Resolve the repository from the issue URL or current checkout. Read applicable AGENTS.md files and contribution, issue, and PR policies. Fetch the issue's complete body, state, assignees, labels, project status when accessible, comments, linked PRs, and existing sub-issues. Check open PRs that reference the issue even if they are not formally linked. Inspect local worktrees and branches, and available task state where useful, for evidence that another session is already implementing it.

Prefer a connected GitHub tool when it supports the operation; otherwise use authenticated `gh`. Treat missing access as unknown availability, not evidence that nobody is working on it.

An assignee, an in-progress project status or label, an open implementation PR, or an unreleased work claim is evidence of ownership. An assignee alone does not prove active implementation, but must not be silently overwritten. A claim by the same GitHub account may belong to another agent session. Old timestamps alone do not release a claim.

- If this session already owns the work, resume its branch and PR rather than duplicating them.
- If another person or session owns it, report the evidence with links and ask whether to coordinate or take over. Do not overwrite ownership or start overlapping implementation without authorization.
- If closed, verify whether work remains before reopening or implementing; explain the resolution if already done.
- If ownership cannot be established because required access is unavailable, report the blocker and continue only independent read-only investigation.

## Claim available work

Inspect the repository's existing claim convention. Reuse its in-progress label or project status when available; do not invent a new label taxonomy or alter unrelated project fields. Assign the authenticated user where appropriate and permitted. Also post a concise claim comment identifying this session's intended scope and unique branch or worktree, so separate sessions using one account can distinguish ownership. A claim comment is the fallback marker when assignment or status updates are unavailable.

Immediately re-read ownership and recent comments before claiming, and verify the result afterward. These operations are not an atomic lock: if a competing claim appears, stop overlapping mutations and resolve ownership with the user. If no durable claim can be written, report that blocker instead of silently proceeding as owner.

Use the repository's branch/worktree policy. Do not share another session's checkout. Preserve unrelated local changes.

## Size the work from evidence

Read the relevant source and tests before deciding whether to split. Use the issue's acceptance criteria and technical dependencies. A normal issue with several implementation steps can remain one issue. Split when it contains independently deliverable outcomes, when one reviewable PR would cross several separable subsystems, or when unresolved dependencies prevent a coherent implementation and validation pass. Avoid arbitrary line-count or time limits.

For oversized work:

1. Inspect existing child issues and related reports; reuse matching work rather than creating duplicates.
2. Define focused slices with clear acceptance criteria, relevant context, dependencies, and validation expectations. Each child should be reviewable on its own and contribute directly to the parent. Follow repository title rules.
3. Create missing children and attach them using GitHub's native sub-issue relationship when supported. If unavailable, use reciprocal parent/child links plus a parent checklist and disclose the fallback. Preserve existing parent content; do not close it merely because it was split.
4. Order the children by dependency and choose the first unblocked implementation slice. If a prerequisite child is already owned, do not duplicate it; choose another independent slice or report the dependency.
5. Update the parent's claim/status to explain that it tracks decomposition and progress, and identify the active child. Apply the same availability check and durable claim to that child before implementation.

If creation or linking partially fails, inspect what succeeded and resume from that state rather than recreating issues. Report any remaining tracking limitation explicitly.

## Implement and deliver

Start coding the selected issue in the same turn after claiming it. Follow applicable domain skills and repository requirements for implementation, tests, commits, PR creation, and hosted CI. Do not introduce agent delegation unless separately authorized by the user or applicable instructions.

Keep changes scoped to the selected issue. Link the implementation PR to that issue; when working on a child, do not use closing syntax for the parent. Update progress comments when the scope changes or work is blocked. On interruption or failure, leave an accurate status and the branch/PR needed to resume; do not report abandoned work as actively progressing. Release an unused claim when abandoning it, without removing someone else's ownership.

Finish with the issue and PR links, any created sub-issues, what was implemented, validation results, and unresolved blockers. Distinguish local checks from hosted CI. For split work, explicitly identify the completed or active child and the remaining children; do not claim the parent is complete until all its acceptance criteria are met.
