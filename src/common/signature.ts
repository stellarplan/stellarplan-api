import { createHash } from 'crypto';
import { Keypair } from '@stellar/stellar-sdk';

const SEP53_PREFIX = 'Stellar Signed Message:\n';

/**
 * Verify a Stellar wallet signature over a challenge message.
 *
 * Freighter (and all SEP-53 compliant wallets) sign:
 *   SHA256("Stellar Signed Message:\n" + messageBytes)
 *
 * We attempt SEP-53 verification first, then fall back to verifying the raw
 * SHA-256 of the message (some wallets hash but omit the prefix) and finally
 * the raw UTF-8 bytes (in case a wallet signs the message directly).
 *
 * Returns an object with the result and which strategy matched, so the caller
 * can log diagnostics without exposing secrets.
 */
export interface VerifyResult {
  valid: boolean;
  strategy: 'sep53' | 'sha256-raw' | 'raw-bytes' | 'none';
  diagnostics: {
    signatureLength: number;
    messageLength: number;
    sep53PayloadHash: string;
    rawMessageHash: string;
  };
}

export function verifyStellarSignature(
  walletAddress: string,
  message: string,
  signatureBase64: string,
): VerifyResult {
  const messageBytes = Buffer.from(message, 'utf8');
  const signatureBytes = Buffer.from(signatureBase64, 'base64');

  // Pre-compute hashes for diagnostics
  const sep53Payload = Buffer.concat([
    Buffer.from(SEP53_PREFIX, 'utf8'),
    messageBytes,
  ]);
  const sep53Hash = createHash('sha256').update(sep53Payload).digest();
  const rawMessageHash = createHash('sha256').update(messageBytes).digest();

  const diagnostics = {
    signatureLength: signatureBytes.length,
    messageLength: messageBytes.length,
    sep53PayloadHash: sep53Hash.toString('hex'),
    rawMessageHash: rawMessageHash.toString('hex'),
  };

  // Signature must be exactly 64 bytes (Ed25519)
  if (signatureBytes.length !== 64) {
    return { valid: false, strategy: 'none', diagnostics };
  }

  try {
    const keypair = Keypair.fromPublicKey(walletAddress);

    // Strategy 1: SEP-53 — SHA256("Stellar Signed Message:\n" + message)
    // This is what Freighter and all SEP-53 compliant wallets produce.
    if (keypair.verify(sep53Hash, signatureBytes)) {
      return { valid: true, strategy: 'sep53', diagnostics };
    }

    // Strategy 2: SHA-256 of raw message (no prefix)
    // Some wallet implementations may hash the message but skip the prefix.
    if (keypair.verify(rawMessageHash, signatureBytes)) {
      return { valid: true, strategy: 'sha256-raw', diagnostics };
    }

    // Strategy 3: Raw UTF-8 bytes (no hash at all)
    // Some simple signing implementations sign the message bytes directly.
    if (keypair.verify(messageBytes, signatureBytes)) {
      return { valid: true, strategy: 'raw-bytes', diagnostics };
    }

    return { valid: false, strategy: 'none', diagnostics };
  } catch {
    return { valid: false, strategy: 'none', diagnostics };
  }
}