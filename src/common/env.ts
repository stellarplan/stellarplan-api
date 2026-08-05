import { ConfigService } from '@nestjs/config';

/**
 * Fail-fast accessors for security-critical configuration. The app must never
 * boot with a default/guessable JWT secret in production, so we throw rather
 * than silently fall back. In non-production a generated dev secret is allowed
 * but logged loudly.
 */
let cachedJwtSecret: string | undefined;

export function requireJwtSecret(config: ConfigService): string {
  if (cachedJwtSecret) return cachedJwtSecret;

  const secret = config.get<string>('JWT_SECRET');
  const isProd = (config.get<string>('NODE_ENV') ?? 'development') === 'production';

  if (secret && secret.length >= 32) {
    cachedJwtSecret = secret;
    return secret;
  }

  if (isProd) {
    throw new Error(
      'JWT_SECRET is missing or too short (need >= 32 chars). Refusing to start in production.',
    );
  }

  // Development only: derive an ephemeral secret so local runs work, but make it
  // obvious that tokens will not survive a restart and must not be used in prod.
  // eslint-disable-next-line no-console
  console.warn(
    '[StellarPlan] WARNING: JWT_SECRET unset/weak — using an ephemeral dev secret. Set a 32+ char JWT_SECRET before deploying.',
  );
  cachedJwtSecret = require('crypto').randomBytes(48).toString('hex');
  return cachedJwtSecret;
}

/** Validate presence of required env vars at boot; throws with a clear list. */
export function assertRequiredEnv(config: ConfigService): void {
  const isProd = (config.get<string>('NODE_ENV') ?? 'development') === 'production';
  const missing: string[] = [];

  if (!config.get<string>('DATABASE_URL')) missing.push('DATABASE_URL');
  if (isProd) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32) missing.push('JWT_SECRET (>= 32 chars)');
    if (!config.get<string>('CORS_ORIGIN')) missing.push('CORS_ORIGIN');
  }

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
