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
