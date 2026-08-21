# Open-source release readiness

The working tree is prepared for review, but public release has three explicit
gates that cannot be decided by a source-code rename alone.

## Required release decisions

1. **License** — add the chosen license and verify third-party notices. Until a
   license file exists, the source does not grant redistribution rights.
2. **Database baseline** — applied migration files are checksum-locked for
   existing installations. Publish either a clean squashed baseline for new
   installations plus a one-time adoption procedure, or retain the isolated
   historical migrations as a compatibility archive.
3. **Git object history** — deleting a file from the current revision does not
   remove it from old commits. Publish from a fresh, reviewed history or perform
   an explicitly authorized history rewrite before making the remote public.

## Automated gate

`python deploy/scripts/check_open_source_hygiene.py` scans the effective working
tree for private repository references, migrated product identifiers, machine
paths, personal fixtures, and credential-shaped literals. It reports rule names
and locations without echoing discovered values.

Applied migration SQL is the only narrow identifier exception. The exception is
path-scoped and tested; current runtime code, UI, documentation, examples, and
deployment tooling receive no exception.

## Manual review

- Confirm every dependency and copied asset is license-compatible.
- Remove generated media, production exports, logs, databases, and backups.
- Verify example configuration contains placeholders only.
- Build both frontends, run backend and frontend tests, and run route contracts.
- Inspect the final clean repository from a new clone before changing visibility.
