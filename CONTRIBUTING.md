# Contributing to StellarPlan API

## Getting started

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run start:dev
```

## Workflow

1. Create a branch from `main` (`feat/...`, `fix/...`, `chore/...`).
2. Keep modules small — one responsibility per module (see `src/` structure).
3. Write a test if you change business logic (`src/**/*.spec.ts`).
4. Run `npm test` and `npm run build` before opening a PR.
5. Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.

## Coding standards

- TypeScript strict `.ts` only.
- ESLint + Prettier (`npm run lint`, `npx prettier --write .`).
- Validate every request body with a `class-validator` DTO.
- Never log secrets, tokens, or Stellar private keys.
- Business logic stays in services; controllers stay thin.

## Domain rules worth knowing

- Vault funds can only ever move **to the vault owner** — never to an arbitrary address.
- Auto-release is idempotent: running the cron twice must not double-release.
- The Backend `StellarService` must stay functional when `STELLAR_SECRET_KEY` is unset (off-chain demo mode).
