# StellarPlan API

Backend for the StellarPlan automatic financial planning platform.

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

## Quick Start

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

The API is then reachable at `http://localhost:4000/api/v1`.

> **On-chain is required for writes.** Salary allocation, release, and early
> withdrawal call the PlanVault contract. If `STELLAR_SECRET_KEY` /
> `VAULT_CONTRACT_ID` are unset, those endpoints return `503 Service Unavailable`
> rather than silently faking state. Read-only Horizon queries degrade to empty.

## Endpoints

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/v1/auth/challenge` | Request a sign-in challenge for a wallet |
| `POST` | `/api/v1/auth/wallet` | Verify a signed challenge, issue tokens |
| `POST` | `/api/v1/auth/refresh` | Rotate tokens |
| `POST` | `/api/v1/auth/logout` | Revoke refresh token |
| `GET`  | `/api/v1/auth/me` | Current user profile |
| `GET`  | `/api/v1/users/me` | Current user profile |
| `GET`  | `/api/v1/users/dashboard` | Full dashboard payload |
| `GET`  | `/api/v1/users/balance` | Balance summary |
| `GET`  | `/api/v1/wallet` | Connected wallet status (read-only) |
| `GET`  | `/api/v1/plans` | List plans |
| `POST` | `/api/v1/plans` | Create plan |
| `PUT`  | `/api/v1/plans/:id` | Update plan |
| `DELETE`| `/api/v1/plans/:id` | Delete plan |
| `GET`  | `/api/v1/vaults` | List locked vaults |
| `GET`  | `/api/v1/vaults/:id` | Vault details |
| `POST` | `/api/v1/vaults/break/challenge` | Request an early-withdrawal challenge |
| `POST` | `/api/v1/vaults/break` | Early withdrawal (requires signature) |
| `POST` | `/api/v1/allocations/detect` | Scan wallet & allocate salary on-chain |
| `GET`  | `/api/v1/allocations/history` | Allocation history |
| `GET`  | `/api/v1/transactions` | Activity feed |
| `GET`  | `/api/v1/notifications` | Notifications |
| `PATCH`| `/api/v1/notifications/:id/read` | Mark single notification read |
| `PATCH`| `/api/v1/notifications/read-all` | Mark all read |

## Environment variables

See [`.env.example`](./.env.example).

## Scripts

| Command | Purpose |
|---|---|
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
