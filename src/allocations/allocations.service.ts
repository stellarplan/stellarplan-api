import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const walletAddress = walletOverride ?? user.walletAddress;
    if (!walletAddress) throw new NotFoundException('No wallet connected');

    // Which vault contract this user's plans lock into: their own per-user
    // contract if they deployed one, otherwise the shared testnet vault
    // (VAULT_CONTRACT_ID). Only unavailable when the server has no contract at
    // all configured — a deploy/config problem, never something the user fixes.
    const contractId = this.stellar.contractIdFor(user.vaultContractId);
    if (!contractId) {
      throw new ServiceUnavailableException(
        'Vault contract is not configured on the server yet. Please try again shortly.',
      );
    }

    const payments = await this.stellar.getIncomingPayments(walletAddress);
    if (payments.length === 0) {
      this.logger.log(`No new payments for wallet ${walletAddress}`);
      return { allocated: 0, vaults: [], skipped: 0, paymentsProcessed: 0 };
    }

    const plans = await this.prisma.budgetPlan.findMany({
      where: { userId, active: true },
    });
    if (plans.length === 0) {
      this.logger.log(`No active plans for user ${userId}`);
      return { allocated: 0, vaults: [], skipped: payments.length, paymentsProcessed: 0 };
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

        // On-chain plan creation is mandatory — money must actually be locked
        // in the user's vault contract. A failure aborts this plan's allocation
        // rather than silently recording an unfunded DB row.
        const { contractPlanId, txHash } = await this.stellar.createPlanOnChain(
          userId,
          plan.name,
          item.amount,
          plan.planType,
          unlockDate,
        );
        transactionRecords.push({
          userId,
          wallet: walletAddress,
          amount: item.amount,
          type: 'ALLOCATION',
          description: `Allocated to ${plan.category} plan`,
          txHash,
        });

        vaultRecords.push({
          userId,
          budgetPlanId: plan.id,
          category: plan.category,
          name: plan.name,
          amount: item.amount,
          status: VaultStatus.LOCKED,
          unlockDate,
          planType: plan.planType,
          contractId,
          contractPlanId,
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

  /**
   * The next occurrence of `unlockDay` (1–28) as a UTC date. If this month's day
   * has already passed (or is today), roll to next month. Day is clamped to the
   * number of days in the target month.
   */
  private nextUnlockDate(unlockDay: number): Date {
    const now = new Date();
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth(); // 0-based
    const clamp = (y: number, m: number) => Math.min(unlockDay, this.daysInMonth(m, y));

    let candidate = new Date(Date.UTC(year, month, clamp(year, month)));
    if (candidate <= now) {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      candidate = new Date(Date.UTC(year, month, clamp(year, month)));
    }
    return candidate;
  }

  /** Days in a 0-based month. */
  private daysInMonth(month: number, year: number) {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  }
}
