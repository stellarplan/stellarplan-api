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
import { VaultStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

@Injectable()
export class VaultsService {
  private readonly logger = new Logger(VaultsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
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

  /** Break a vault early (per PRD: confirm + wallet signature + friction countdown). */
  async breakVault(userId: string, vaultId: string) {
    const vault = await this.getForUser(userId, vaultId);
    if (vault.status !== VaultStatus.LOCKED) {
      throw new BadRequestException(`Vault is already ${vault.status.toLowerCase()}`);
    }

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
          wallet: vault.userId,
          amount: vault.amount,
          type: 'EARLY_WITHDRAWAL',
          description: `Early withdrawal from ${vault.category} vault`,
          txHash,
        },
      }),
      this.prisma.notification.create({
        data: {
          userId,
          title: `${vault.category} plan unlocked early`,
          message: `You withdrew ${Number(vault.amount).toFixed(7)} ${vault.category} from your plan. This may affect your ability to pay this bill on time.`,
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

    if (due.length === 0) return;

    this.logger.log(`Found ${due.length} vault(s) due for auto-unlock`);

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
              description: `${vault.category} plan unlocked`,
              txHash,
            },
          }),
          this.prisma.notification.create({
            data: {
              userId: vault.userId,
              title: `${vault.category} plan unlocked`,
              message: `Your ${vault.category} funds of ${Number(vault.amount).toFixed(7)} are now available.`,
            },
          }),
        ]);
      } catch (err) {
        this.logger.error(`Failed to auto-unlock vault ${vault.id}: ${err.message}`, err.stack);
      }
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
    return result._sum.amount ?? 0;
  }
}
