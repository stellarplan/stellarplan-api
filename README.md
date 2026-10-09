# StellarPlan API

> Backend for StellarPlan — when your salary lands, it automatically moves rent, bills, and savings into time-locked on-chain plans, leaving only what you can safely spend.

[📚 Documentation](https://stellarplan.gitbook.io/stellarplan-docs/)

<p align="center"><em>Freighter-only auth · Stellar + Soroban · built for the Drips Stellar Wave program (testnet)</em></p>

[![CI](https://github.com/stellarplan/stellarplan-api/actions/workflows/ci.yml/badge.svg)](https://github.com/stellarplan/stellarplan-api/actions/workflows/ci.yml)
![License](https://img.shields.io/badge/license-MIT-blue)
![NestJS](https://img.shields.io/badge/NestJS-Node.js%20%2B%20TypeScript-E0234E)
![Stellar](https://img.shields.io/badge/Stellar-testnet-black)
![Soroban](https://img.shields.io/badge/Soroban-PlanVault-blueviolet)

---

## What it is

- **Framework**: NestJS (Node.js + TypeScript)
- **Database**: PostgreSQL via Prisma ORM
- **Blockchain**: Stellar + Soroban (PlanVault contract, USDC on testnet)
- **Auth**: Freighter wallet only — challenge/nonce → SEP-53 signature → JWT access + refresh tokens. **No email/password.**

## How authentication works

There are no passwords. A user proves ownership of their Stellar account by
signing a one-time challenge with Freighter:

1. `POST /auth/challenge` with the wallet address → the server returns a
   human-readable `message` and a single-use `nonce` (kept in-memory, short TTL).
2. The client signs `message` with Freighter (`signMessage`, which produces a
   **SEP-53** signature: `ed25519` over `SHA256("Stellar Signed Message:\n" + message)`).
3. `POST /auth/wallet` with `{ walletAddress, nonce, signature }`. The server
   verifies the signature against the wallet's public key (see
   [`src/common/signature.ts`](./src/common/signature.ts)), upserts the user and
   their `WalletConnection`, and returns JWT tokens.

The same challenge/verify pattern gates the sensitive **break-vault** flow
(`POST /vaults/break/challenge` → `POST /vaults/break`), so early withdrawals
also require a fresh signature.

## Features

- Freighter wallet authentication with refresh-token rotation (no passwords)
- SEP-53 signature verification for login and early withdrawal
- Manage monthly plans (Bills, Emergency, Savings)
- Salary detection from Horizon → automatic on-chain allocation into PlanVault
- Time-locked vaults with auto-release via cron
- Early withdrawal gated by a signed challenge
- Notifications & activity timeline

## Quick start

One command creates `.env`, installs dependencies, generates the Prisma client,
runs the initial migration, seeds demo data, then builds and tests:

```bash
./scripts/setup.sh
```

The only value you must edit by hand is `DATABASE_URL` in `.env` (plus
`STELLAR_SECRET_KEY` / `VAULT_CONTRACT_ID` / `USDC_TOKEN_CONTRACT` for on-chain
features at runtime). The script is idempotent — safe to re-run.

Then start the dev server:

```bash
npm run start:dev
```

The API is reachable at `http://localhost:4000/api/v1`.

<details>
<summary>Manual steps (what the script automates)</summary>

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# fill in DATABASE_URL, JWT_SECRET, STELLAR_SECRET_KEY, VAULT_CONTRACT_ID, etc.

# 3. Database
npm run prisma:generate
npm run prisma:migrate:dev   # first run: --name init

# 4. Run
npm run start:dev
```

</details>

> **On-chain is required for writes.** Salary allocation, release, and early
> withdrawal call the PlanVault contract. If `STELLAR_SECRET_KEY` /
> `VAULT_CONTRACT_ID` are unset, those endpoints return `503 Service Unavailable`
> rather than silently faking state. Read-only Horizon queries degrade to empty.

## Architecture

```
        ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
 user ─▶│  web         │─────▶│  api         │─────▶│ PostgreSQL   │
        │  (Next.js)   │      │  (NestJS)    │      │ (Prisma)     │
        └──────────────┘      └──────┬───────┘      └──────────────┘
                                     │
                                     ▼
                          ┌────────────────────────┐
                          │ Stellar                │
                          │ Horizon / Soroban RPC  │──▶ PlanVault contract
                          └────────────────────────┘
```

The API owns all business logic: it reads salary activity from Horizon, decides
allocations, and calls the PlanVault Soroban contract for locks, releases, and
early withdrawals.

## Endpoints

All routes are under `/api/v1`. **Auth** says what a request needs: `none`, or a
`Bearer` access token from the wallet login. **Chain** says whether the call
reads or writes the Stellar network:

- **off-chain** — touches only the API's own database.
- **reads Horizon** — reads public ledger data; degrades to empty if Horizon is unreachable.
- **writes on-chain** — submits a Soroban transaction signed by the service key. Returns `503` if `STELLAR_SECRET_KEY` / `VAULT_CONTRACT_ID` are unset.

| Method | Route | Auth | Chain | Description |
|---|---|---|---|---|
| `GET`  | `/health` | none | off-chain | Liveness plus database check; `503` if the database is down |
| `POST` | `/auth/challenge` | none (10/min) | off-chain | Request a sign-in challenge for a wallet |
| `POST` | `/auth/wallet` | none (10/min) | off-chain | Verify a signed challenge, issue tokens |
| `POST` | `/auth/refresh` | none (20/min) | off-chain | Rotate the refresh token and issue a new pair |
| `POST` | `/auth/logout` | Bearer | off-chain | Revoke all refresh tokens for the user |
| `GET`  | `/auth/me` | Bearer | off-chain | Current user profile |
| `GET`  | `/users/me` | Bearer | off-chain | Current user profile |
| `GET`  | `/users/dashboard` | Bearer | reads Horizon | Full dashboard payload |
| `GET`  | `/users/balance` | Bearer | reads Horizon | Balance summary |
| `GET`  | `/wallet` | Bearer | off-chain | Connected wallet status |
| `GET`  | `/plans` | Bearer | off-chain | List plans |
| `GET`  | `/plans/:id` | Bearer | off-chain | One plan (own plans only) |
| `POST` | `/plans` | Bearer | off-chain | Create plan |
| `PUT`  | `/plans/:id` | Bearer | off-chain | Update plan |
| `DELETE`| `/plans/:id` | Bearer | off-chain | Delete plan |
| `GET/POST/PUT/DELETE` | `/budgets`, `/budgets/:id` | Bearer | off-chain | Budget plans (same shape as plans) |
| `GET`  | `/vaults` | Bearer | off-chain | List locked vaults |
| `GET`  | `/vaults/:id` | Bearer | off-chain | Vault details (own vaults only) |
| `POST` | `/vaults/break/challenge` | Bearer (15/min) | off-chain | Request an early-withdrawal challenge |
| `POST` | `/vaults/break` | Bearer (15/min) | writes on-chain | Early withdrawal; needs the wallet's signature over the challenge |
| `POST` | `/allocations/detect` | Bearer | reads Horizon, writes on-chain | Scan the wallet and allocate salary into vaults |
| `GET`  | `/allocations/history` | Bearer | off-chain | Allocation history |
| `GET`  | `/transactions` | Bearer | off-chain | Activity feed |
| `GET`  | `/notifications` | Bearer | off-chain | Notifications |
| `PATCH`| `/notifications/:id/read` | Bearer | off-chain | Mark one notification read |
| `PATCH`| `/notifications/read-all` | Bearer | off-chain | Mark all read |

A daily job at 06:00 server time releases vaults whose unlock date has arrived
(**writes on-chain**) and sends "unlocks tomorrow" notifications.

## Environment variables

See [`.env.example`](./.env.example).

## Scripts

| Command | Purpose |
|---|---|
| `./scripts/setup.sh` | One-command setup: env, install, Prisma, migrate, seed, build, test |
| `npm run start:dev` | Dev server with watch |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Production mode |
| `npm test` | Unit tests |
| `npm run prisma:generate` | Regenerate Prisma Client |
| `npm run prisma:migrate:dev` | Create & apply migration |
| `npm run prisma:migrate` | Apply migrations (production) |
| `npm run db:seed` | Seed demo data |

## Folder structure

```
src/
├── auth/           # Challenge/verify wallet auth, JWT, refresh rotation
├── users/          # Profile, dashboard aggregation
├── wallets/        # Read-only wallet connection status
├── plans/          # Budget plan CRUD
├── vaults/         # Vault queries, signed break-vault flow, auto-release cron
├── allocations/    # Salary detection & on-chain allocation engine
├── transactions/   # Activity feed
├── notifications/  # In-app notifications
├── stellar/        # Horizon + Soroban integration
└── common/         # Prisma client, signature verification, decorators, guards
```

## CI

Every push and pull request to `main` runs the [CI workflow](./.github/workflows/ci.yml):
a `build` job (install → generate Prisma client → `npm run build`) and a `test`
job (`npm test`). Use `build` and `test` as required status checks for branch
protection on `main`.

## Related repositories

- [stellarplan-web](https://github.com/stellarplan/stellarplan-web) — Next.js frontend that talks to this API.
- [stellarplan-contracts](https://github.com/stellarplan/stellarplan-contracts) — the PlanVault Soroban contract this API calls.

## Maintainers

| Name | Contact |
|---|---|
| StellarPlan Team | helloworld1-star — Telegram: @cjstixx12 — Email: devt14985@gmail.com |

<!-- Maintainer: replace the placeholder above with a real name and a Telegram handle or email. -->

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). `main` is
protected, so all changes land via pull request with CI green.

**Security:** please report vulnerabilities privately per [SECURITY.md](./SECURITY.md).

**License:** [MIT](./LICENSE).

## Contributors

[![Contributors](https://contrib.rocks/image?repo=stellarplan/stellarplan-api)](https://github.com/stellarplan/stellarplan-api/graphs/contributors)
