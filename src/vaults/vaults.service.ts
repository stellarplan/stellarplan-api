import { Cron } from '@nestjs/schedule';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StellarService } from '../stellar/stellar.service';
import { ChallengeService } from '../common/challenge.service';
import { challengeMessage } from '../auth/auth.service';
import { verifyStellarSignature } from '../common/signature';
import { VaultStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

@Injectable()
export class VaultsService {
  private readonly logger = new Logger(VaultsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly challenges: ChallengeService,
  ) {}

  async listForUser(userId: string) {
    return this.prisma.vault.findMany({
      where: { userId },
      orderBy: [{ unlockDate: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getForUser(userId: string, id: string) {
    const vault = await this.prisma.vault.findUnique({
      where: { id },
    });
    if (!vault) throw new NotFoundException('Vault not found');
    if (vault.userId !== userId) throw new ForbiddenException();
    return vault;
  }

  /**
   * Step 1 of an early break: issue a nonce the user's wallet must sign. This
   * is the intentional friction the PRD requires, implemented as a real wallet
   * signature rather than a password.
   */
  async createBreakChallenge(userId: string, vaultId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.walletAddress) throw new BadRequestException('No wallet connected');
    const vault = await this.getForUser(userId, vaultId);
    if (vault.status !== VaultStatus.LOCKED) {
      throw new BadRequestException(`Vault is already ${vault.status.toLowerCase()}`);
    }
    const nonce = this.challenges.issue(`break:${userId}:${vaultId}`);
    const message = challengeMessage(
      user.walletAddress,
      nonce,
      'Break plan early',
      `${vault.name} · ${Number(vault.amount).toFixed(7)}`,
    );
    return { message, nonce };
  }

  /**
   * Step 2 of an early break: verify the wallet signature over the challenge,
   * then execute the on-chain early withdrawal.
   */
  async breakVault(userId: string, vaultId: string, nonce: string, signature: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.walletAddress) throw new BadRequestException('No wallet connected');

    if (!this.challenges.consume(`break:${userId}:${vaultId}`, nonce)) {
      throw new ForbiddenException('Break challenge invalid or expired — start again');
    }

    const vault = await this.getForUser(userId, vaultId);
    if (vault.status !== VaultStatus.LOCKED) {
      throw new BadRequestException(`Vault is already ${vault.status.toLowerCase()}`);
    }

    const message = challengeMessage(
      user.walletAddress,
      nonce,
      'Break plan early',
      `${vault.name} · ${Number(vault.amount).toFixed(7)}`,
    );
    const ok = await verifyStellarSignature(user.walletAddress, message, signature);
    if (!ok) throw new ForbiddenException('Signature verification failed');

    const txHash = await this.stellar.releaseVault(userId, vaultId, true);

    await this.prisma.$transaction([
      this.prisma.vault.update({
        where: { id: vaultId },
        data: {
          status: VaultStatus.EARLY_WITHDRAWN,
          earlyWithdrawnAt: new Date(),
          breakTxHash: txHash,
        },
      }),
      this.prisma.transaction.create({
        data: {
          userId,
          wallet: user.walletAddress ?? '',
          amount: vault.amount,
          type: 'EARLY_WITHDRAWAL',
          description: `Early withdrawal from ${vault.name} plan`,
          txHash,
        },
      }),
      this.prisma.notification.create({
        data: {
          userId,
          title: `${vault.name} plan withdrawn early`,
          message: `You withdrew ${Number(vault.amount).toFixed(7)} from your ${vault.name} plan early. This may affect your ability to pay this bill on time.`,
        },
      }),
    ]);

    return this.getForUser(userId, vaultId);
  }

  /**
   * Auto-unlock any vaults whose unlock date has arrived.
   * Runs every day at 06:00 server time.
   */
  @Cron('0 6 * * *')
  async autoUnlockDueVaults() {
    const now = new Date();
    const due = await this.prisma.vault.findMany({
      where: { status: VaultStatus.LOCKED, unlockDate: { lte: now } },
      include: { user: { select: { walletAddress: true } } },
    });

    if (due.length > 0) this.logger.log(`Found ${due.length} vault(s) due for auto-unlock`);

    for (const vault of due) {
      try {
        const txHash = await this.stellar.releaseVault(vault.userId, vault.id, false);
        await this.prisma.$transaction([
          this.prisma.vault.update({
            where: { id: vault.id },
            data: { status: VaultStatus.RELEASED, releasedAt: now, releaseTxHash: txHash },
          }),
          this.prisma.transaction.create({
            data: {
              userId: vault.userId,
              wallet: vault.user.walletAddress ?? '',
              amount: vault.amount,
              type: 'RELEASE',
              description: `${vault.name} plan unlocked`,
              txHash,
            },
          }),
          this.prisma.notification.create({
            data: {
              userId: vault.userId,
              title: `${vault.name} plan unlocked`,
              message: `Your ${vault.name} funds of ${Number(vault.amount).toFixed(7)} are now available.`,
            },
          }),
        ]);
      } catch (err) {
        this.logger.error(`Failed to auto-unlock vault ${vault.id}: ${err.message}`, err.stack);
      }
    }

    // heads-up notifications for vaults unlocking tomorrow (PRD § notifications)
    const tomorrowStart = new Date(now); tomorrowStart.setUTCDate(now.getUTCDate() + 1);
    tomorrowStart.setUTCHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrowStart); tomorrowEnd.setUTCDate(tomorrowStart.getUTCDate() + 1);
    const soon = await this.prisma.vault.findMany({
      where: {
        status: VaultStatus.LOCKED,
        unlockDate: { gte: tomorrowStart, lt: tomorrowEnd },
      },
    });
    for (const v of soon) {
      await this.prisma.notification.create({
        data: {
          userId: v.userId,
          title: `${v.name} plan unlocks tomorrow`,
          message: `Your ${v.name} plan (${Number(v.amount).toFixed(7)}) will become available tomorrow.`,
        },
      });
    }
  }

  /** Create multiple vaults at once (used by the allocation engine). */
  async createMany(vaults: Prisma.VaultCreateManyInput[]) {
    return this.prisma.vault.createMany({ data: vaults });
  }

  /** Total locked balance for a user. */
  async protectedTotal(userId: string) {
    const result = await this.prisma.vault.aggregate({
      where: { userId, status: VaultStatus.LOCKED },
      _sum: { amount: true },
    });
    return Number(result._sum.amount ?? 0);
  }
}
