# Security Policy

## Reporting a vulnerability

Email: security@stellarplan.app (or open a private GitHub security advisory).

Do **not** open public issues for security problems.

## Scope

This service handles custodial-ish workflows (it signs Soroban transactions with a backend service keypair). The highest-impact bug classes are:

- Authenticating as a wallet **without a valid signature**, or accepting a replayed
  challenge nonce (nonces are single-use — keep them that way).
- Setting or overwriting a user's `walletAddress` without a verified signature.
- Bypass of JWT auth guards on any controller (`src/**/*.controller.ts`).
- Ability to release or break **another user's** vault.
- SQL/ODM injection via DTO fields (all inputs flow through class-validator — keep it that way).
- Leakage of `STELLAR_SECRET_KEY` through logs or API responses.

## Signature verification

Login and early withdrawal both rely on `verifyStellarSignature`
(`src/common/signature.ts`). It verifies a **SEP-53** signature
(`ed25519` over `SHA256("Stellar Signed Message:\n" + message)`), which is what
Freighter's `signMessage` produces. Do not relax this to accept unsigned
requests or raw-message signatures without review.

## Hardening checklist before mainnet

- [ ] Rotate `JWT_SECRET` (≥ 32 random bytes).
- [ ] Confirm rate limiting (`@nestjs/throttler`) is active on `/auth/*` and `/vaults/break*`.
- [ ] Restrict `CORS_ORIGIN` to production origins only.
- [ ] Move `STELLAR_SECRET_KEY` to the platform's secret store (Render env / KMS).
- [ ] Set a non-zero early-withdraw delay on the vault contract.
