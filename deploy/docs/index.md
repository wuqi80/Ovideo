# Deployment documentation

The public documentation is intentionally organized by stable contracts rather
than internal incident history.

- [`../../README.md`](../../README.md): project overview and local verification.
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md): architecture, comments, and test expectations.
- [`../../docs/architecture/overview.md`](../../docs/architecture/overview.md): application layering and extension points.
- [`../../docs/architecture/content-workflow.md`](../../docs/architecture/content-workflow.md): candidates, selection, stale propagation, binding, and lineage.
- [`../../docs/architecture/compatibility.md`](../../docs/architecture/compatibility.md): compatibility shim and stored-identifier removal gates.
- [`../../docs/open-source-readiness.md`](../../docs/open-source-readiness.md): license, migration-baseline, and Git-history release gates.
- [`database.md`](database.md): canonical migration manifest and persistence rules.
- [`data-layer-reference.md`](data-layer-reference.md): DAO and table reference.
- [`agentic_testing.md`](agentic_testing.md): non-production agent test workflow.
- [`gpu2-safe-runtime.md`](gpu2-safe-runtime.md): conservative worker runtime boundaries.
- [`video-credit-pricing.md`](video-credit-pricing.md): video billing contract.
- [`diagrams/`](diagrams/): generated route and page dependency diagrams.

Container deployment is defined by `deploy/containers/` and
`deploy/scripts/deploy_ostory_podman.sh`. Generated OpenAPI is the authoritative
HTTP reference; do not maintain a second handwritten route catalog.
