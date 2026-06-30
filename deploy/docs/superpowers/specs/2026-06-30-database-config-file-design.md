# Database Config File Design

## Goal

PostgreSQL connection settings should be editable in one backend-owned file instead of requiring repeated shell exports or edits across Python modules. The change should keep deployment-friendly environment variable overrides and avoid committing real passwords.

## Current State

- Runtime database pooling reads `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and pool variables in `deploy/core/db_manager.py`.
- Compatibility config reads a nearly identical set in `deploy/core/database_config.py`.
- The fresh database builder `deploy/db_build/build_fresh_db.py` reads the same variables directly from `os.environ`.
- There is no automatic `.env` loading in the backend startup path.

## Design

Add a small loader module at `deploy/core/db_config_loader.py`.

The loader will read `deploy/configs/database.env` by default and expose helpers for database-related settings. It will support simple `KEY=value` lines, comments, blank lines, and quoted values. It will not write into `os.environ`; callers ask the loader for values so behavior is explicit and testable.

The loader will use this precedence:

1. Existing process environment variables.
2. Values in `deploy/configs/database.env`.
3. Existing hardcoded defaults.

This keeps production and CI behavior intact: systemd `EnvironmentFile`, shell exports, or container env vars can still override the local file.

## Files

- Add `deploy/core/db_config_loader.py`.
- Add `deploy/configs/database.env.example`.
- Ignore `deploy/configs/database.env` in `.gitignore`.
- Update `deploy/core/db_manager.py` and `deploy/core/database_config.py` to use the shared loader.
- Update `deploy/db_build/build_fresh_db.py` to use the same loader.
- Update the relevant run/deployment docs only where they mention PostgreSQL config entry points.

## Data Flow

At import or command execution time:

```text
caller -> core.db_config_loader.get_db_config_value()
       -> os.environ if set
       -> deploy/configs/database.env if present
       -> default value
```

The runtime connection pool and database builder will therefore resolve the same values without duplicating parsing rules.

## Error Handling

- Missing `database.env` is allowed; defaults and environment variables continue to work.
- Invalid integer values for port or pool settings should still fail clearly where they are converted, matching current behavior.
- Malformed lines in `database.env` should be ignored only if they are comments or blank lines; otherwise they should raise a clear `ValueError` naming the file and line number.

## Testing

Add focused tests for the loader:

- It loads values from a database env file.
- Process environment variables override file values.
- Defaults are used when neither source provides a value.
- Malformed config lines raise a useful error.

Add or update a database builder/config test if an existing test location fits; otherwise keep this covered through the shared loader tests and a targeted import check for `core.db_manager.DatabaseConfig`.

## Non-Goals

- Do not move all backend secrets into this database file.
- Do not remove support for environment variables.
- Do not commit real database credentials.
- Do not change PostgreSQL schema, migrations, or connection pool behavior beyond config resolution.
