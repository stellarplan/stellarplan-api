import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return the wallet recorded for this user. The record is created during
   * signature login (see AuthService.verifyWallet); there is no separate
   * connect step.
   */
  async getWalletStatus(userId: string) {
    return this.prisma.walletConnection.findUnique({
      where: { userId },
      select: { userId: true, walletId: true, address: true, createdAt: true },
    });
  }
}
