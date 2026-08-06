#!/usr/bin/env bash
# StellarPlan API — one-command local setup.
#
#   ./scripts/setup.sh
#
# Idempotent: safe to re-run. It will
#   1. create .env from .env.example if missing, and auto-generate JWT_SECRET
#   2. install dependencies
#   3. generate the Prisma client
#   4. run the initial database migration (needs a reachable DATABASE_URL)
#   5. seed demo data (optional, best-effort)
#   6. build + run the test suite
#
# The ONLY thing you must edit by hand is DATABASE_URL (and, for on-chain
# features at runtime, STELLAR_SECRET_KEY / VAULT_CONTRACT_ID / USDC_TOKEN_CONTRACT).
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$1"; }

# 1. .env ---------------------------------------------------------------------
if [ ! -f .env ]; then
  say "Creating .env from .env.example"
  cp .env.example .env
fi
# Auto-fill JWT_SECRET if it's still the placeholder or empty.
if grep -qE '^JWT_SECRET="?(change-me|)"?$' .env; then
  SECRET="$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | xxd -p -c32)"
  # portable in-place edit
  tmp="$(mktemp)"; sed "s|^JWT_SECRET=.*|JWT_SECRET=\"$SECRET\"|" .env > "$tmp" && mv "$tmp" .env
  say "Generated a random JWT_SECRET"
fi

# Warn about DATABASE_URL so migrate doesn't fail cryptically.
if grep -qE '^DATABASE_URL="postgresql://postgres:postgres@localhost' .env; then
  warn "DATABASE_URL is still the default. Edit .env to point at your Postgres,"
  warn "or start a local one, before this script reaches the migration step."
fi

# 2. install ------------------------------------------------------------------
say "Installing dependencies (npm install)"
npm install

# 3. prisma client ------------------------------------------------------------
say "Generating Prisma client"
npm run prisma:generate

# 4. migration ----------------------------------------------------------------
say "Applying database migration (prisma migrate dev --name init)"
if npx prisma migrate dev --name init; then
  # 5. seed (best-effort) -----------------------------------------------------
  say "Seeding demo data (optional)"
  npm run db:seed || warn "Seed skipped/failed — not fatal."
else
  warn "Migration failed — check DATABASE_URL in .env, then re-run this script."
  warn "Everything else below is skipped until the DB is reachable."
  exit 1
fi

# 6. build + test -------------------------------------------------------------
say "Building"
npm run build
say "Running tests"
npm test

say "API is ready. Start it with:  npm run start:dev"
echo "   Reachable at http://localhost:4000/api/v1"
