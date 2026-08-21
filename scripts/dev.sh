#!/usr/bin/env bash
#
# One-command local dev bootstrap: makes sure Postgres is running (starting
# it via Homebrew and creating the coldtake role/db if this machine has
# never had them, falling back to a clear error if there's no way to start
# Postgres at all), makes sure .env exists, installs deps, applies pending
# Drizzle migrations, optionally reseeds, then execs `pnpm dev` — which now
# serves the frontend AND the api/**/*.ts Vercel Functions together (see
# vite-plugins/api-dev-server.ts), so this single command is everything
# needed for local development.
#
# Usage:
#   ./scripts/dev.sh [--seed] [--skip-install] [-h|--help]
#
#   --seed           Also run `pnpm db:seed` after migrating. This DELETES
#                     and reinserts all seed data (seed/run.ts resets rows
#                     in FK-safe order before reloading seed/*.json) — it is
#                     NOT run by default so it never clobbers a developer's
#                     existing local data.
#   --skip-install    Skip `pnpm install` (useful if you just ran it).
#   -h, --help        Show this help and exit.
#
# Postgres is started in this order:
#   1. If `docker` is available and docker-compose.yml exists: `docker compose up -d`.
#   2. Else if `pg_isready` already succeeds against DATABASE_URL: skip (already running).
#   3. Else on macOS with Homebrew: `brew services start postgresql@16`, then
#      create the `coldtake` role and `coldtake_dev` database if missing.
#   4. Else: print an error and exit non-zero.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SEED=false
SKIP_INSTALL=false

for arg in "$@"; do
  case "$arg" in
    --seed)
      SEED=true
      ;;
    --skip-install)
      SKIP_INSTALL=true
      ;;
    -h|--help)
      sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Run with -h for usage." >&2
      exit 1
      ;;
  esac
done

DB_HOST="localhost"
DB_PORT="5432"
DB_USER="coldtake"
DB_NAME="coldtake_dev"

echo "==> Checking Postgres..."

pg_ready() {
  pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1
}

if command -v docker >/dev/null 2>&1 && [ -f "$REPO_ROOT/docker-compose.yml" ]; then
  echo "==> Starting Postgres via docker compose..."
  docker compose up -d
  echo "==> Waiting for Postgres healthcheck..."
  for _ in $(seq 1 30); do
    if pg_ready; then
      break
    fi
    sleep 1
  done
  if ! pg_ready; then
    echo "ERROR: Postgres did not become ready via docker compose." >&2
    exit 1
  fi
elif pg_ready; then
  echo "==> Postgres is already running on $DB_HOST:$DB_PORT, skipping start."
elif [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
  echo "==> Starting Postgres via Homebrew (postgresql@16)..."
  brew services start postgresql@16 >/dev/null
  echo "==> Waiting for Postgres to accept connections..."
  for _ in $(seq 1 30); do
    if pg_ready; then
      break
    fi
    sleep 1
  done
  if ! pg_ready; then
    echo "ERROR: Postgres did not become ready after 'brew services start postgresql@16'." >&2
    exit 1
  fi

  echo "==> Ensuring '$DB_USER' role and '$DB_NAME' database exist..."
  ROLE_EXISTS="$(psql -h "$DB_HOST" -p "$DB_PORT" -d postgres -tAc \
    "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" 2>/dev/null || true)"
  if [ "$ROLE_EXISTS" != "1" ]; then
    echo "==> Creating role '$DB_USER'..."
    psql -h "$DB_HOST" -p "$DB_PORT" -d postgres -c \
      "CREATE ROLE $DB_USER LOGIN PASSWORD 'coldtake';"
  fi
  DB_EXISTS="$(psql -h "$DB_HOST" -p "$DB_PORT" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null || true)"
  if [ "$DB_EXISTS" != "1" ]; then
    echo "==> Creating database '$DB_NAME'..."
    psql -h "$DB_HOST" -p "$DB_PORT" -d postgres -c \
      "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  fi
else
  echo "ERROR: Postgres is not running and this script doesn't know how to start it here." >&2
  echo "        Start Postgres yourself (e.g. 'docker compose up -d' or 'brew services start postgresql@16')" >&2
  echo "        and re-run this script." >&2
  exit 1
fi

echo "==> Checking .env..."
if [ ! -f "$REPO_ROOT/.env" ]; then
  cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
  echo "==> Created .env from .env.example — its defaults already match the local Postgres set up above, no edits needed."
fi

# Nothing in this codebase loads .env automatically (no dotenv dependency) —
# db:migrate, db:seed, and the dev server (which reads process.env.DATABASE_URL
# directly when api/ handlers import src/lib/db/client) all expect it to
# already be in the environment. Export it here so every subsequent step sees it.
set -a
# shellcheck disable=SC1091
source "$REPO_ROOT/.env"
set +a

if [ "$SKIP_INSTALL" = false ]; then
  echo "==> Installing dependencies (pnpm install)..."
  pnpm install
else
  echo "==> Skipping pnpm install (--skip-install)."
fi

echo "==> Applying database migrations..."
pnpm db:migrate

if [ "$SEED" = true ]; then
  echo "==> Seeding database (--seed passed; this resets seed data)..."
  pnpm db:seed
fi

echo "==> Starting dev server (frontend + API on http://localhost:5173)..."
exec pnpm dev
