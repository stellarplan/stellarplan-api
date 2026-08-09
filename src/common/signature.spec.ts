import { createHash } from 'crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { verifyStellarSignature } from './signature';

const SEP53_PREFIX = 'Stellar Signed Message:\n';

function signSep53(keypair: ReturnType<typeof Keypair.random>, message: string): string {
  const payload = Buffer.concat([
    Buffer.from(SEP53_PREFIX, 'utf8'),
    Buffer.from(message, 'utf8'),
  ]);
  const hash = createHash('sha256').update(payload).digest();
  const sig = keypair.sign(hash);
  return Buffer.from(sig).toString('base64');
}

function signRawSha256(keypair: ReturnType<typeof Keypair.random>, message: string): string {
  const hash = createHash('sha256').update(Buffer.from(message, 'utf8')).digest();
  const sig = keypair.sign(hash);
  return Buffer.from(sig).toString('base64');
}

function signRawBytes(keypair: ReturnType<typeof Keypair.random>, message: string): string {
  const sig = keypair.sign(Buffer.from(message, 'utf8'));
  return Buffer.from(sig).toString('base64');
}

describe('verifyStellarSignature', () => {
  const kp = Keypair.random();
  const wallet = kp.publicKey();
  const message = [
    'StellarPlan authentication request.',
    '',
    'Action: Sign in',
    `Wallet: ${wallet}`,
    'Nonce: abc123def456',
    '',
    'Signing proves you control this wallet. It authorizes no transfer by itself.',
  ].join('\n');

  it('verifies a SEP-53 signature (Freighter standard)', () => {
    const sig = signSep53(kp, message);
    const result = verifyStellarSignature(wallet, message, sig);
    expect(result.valid).toBe(true);
    expect(result.strategy).toBe('sep53');
    expect(result.diagnostics.signatureLength).toBe(64);
  });

  it('falls back to SHA-256-raw when prefix is missing', () => {
    const sig = signRawSha256(kp, message);
    const result = verifyStellarSignature(wallet, message, sig);
    expect(result.valid).toBe(true);
    expect(result.strategy).toBe('sha256-raw');
  });

  it('falls back to raw-bytes when no hashing is used', () => {
    const sig = signRawBytes(kp, message);
    const result = verifyStellarSignature(wallet, message, sig);
    expect(result.valid).toBe(true);
    expect(result.strategy).toBe('raw-bytes');
  });

  it('rejects a signature from a different keypair', () => {
    const other = Keypair.random();
    const sig = signSep53(other, message);
    const result = verifyStellarSignature(wallet, message, sig);
    expect(result.valid).toBe(false);
    expect(result.strategy).toBe('none');
  });

  it('rejects a signature over a different message', () => {
    const sig = signSep53(kp, 'wrong message');
    const result = verifyStellarSignature(wallet, message, sig);
    expect(result.valid).toBe(false);
  });

  it('rejects an empty signature', () => {
    const result = verifyStellarSignature(wallet, message, '');
    expect(result.valid).toBe(false);
    expect(result.diagnostics.signatureLength).toBe(0);
  });

  it('rejects a truncated signature', () => {
    const sig = signSep53(kp, message);
    const truncated = Buffer.from(sig, 'base64').subarray(0, 32).toString('base64');
    const result = verifyStellarSignature(wallet, message, truncated);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.signatureLength).toBe(32);
  });

  it('rejects an invalid wallet address', () => {
    const result = verifyStellarSignature('INVALIDADDRESS', message, signSep53(kp, message));
    expect(result.valid).toBe(false);
  });

  it('returns consistent diagnostic hashes', () => {
    const sig = signSep53(kp, message);
    const r1 = verifyStellarSignature(wallet, message, sig);
    const r2 = verifyStellarSignature(wallet, message, sig);
    expect(r1.diagnostics.sep53PayloadHash).toBe(r2.diagnostics.sep53PayloadHash);
    expect(r1.diagnostics.rawMessageHash).toBe(r2.diagnostics.rawMessageHash);
  });
});

describe('challengeMessage byte identity', () => {
  // Import the challengeMessage function
  const { challengeMessage } = require('../auth/auth.service');

  it('reconstructs byte-for-byte identical messages for the same inputs', () => {
    const wallet = 'GDNIL2NFHIRAENZI6F2KRCMUA4SMOHTV6P6TXWNV5GOV5S7BRN44ZLQR';
    const nonce = 'abc123def456';
    const msg1 = challengeMessage(wallet, nonce);
    const msg2 = challengeMessage(wallet, nonce);
    expect(Buffer.from(msg1, 'utf8').equals(Buffer.from(msg2, 'utf8'))).toBe(true);
  });

  it('uses LF newlines (0x0A), not CRLF', () => {
    const wallet = 'GDNIL2NFHIRAENZI6F2KRCMUA4SMOHTV6P6TXWNV5GOV5S7BRN44ZLQR';
    const nonce = 'abc123';
    const msg = challengeMessage(wallet, nonce);
    expect(msg).not.toContain('\r');
    expect(msg).toContain('\n');
  });
});
