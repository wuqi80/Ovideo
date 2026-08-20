#!/bin/sh
set -eu

attempt=1
until python db_build/build_fresh_db.py; do
  if [ "$attempt" -ge 30 ]; then
    echo "Database migrations did not become ready after 30 attempts" >&2
    exit 1
  fi
  echo "Database is not ready; retrying migration in 2 seconds ($attempt/30)" >&2
  attempt=$((attempt + 1))
  sleep 2
done

exec python cluster_main.py
