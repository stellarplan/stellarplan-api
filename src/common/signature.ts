import { createHash } from 'crypto';

/** SEP-53 domain-separation prefix that Freighter prepends before signing. */
const SEP53_PREFIX = 'Stellar Signed Message:\n';

/**
 * Verify an ed25519 signature produced by a Stellar wallet (e.g. Freighter's
 * `signMessage`) against the claimed public key.
 *
 * Freighter follows SEP-53: it signs `SHA256("Stellar Signed Message:\n" + msg)`
 * rather than the raw message bytes. We verify that scheme first, then fall back
 * to a raw-message verification so signatures from tools that sign the plain
 * bytes still work. Returns false on any error so callers can treat a malformed
 * or non-matching signature as an auth failure.
 */
export async function verifyStellarSignature(
  walletAddress: string,
  message: string,
  signatureBase64: string,
): Promise<boolean> {
  try {
    const { Keypair } = await import('@stellar/stellar-sdk');
    const kp = Keypair.fromPublicKey(walletAddress);
    const signature = Buffer.from(signatureBase64, 'base64');
    if (signature.length === 0) return false;

    // SEP-53: hash the prefixed message, then verify over the 32-byte digest.
    const sep53Payload = Buffer.concat([
      Buffer.from(SEP53_PREFIX, 'utf8'),
      Buffer.from(message, 'utf8'),
    ]);
    const sep53Hash = createHash('sha256').update(sep53Payload).digest();
    if (kp.verify(sep53Hash, signature)) return true;

    // Fallback: signature over the raw UTF-8 message bytes.
    return kp.verify(Buffer.from(message, 'utf8'), signature);
  } catch {
    return false;
  }
}
