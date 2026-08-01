import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StellarService } from '../stellar/stellar.service';
import { VaultsService } from '../vaults/vaults.service';
import { VaultStatus } from '@prisma/client';

@Injectable()
export class AllocationsService {
  private readonly logger = new Logger(AllocationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly vaults: VaultsService,
  ) {}

  /**
   * 1. Scan the user's wallet for new incoming payments.
   * 2. For each new payment not yet allocated, create vaults for every active plan,
   *    proportional to the plan's share of the user's total monthly plan.
   * 3. Writes vault + transaction rows and, if the user has a vault contract,
   *    also creates the plan on-chain.
   */
  async detectAndAllocate(userId: string, walletOverride?: string) {
    const walletAddress = walletOverride ?? (await this.resolveWallet(userId));
    if (!walletAddress) throw new NotFoundException('No wallet connected');

    const payments = await this.stellar.getIncomingPayments(walletAddress);
    if (payments.length === 0) {
      this.logger.log(`No new payments for wallet ${walletAddress}`);
      return { allocated: 0, vaults: [], skipped: 0 };
    }

    const plans = await this.prisma.budgetPlan.findMany({
      where: { userId, active: true },
    });
    if (plans.length === 0) {
      this.logger.log(`No active plans for user ${userId}`);
      return { allocated: 0, vaults: [], skipped: payments.length };
    }

    const totalPlanned = plans.reduce((acc, p) => acc + Number(p.amount), 0);

    const results = [];
    for (const payment of payments) {
      const alreadyProcessed = await this.prisma.transaction.findFirst({
        where: {
          userId,
          txHash: payment.txHash,
          type: 'ALLOCATION',
        },
      });
      if (alreadyProcessed) continue;

      const allocation = this.allocate(payment.amount, plans, totalPlanned);

      const vaultRecords: any[] = [];
      const transactionRecords: any[] = [];

      for (const item of allocation) {
        const plan = plans.find((p) => p.id === item.planId)!;
        const unlockDate =
          plan.planType === 'BILL' && plan.unlockDay
            ? this.nextUnlockDate(plan.unlockDay)
            : null;

        let contractPlanId: number | null = null;
        if (await this.userHasVaultContract(userId)) {
          try {
            const { contractPlanId: onChainId, txHash } = await this.stellar.createPlanOnChain(
              userId,
              plan.name,
              item.amount,
              plan.planType,
              unlockDate,
            );
            contractPlanId = onChainId;
            transactionRecords.push({
              userId,
              wallet: walletAddress,
              amount: item.amount,
              type: 'ALLOCATION',
              description: `Allocated to ${plan.category} plan`,
              txHash,
            });
          } catch (err) {
            this.logger.warn(
              `On-chain plan creation failed for ${plan.name}: ${err.message}. Skipping DB-only.`,
            );
          }
        } else {
          // Off-chain only for MVP when no contract deployed yet.
        }

        vaultRecords.push({
          userId,
          budgetPlanId: plan.id,
          category: plan.category,
          name: plan.name,
          amount: item.amount,
          status: VaultStatus.LOCKED,
          unlockDate,
          planType: plan.planType,
          contractId: (await this.prisma.user.findUnique({ where: { id: userId } }))?.vaultContractId ?? '',
          contractPlanId: contractPlanId ?? 0,
        });
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.vault.createMany({ data: vaultRecords });
        await tx.transaction.createMany({ data: transactionRecords });
        await tx.transaction.create({
          data: {
            userId,
            wallet: walletAddress,
            amount: payment.amount,
            type: 'SALARY_DEPOSIT',
            description: `Salary received — allocated across ${allocation.length} plan(s)`,
            txHash: payment.txHash,
          },
        });
        await tx.notification.create({
          data: {
            userId,
            title: 'Salary received',
            message: `${payment.amount.toFixed(7)} USDC allocated to ${allocation.length} plan(s). Your financial plan is complete.`,
          },
        });
      });

      results.push({ payment, allocated: allocation.length });
    }

    return {
      allocated: results.reduce((acc, r) => acc + r.allocated, 0),
      vaults: results.flatMap((r) => r.payment.txHash),
      skipped: payments.length - results.length,
      paymentsProcessed: results.length,
    };
  }

  /** Return grouped allocation history for the activity feed. */
  async historyFor(userId: string) {
    const bvts = await this.prisma.transaction.groupBy({
      by: ['txHash'],
      where: { userId, type: 'ALLOCATION' },
      _count: { id: true },
      _sum: { amount: true },
      _min: { createdAt: true },
    });

    return bvts.map((g) => ({
      txHash: g.txHash,
      vaultCount: g._count.id,
      totalAmount: Number(g._sum.amount ?? 0),
      date: g._min.createdAt,
    }));
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async resolveWallet(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true },
    });
    return user?.walletAddress ?? null;
  }

  private allocate(
    salary: number,
    plans: Array<{ id: string; category: string; amount: any; planType: any; unlockDay: number | null }>,
    totalPlanned: number,
  ) {
    if (totalPlanned <= 0) return [];

    let remaining = salary;
    const allocations: Array<{ planId: string; category: string; amount: number }> = [];

    for (const plan of plans) {
      if (remaining <= 0) break;
      const share = Number(plan.amount) / totalPlanned;
      const amount = Math.min(Number(plan.amount), salary * share, remaining);
      remaining -= amount;
      allocations.push({ planId: plan.id, category: plan.category, amount });
    }

    return allocations;
  }

  private nextUnlockDate(unlockDay: number): Date {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    next.setUTCDate(Math.min(unlockDay, this.daysInMonth(next.getUTCMonth() + 1, next.getUTCFullYear())));
    if (next <= now) {
      next.setUTCMonth(next.getUTCMonth() + 1);
    }
    return next;
  }

  private daysInMonth(month: number, year: number) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  private async userHasVaultContract(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { vaultContractId: true },
    });
    return !!user?.vaultContractId;
  }
}
