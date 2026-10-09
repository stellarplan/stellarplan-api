import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports ok when the database answers', async () => {
    const prisma: any = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const result = await new HealthController(prisma).check();

    expect(result).toMatchObject({ status: 'ok', service: 'stellarplan-api', database: 'ok' });
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('returns 503 with a database field when the database is down', async () => {
    const prisma: any = { $queryRaw: jest.fn().mockRejectedValue(new Error('connection refused')) };

    const error = await new HealthController(prisma).check().catch((e) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getResponse()).toMatchObject({
      status: 'error',
      service: 'stellarplan-api',
      database: 'unreachable',
    });
  });

  it('does not leak the underlying database error', async () => {
    const prisma: any = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('password authentication failed for user "admin"')),
    };
    const error = await new HealthController(prisma).check().catch((e) => e);
    expect(JSON.stringify(error.getResponse())).not.toContain('password');
  });
});
