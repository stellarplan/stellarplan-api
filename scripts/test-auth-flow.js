/**
 * End-to-end authentication flow test.
 *
 * Simulates the full Freighter login:
 *   1. POST /auth/challenge   → get message + nonce
 *   2. Sign the message exactly as Freighter does (SEP-53)
 *   3. POST /auth/wallet      → exchange signature for JWT tokens
 *
 * Usage:  node scripts/test-auth-flow.js
 * Prereq: The API must be running on localhost:4000.
 */

const http = require('http');
const crypto = require('crypto');

const API = 'http://localhost:4000/api/v1';
const SEP53_PREFIX = 'Stellar Signed Message:\n';

async function post(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API);
    const data = JSON.stringify(body);
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  // Use Stellar SDK to create a test keypair
  const { Keypair } = require('@stellar/stellar-sdk');
  const kp = Keypair.random();
  const walletAddress = kp.publicKey();

  console.log('=== StellarPlan Auth Flow Test ===');
  console.log('Test wallet:', walletAddress);
  console.log();

  // Step 1: Request challenge
  console.log('--- Step 1: POST /auth/challenge ---');
  const challengeRes = await post(`${API}/auth/challenge`, { walletAddress });
  console.log('Status:', challengeRes.status);
  console.log('Response:', JSON.stringify(challengeRes.body, null, 2));

  if (challengeRes.status !== 201 && challengeRes.status !== 200) {
    console.error('FAIL: Challenge request failed');
    process.exit(1);
  }

  const { message, nonce } = challengeRes.body;
  console.log();
  console.log('Message length:', message.length);
  console.log('Message bytes (hex):', Buffer.from(message, 'utf8').toString('hex'));
  console.log('Nonce:', nonce);
  console.log();

  // Step 2: Sign the message exactly as Freighter does (SEP-53)
  console.log('--- Step 2: SEP-53 Signing ---');
  const messageBytes = Buffer.from(message, 'utf8');
  const prefixBytes = Buffer.from(SEP53_PREFIX, 'utf8');
  const payload = Buffer.concat([prefixBytes, messageBytes]);
  const hash = crypto.createHash('sha256').update(payload).digest();

  console.log('SEP-53 prefix bytes:', prefixBytes.toString('hex'));
  console.log('Payload length:', payload.length);
  console.log('SHA-256 hash:', hash.toString('hex'));

  const signature = kp.sign(hash);
  const signatureBase64 = Buffer.from(signature).toString('base64');

  console.log('Signature length:', signature.length);
  console.log('Signature (base64):', signatureBase64);

  // Verify locally before sending
  const localVerify = kp.verify(hash, signature);
  console.log('Local self-verify:', localVerify);
  console.log();

  // Step 3: Submit to /auth/wallet
  console.log('--- Step 3: POST /auth/wallet ---');
  const verifyRes = await post(`${API}/auth/wallet`, {
    walletAddress,
    nonce,
    signature: signatureBase64,
  });
  console.log('Status:', verifyRes.status);
  console.log('Response:', JSON.stringify(verifyRes.body, null, 2));

  if (verifyRes.status === 200 || verifyRes.status === 201) {
    console.log();
    console.log('=== SUCCESS: Full auth flow completed ===');
    console.log('Access token received:', !!verifyRes.body.accessToken);
    console.log('Refresh token received:', !!verifyRes.body.refreshToken);
  } else {
    console.log();
    console.log('=== FAIL: Auth verification failed ===');
    console.log('Error:', verifyRes.body.message || verifyRes.body);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
