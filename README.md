# StellarPlan API

Backend for the StellarPlan automatic financial planning platform.

- **Framework**: NestJS (Node.js + TypeScript)
- **Database**: PostgreSQL via Prisma ORM
- **Blockchain**: Stellar + Soroban (optional — demo can run fully off-chain)
- **Auth**: JWT access + refresh tokens (bcrypt password hashing)

## Features

- Email/password authentication with refresh-token rotation
- Connect a Stellar wallet (Freighter, Albedo, etc.)
- Manage monthly plans (Bills, Emergency, Savings)
- Salary detection from Horizon → automatic allocation
- Time-locked vaults with auto-release via cron
- Early withdrawal with friction countdown
- Notifications & activity timeline

## Quick Start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# fill in DATABASE_URL, JWT_SECRET, etc.

# 3. Database
npx prisma generate
npx prisma migrate dev --name init

# 4. Run
npm run start:dev
```

The API is then reachable at `http://localhost:4000/api/v1`.

## Endpoints

| Prefix | Route | Description |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Create account |
| `POST` | `/api/v1/auth/login` | Login |
| `POST` | `/api/v1/auth/refresh` | Rotate tokens |
| `POST` | `/api/v1/auth/logout` | Logout |
| `GET`  | `/api/v1/auth/me` | Current user profile |
| `GET`  | `/api/v1/users/dashboard` | Full dashboard payload |
| `POST` | `/api/v1/wallet/connect` | Connect a Stellar wallet |
| `GET`  | `/api/v1/plans` | List plans |
| `POST` | `/api/v1/plans` | Create plan |
| `PUT`  | `/api/v1/plans/:id` | Update plan |
| `DELETE`| `/api/v1/plans/:id` | Delete plan |
| `GET`  | `/api/v1/vaults` | List locked vaults |
| `GET`  | `/api/v1/vaults/:id` | Vault details |
| `POST` | `/api/v1/vaults/break` | Early withdrawal |
| `POST` | `/api/v1/allocations/detect` | Scan wallet & allocate salary |
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
| `npm run prisma:generate` | Regenerate Prisma Client |
| `npm run prisma:migrate:dev` | Create & apply migration |
| `npm run db:seed` | Seed demo data |

## Folder structure

```
src/
├── auth/           # JWT auth, registration, login, refresh
├── users/          # Profile, dashboard aggregation
├── wallets/        # Stellar wallet linking
├── plans/          # Budget plan CRUD
├── vaults/         # Vault queries + auto-release cron
├── allocations/    # Salary detection & allocation engine
├── transactions/   # Activity feed
├── notifications/  # In-app notifications
├── stellar/        # Horizon + Soroban integration
└── common/         # Prisma client, decorators, guards
```
