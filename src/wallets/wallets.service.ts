import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ConnectWalletDto } from './dto/connect-wallet.dto';
import { WalletType } from '@prisma/client';

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  async connect(userId: string, dto: ConnectWalletDto) {
    const existing = await this.prisma.walletConnection.findUnique({ where: { userId } });
    if (existing) throw new ConflictException('Wallet already connected. Disconnect first to change.');

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { walletAddress: dto.address },
      }),
      this.prisma.walletConnection.create({
        data: {
          userId,
          walletId: dto.walletId as WalletType,
          address: dto.address,
        },
      }),
    ]);

    return this.getWalletStatus(userId);
  }

  async getWalletStatus(userId: string) {
    return this.prisma.walletConnection.findUnique({
      where: { userId },
      select: { userId: true, walletId: true, address: true, createdAt: true },
    });
  }
}
