import { ChallengeService } from './challenge.service';

describe('ChallengeService', () => {
  let service: ChallengeService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new ChallengeService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('issues a different 48-character hex nonce each time', () => {
    const a = service.issue('login:A');
    const b = service.issue('login:A');
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(b).toMatch(/^[0-9a-f]{48}$/);
    expect(a).not.toEqual(b);
  });

  it('accepts the matching nonce exactly once', () => {
    const nonce = service.issue('login:A');
    expect(service.consume('login:A', nonce)).toBe(true);
    expect(service.consume('login:A', nonce)).toBe(false);
  });

  it('rejects an unknown key', () => {
    expect(service.consume('login:nobody', 'abc')).toBe(false);
  });

  it('burns the challenge after a wrong guess so it cannot be brute forced', () => {
    const nonce = service.issue('login:A');
    expect(service.consume('login:A', 'wrong')).toBe(false);
    expect(service.consume('login:A', nonce)).toBe(false);
  });

  it('keeps challenges for different keys independent', () => {
    const a = service.issue('login:A');
    const b = service.issue('login:B');
    expect(service.consume('login:B', a)).toBe(false);
    expect(service.consume('login:A', b)).toBe(false);
  });

  it('replaces an earlier challenge issued under the same key', () => {
    const first = service.issue('login:A');
    const second = service.issue('login:A');
    expect(service.consume('login:A', first)).toBe(false);
    // The failed attempt consumed the entry, so the newer nonce is gone too.
    expect(service.consume('login:A', second)).toBe(false);
  });

  it('accepts a nonce just inside the five minute window', () => {
    const nonce = service.issue('login:A');
    jest.advanceTimersByTime(5 * 60 * 1000 - 1);
    expect(service.consume('login:A', nonce)).toBe(true);
  });

  it('rejects a nonce after the five minute window', () => {
    const nonce = service.issue('login:A');
    jest.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(service.consume('login:A', nonce)).toBe(false);
  });

  it('prunes expired entries when a new challenge is issued', () => {
    service.issue('login:old');
    jest.advanceTimersByTime(6 * 60 * 1000);
    service.issue('login:new');
    const store = (service as any).store as Map<string, unknown>;
    expect(store.has('login:old')).toBe(false);
    expect(store.has('login:new')).toBe(true);
  });
});
