# Ostory TV

Ostory TV is an AI-assisted video production workspace. It organizes a project
from script and visual design through storyboard, audio, video generation, and
final delivery while preserving user choices and generation history.

## Design principles

- Generated media is a **candidate take**. A user's selected take is explicit
  state and must never be overwritten by a late asynchronous result.
- Upstream edits create **stale markers** for affected downstream content. They
  do not delete media or automatically spend credits on regeneration.
- Asset bindings use **project defaults with shot-level overrides** and are
  resolved immediately before a generation task is submitted.
- Storyboard entities carry stable **lineage identifiers**, allowing results to
  attach safely after a storyboard revision.
- AI script edits are represented as structured patches and require user review
  before they become the active version.

The detailed contracts live in [docs/architecture/overview.md](docs/architecture/overview.md)
and [docs/architecture/content-workflow.md](docs/architecture/content-workflow.md).
The remaining publication gates are tracked in
[docs/open-source-readiness.md](docs/open-source-readiness.md).

## Repository layout

- `deploy/`: FastAPI backend, workers, migrations, operational tooling, and tests.
- `deploy/new_html/`: main React application.
- `studio/`: free-creation canvas that reuses the public application services.
- `docs/`: current architecture, contributor, deployment, and product guidance.

## Local development

Backend requirements depend on the enabled providers. Start with the example
configuration files under `deploy/configs/` and `deploy/containers/`; never add
real credentials to the repository.

Frontend:

```bash
cd deploy/new_html
npm install
npm run dev
```

Verification:

```bash
cd deploy/new_html
npm test -- --run
npm run build

cd ../..
python -m pytest -q deploy/tests
python deploy/scripts/check_route_contract.py
python deploy/scripts/check_open_source_hygiene.py
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Security issues
must follow [SECURITY.md](SECURITY.md) rather than a public issue.

## License

A public license must be selected and added before the first open-source release.
Until a `LICENSE` file is present, the repository is source-available for review
but does not grant redistribution rights.
