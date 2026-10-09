import { ConfigService } from '@nestjs/config';

function config(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const STRONG_SECRET = 'a'.repeat(32);

describe('assertRequiredEnv', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { assertRequiredEnv } = require('./env');

  it('requires DATABASE_URL in every environment', () => {
    expect(() => assertRequiredEnv(config({}))).toThrow(/DATABASE_URL/);
  });

  it('accepts a development setup with only a database', () => {
    expect(() => assertRequiredEnv(config({ DATABASE_URL: 'postgres://x' }))).not.toThrow();
  });

  it('requires a 32+ character JWT secret and CORS origin in production', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x' };
    expect(() => assertRequiredEnv(config(base))).toThrow(/JWT_SECRET/);
    expect(() => assertRequiredEnv(config({ ...base, JWT_SECRET: 'short', CORS_ORIGIN: 'https://a' }))).toThrow(
      /JWT_SECRET/,
    );
    expect(() => assertRequiredEnv(config({ ...base, JWT_SECRET: STRONG_SECRET }))).toThrow(/CORS_ORIGIN/);
  });

  it('accepts a complete production setup', () => {
    expect(() =>
      assertRequiredEnv(
        config({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://x',
          JWT_SECRET: STRONG_SECRET,
          CORS_ORIGIN: 'https://app.example',
        }),
      ),
    ).not.toThrow();
  });

  it('lists every missing variable in one error', () => {
    expect(() => assertRequiredEnv(config({ NODE_ENV: 'production' }))).toThrow(
      /DATABASE_URL.*JWT_SECRET.*CORS_ORIGIN/,
    );
  });
});

describe('requireJwtSecret', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns a configured secret of 32+ characters', () => {
    const { requireJwtSecret } = require('./env');
    expect(requireJwtSecret(config({ JWT_SECRET: STRONG_SECRET }))).toBe(STRONG_SECRET);
  });

  it('refuses a weak or missing secret in production', () => {
    const { requireJwtSecret } = require('./env');
    expect(() => requireJwtSecret(config({ NODE_ENV: 'production', JWT_SECRET: 'weak' }))).toThrow(
      /Refusing to start in production/,
    );
  });

  it('falls back to an ephemeral secret outside production and warns loudly', () => {
    const { requireJwtSecret } = require('./env');
    const secret = requireJwtSecret(config({}));
    expect(secret).toMatch(/^[0-9a-f]{96}$/);
    expect(console.warn).toHaveBeenCalled();
  });

  it('caches the secret so it stays stable for the process lifetime', () => {
    const { requireJwtSecret } = require('./env');
    const first = requireJwtSecret(config({}));
    expect(requireJwtSecret(config({}))).toBe(first);
  });
});
