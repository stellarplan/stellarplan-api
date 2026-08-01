# Security Policy

## Reporting a vulnerability

Email: security@stellarplan.app (or open a private GitHub security advisory).

Do **not** open public issues for security problems.

## Scope

This service handles custodial-ish workflows (it signs Soroban transactions with a backend service keypair). The highest-impact bug classes are:

- Bypass of JWT auth guards on any controller (`src/**/*.controller.ts`).
- Ability to release or break **another user's** vault.
- SQL/ODM injection via DTO fields (all inputs flow through class-validator — keep it that way).
- Leakage of `STELLAR_SECRET_KEY` through logs or API responses.

## Hardening checklist before mainnet

- [ ] Rotate `JWT_SECRET` (≥ 32 random bytes).
- [ ] Enable rate limiting (`@nestjs/throttler`) on `/auth/*` and `/wallet/*`.
- [ ] Restrict `CORS_ORIGIN` to production origins only.
- [ ] Move `STELLAR_SECRET_KEY` to the platform's secret store (Render env / KMS).
- [ ] Set a non-zero early-withdraw delay on the vault contract.
