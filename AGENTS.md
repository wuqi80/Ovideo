# Ostory TV Engineering Rules

## Mandatory impact assessment

Before changing code, identify the affected workflow, shared state, persistence fields, API contracts, and downstream consumers. Evaluate whether the change can alter other pages, historical data, background tasks, credits, notifications, or deployment behavior. Reuse established project patterns and keep unrelated worktree changes intact.

## Mandatory test loop

A change is not complete after implementation alone. Run a verification loop until it is green:

1. Add or update focused regression tests for the changed behavior.
2. Run the focused tests and fix failures.
3. Run the relevant broader test suite to detect regressions in adjacent features.
4. Run the production build and repository contract checks when the changed surface can affect them.
5. Review the final diff and `git diff --check`.

Do not report a task as complete, commit it, push it, or deploy it while a relevant regression remains unexplained. If an unrelated pre-existing failure prevents a green run, document the exact failure and its ownership instead of hiding it.

## Repository boundary

This repository is the authoritative source for Ostory TV. Sibling repositories,
private deployment worktrees, and code from other products are outside its scope.
Do not inspect, merge, mirror, or modify them while working here.

When an external implementation inspires a capability, redesign it against this
repository's own persistence, API, task, credit, notification, provider, worker,
and deployment contracts. Copying a branch, database, private configuration, or
release script is prohibited. See `docs/repository-boundary.md`.

## Open-source hygiene

- Public code must not contain private repository names, internal domains,
  personal usernames, machine paths, credentials, or migration-source labels.
- Provider and deployment configuration belongs in environment variables and
  documented examples. Never commit a usable secret.
- Historical import paths may remain only in the compatibility layer. Each shim
  must name its canonical module and explain the removal gate.
- Comments explain invariants, ownership, failure behavior, and extension points.
  Do not use comments as dated change logs or retain source-project history.
- Run `python deploy/scripts/check_open_source_hygiene.py` before release.
