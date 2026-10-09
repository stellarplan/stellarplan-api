import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { VaultStatus } from '@prisma/client';
import { ChallengeService } from '../common/challenge.service';
import { PrismaService } from '../common/prisma.service';
import { StellarService } from '../stellar/stellar.service';
import { VaultsService } from './vaults.service';

/** Sign a message the way a SEP-53 wallet (e.g. Freighter) does. */
function signSep53(keypair: Keypair, message: string): string {
  const payload = Buffer.concat([
    Buffer.from('Stellar Signed Message:\n', 'utf8'),
    Buffer.from(message, 'utf8'),
  ]);
  const hash = createHash('sha256').update(payload).digest();
  return keypair.sign(hash).toString('base64');
}

const mockPrisma = () => {
  const prisma: any = {
    user: { findUnique: jest.fn() },
    vault: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), aggregate: jest.fn() },
    transaction: { create: jest.fn() },
    notification: { create: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return prisma;
};

describe('VaultsService', () => {
  const owner = Keypair.random();
  const stranger = Keypair.random();
  const lockedVault = {
    id: 'v1',
    userId: 'u1',
    name: 'Rent',
    amount: 900,
    status: VaultStatus.LOCKED,
  };

  let service: VaultsService;
  let prisma: ReturnType<typeof mockPrisma>;
  let stellar: { releaseVault: jest.Mock };

  beforeEach(async () => {
    stellar = { releaseVault: jest.fn().mockResolvedValue('tx-hash') };
    const module = await Test.createTestingModule({
      providers: [
        VaultsService,
        ChallengeService,
        { provide: PrismaService, useFactory: mockPrisma },
        { provide: StellarService, useValue: stellar },
      ],
    }).compile();
    service = module.get(VaultsService);
    prisma = module.get(PrismaService) as any;

    prisma.user.findUnique.mockResolvedValue({ id: 'u1', walletAddress: owner.publicKey() });
    prisma.vault.findUnique.mockResolvedValue(lockedVault);
  });

  describe('break challenge', () => {
    it('issues a message that names the wallet, the plan, and the nonce', async () => {
      const { message, nonce } = await service.createBreakChallenge('u1', 'v1');
      expect(message).toContain(owner.publicKey());
      expect(message).toContain('Break plan early');
      expect(message).toContain('Rent');
      expect(message).toContain(nonce);
    });

    it('refuses when the user has no wallet', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', walletAddress: null });
      await expect(service.createBreakChallenge('u1', 'v1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses a vault that is already released', async () => {
      prisma.vault.findUnique.mockResolvedValue({ ...lockedVault, status: VaultStatus.RELEASED });
      await expect(service.createBreakChallenge('u1', 'v1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("refuses another user's vault", async () => {
      prisma.vault.findUnique.mockResolvedValue({ ...lockedVault, userId: 'someone-else' });
      await expect(service.createBreakChallenge('u1', 'v1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('reports a missing vault', async () => {
      prisma.vault.findUnique.mockResolvedValue(null);
      await expect(service.createBreakChallenge('u1', 'v1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('breakVault signature check (regression)', () => {
    it('rejects a garbage signature and never touches the chain', async () => {
      const { nonce } = await service.createBreakChallenge('u1', 'v1');
      const garbage = Buffer.alloc(64, 7).toString('base64');

      await expect(service.breakVault('u1', 'v1', nonce, garbage)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(stellar.releaseVault).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a signature that is not 64 bytes', async () => {
      const { nonce } = await service.createBreakChallenge('u1', 'v1');
      await expect(
        service.breakVault('u1', 'v1', nonce, Buffer.from('short').toString('base64')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(stellar.releaseVault).not.toHaveBeenCalled();
    });

    it("rejects a valid signature made by a different wallet", async () => {
      const { message, nonce } = await service.createBreakChallenge('u1', 'v1');
      const forged = signSep53(stranger, message);

      await expect(service.breakVault('u1', 'v1', nonce, forged)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(stellar.releaseVault).not.toHaveBeenCalled();
    });

    it('rejects a valid signature over a different message', async () => {
      const { nonce } = await service.createBreakChallenge('u1', 'v1');
      const wrongMessage = signSep53(owner, 'something else entirely');

      await expect(service.breakVault('u1', 'v1', nonce, wrongMessage)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(stellar.releaseVault).not.toHaveBeenCalled();
    });

    it("accepts the owner's real signature and withdraws once", async () => {
      const { message, nonce } = await service.createBreakChallenge('u1', 'v1');
      const signature = signSep53(owner, message);

      await service.breakVault('u1', 'v1', nonce, signature);

      expect(stellar.releaseVault).toHaveBeenCalledTimes(1);
      expect(stellar.releaseVault).toHaveBeenCalledWith('u1', 'v1', true);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('breakVault challenge handling', () => {
    it('rejects a nonce that was never issued', async () => {
      await expect(
        service.breakVault('u1', 'v1', 'not-a-real-nonce', Buffer.alloc(64).toString('base64')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(stellar.releaseVault).not.toHaveBeenCalled();
    });

    it('does not let a challenge be replayed', async () => {
      const { message, nonce } = await service.createBreakChallenge('u1', 'v1');
      const signature = signSep53(owner, message);

      await service.breakVault('u1', 'v1', nonce, signature);
      await expect(service.breakVault('u1', 'v1', nonce, signature)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(stellar.releaseVault).toHaveBeenCalledTimes(1);
    });

    it("does not accept a nonce issued for a different vault", async () => {
      const { message, nonce } = await service.createBreakChallenge('u1', 'v1');
      const signature = signSep53(owner, message);
      prisma.vault.findUnique.mockResolvedValue({ ...lockedVault, id: 'v2' });

      await expect(service.breakVault('u1', 'v2', nonce, signature)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(stellar.releaseVault).not.toHaveBeenCalled();
    });

    it('refuses to break a vault that is no longer locked', async () => {
      const { message, nonce } = await service.createBreakChallenge('u1', 'v1');
      const signature = signSep53(owner, message);
      prisma.vault.findUnique.mockResolvedValue({
        ...lockedVault,
        status: VaultStatus.EARLY_WITHDRAWN,
      });

      await expect(service.breakVault('u1', 'v1', nonce, signature)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(stellar.releaseVault).not.toHaveBeenCalled();
    });
  });

  describe('protectedTotal', () => {
    it('sums only locked vaults and treats no vaults as zero', async () => {
      prisma.vault.aggregate.mockResolvedValue({ _sum: { amount: null } });
      expect(await service.protectedTotal('u1')).toBe(0);
      prisma.vault.aggregate.mockResolvedValue({ _sum: { amount: 1250.5 } });
      expect(await service.protectedTotal('u1')).toBe(1250.5);
      expect(prisma.vault.aggregate).toHaveBeenLastCalledWith({
        where: { userId: 'u1', status: VaultStatus.LOCKED },
        _sum: { amount: true },
      });
    });
  });
});
