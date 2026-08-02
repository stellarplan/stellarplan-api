import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StellarService } from '../stellar/stellar.service';
import { VaultStatus } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
  ) {}

  async profile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        walletAddress: true,
        vaultContractId: true,
        createdAt: true,
        _count: { select: { budgetPlans: true, vaults: true } },
      },
    });
  }

  async getWalletBalance(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.walletAddress) return { usdc: 0, xlm: 0, available: 0, protected: 0 };

    const [horizonBal, vaults] = await Promise.all([
      this.stellar.getAccountBalances(user.walletAddress),
      this.prisma.vault.findMany({ where: { userId, status: VaultStatus.LOCKED } }),
    ]);

    const protectedTotal = vaults.reduce((acc, v) => acc + Number(v.amount), 0);
    const available = Math.max(0, horizonBal.usdc - protectedTotal);

    return {
      usdc: horizonBal.usdc,
      xlm: horizonBal.xlm,
      protected: protectedTotal,
      available,
    };
  }

  async dashboard(userId: string) {
    const [user, plans, vaults, recentTx, unreadNotifications] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, walletAddress: true, vaultContractId: true },
      }),
      this.prisma.budgetPlan.findMany({ where: { userId, active: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.vault.findMany({ where: { userId }, orderBy: { unlockDate: 'asc' } }),
      this.prisma.transaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.notification.count({ where: { userId, read: false } }),
    ]);

    const protectedBalance = vaults
      .filter((v) => v.status === VaultStatus.LOCKED)
      .reduce((acc, v) => acc + Number(v.amount), 0);
    const releasedThisMonth = vaults
      .filter((v) => v.status === VaultStatus.RELEASED && v.releasedAt && v.releasedAt.getMonth() === new Date().getMonth())
      .reduce((acc, v) => acc + Number(v.amount), 0);
    const totalPlanned = plans.reduce((acc, p) => acc + Number(p.amount), 0);

    let onChainAvailable = 0;
    if (user?.walletAddress) {
      const horizonBal = await this.stellar.getAccountBalances(user.walletAddress);
      if (horizonBal.usdc > 0) {
        onChainAvailable = Math.max(0, horizonBal.usdc - protectedBalance);
      }
    }

    return {
      user,
      balances: {
        protected: protectedBalance,
        planned: totalPlanned,
        releasedThisMonth,
        onChainAvailable,
      },
      plans,
      vaults,
      recentTransactions: recentTx,
      unreadNotifications,
    };
  }
}
