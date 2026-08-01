import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  listForUser(
    userId: string,
    opts: { type?: string; limit?: number } = {},
  ) {
    return this.prisma.transaction.findMany({
      where: {
        userId,
        ...(opts.type ? { type: opts.type as any } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 50,
    });
  }
}
