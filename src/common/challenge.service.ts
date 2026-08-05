import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

interface Entry {
  nonce: string;
  expiresAt: number;
}

/**
 * Process-local, short-lived challenge store for wallet-signature handshakes
 * (login and sensitive actions like breaking a vault). A challenge is issued
 * under a caller-defined key, then consumed exactly once. This avoids a DB
 * round-trip on every auth attempt; a single API instance owns each handshake.
 */
@Injectable()
export class ChallengeService {
  private readonly store = new Map<string, Entry>();
  private static readonly TTL_MS = 5 * 60 * 1000;

  issue(key: string): string {
    this.prune();
    const nonce = randomBytes(24).toString('hex');
    this.store.set(key, { nonce, expiresAt: Date.now() + ChallengeService.TTL_MS });
    return nonce;
  }

  /** Consume the challenge. Returns true only for a matching, unexpired nonce. */
  consume(key: string, nonce: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    this.store.delete(key); // one-shot regardless of outcome (prevents replay)
    if (entry.expiresAt < Date.now()) return false;
    return entry.nonce === nonce;
  }

  private prune() {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (v.expiresAt < now) this.store.delete(k);
    }
  }
}
