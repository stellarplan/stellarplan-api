# Changelog

## 1.1.0 — 2026-10-09

### Security
- **Fixed: early withdrawals accepted any signature.** `VaultsService.breakVault`
  treated the object returned by `verifyStellarSignature` as a boolean, so the
  wallet-signature check never rejected anything. It now reads `.valid`. A
  caller still needed a valid access token and an unexpired challenge nonce,
  but the signature that is meant to prove the wallet owner agreed to break the
  plan was not being enforced. Regression tests cover garbage, wrong-length,
  wrong-wallet, and wrong-message signatures, and replayed or cross-vault nonces.

### Added
- 50 new tests (17 to 67; 3 to 8 suites): vault break flow, wallet login and
  token rotation, the challenge store (single use and expiry), environment
  validation, and the health endpoint.
- README endpoint table now lists auth requirements, rate limits, the health and
  budgets routes, and which calls read or write the Stellar network.

## 1.0.0
- Initial NestJS API: wallet-signature login, plans, vaults, allocation, notifications.
