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

## Dual-product synchronization

`refactor/v2` and `NewUI` are separate product branches that share the same
business behavior. Treat `refactor/v2` as the shared business mainline and
merge it forward into `NewUI`; keep NewUI-only branding, navigation, layout,
and interaction changes isolated from shared domain behavior.

For every shared change:

1. Assess both products, including persistence, API, task, credit, notification,
   provider, GPU-agent, and deployment effects.
2. Preserve the `refactor/v2` implementation for shared business behavior and
   migrations when resolving forward-merge conflicts.
3. Preserve the `NewUI` product shell and the SHOTFORGE design contract unless
   the task explicitly changes the NewUI experience.
4. Run the focused tests for both the shared behavior and the NewUI surface,
   followed by the relevant full suites and production builds.
5. Record intentional product differences instead of silently allowing the
   branches to drift.

Ovideo is a product and architecture reference, not a Git merge source. Adopt
its compatible product principles through Drama's PostgreSQL/FastAPI/React
architecture. The authoritative mapping and rollout rules live in
`docs/product-sync-contract.md`.
