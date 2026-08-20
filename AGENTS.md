# Engineering Completion Rules

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

## Repository and product boundary

This repository is the authoritative Ostory TV product repository:

- `wuqi80/Ovideo` branch `main` deploys to `https://tv.ostory.ai`.
- `wuqi80/Drama` branch `refactor/v2` remains the separate SPTI product and
  deploys to `https://spti.ai`.
- `Drama/NewUI` is a migration source only. Do not resume branch-based forward
  merges after the repository cutover.

Do not automatically merge, mirror, or push changes between Ovideo and Drama.
When a business capability is intentionally needed by both products, assess it
independently for persistence, API, task, credit, notification, provider,
GPU-agent, and deployment effects, then port only the reviewed change with its
tests. Product branding, navigation, defaults, configuration, data, secrets,
release metadata, and deployment scripts remain isolated.

For Ostory TV changes, run the focused and broader tests against this repository
and deploy only through the Ostory production path. Never run an SPTI deployment
script against the Ostory environment or copy a full production database between
the products. The authoritative boundary and rollout rules live in
`docs/product-sync-contract.md`.
