import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { ChallengeService } from '../common/challenge.service';
import { PrismaService } from '../common/prisma.service';
import { AuthService, challengeMessage } from './auth.service';

function signSep53(keypair: Keypair, message: string): string {
  const payload = Buffer.concat([
    Buffer.from('Stellar Signed Message:\n', 'utf8'),
    Buffer.from(message, 'utf8'),
  ]);
  return keypair.sign(createHash('sha256').update(payload).digest()).toString('base64');
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const mockPrisma = () => ({
  user: { findUnique: jest.fn(), create: jest.fn() },
  walletConnection: { upsert: jest.fn().mockResolvedValue({}) },
  refreshToken: {
    findUnique: jest.fn(),
    create: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
});

describe('AuthService', () => {
  const wallet = Keypair.random();
  const address = wallet.publicKey();
  let service: AuthService;
  let prisma: ReturnType<typeof mockPrisma>;
  let jwt: { signAsync: jest.Mock };

  beforeEach(async () => {
    jwt = { signAsync: jest.fn().mockResolvedValue('access-token') };
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        ChallengeService,
        { provide: PrismaService, useFactory: mockPrisma },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();
    service = module.get(AuthService);
    prisma = module.get(PrismaService) as any;
  });

  describe('challengeMessage', () => {
    it('includes the action, wallet, nonce, and a no-transfer notice', () => {
      const message = challengeMessage(address, 'abc123');
      expect(message).toContain('Action: Sign in');
      expect(message).toContain(`Wallet: ${address}`);
      expect(message).toContain('Nonce: abc123');
      expect(message).toContain('authorizes no transfer');
    });

    it('adds a details line only when context is given', () => {
      expect(challengeMessage(address, 'n')).not.toContain('Details:');
      expect(challengeMessage(address, 'n', 'Break plan early', 'Rent')).toContain(
        'Details: Rent',
      );
    });
  });

  describe('login', () => {
    it('trims the wallet address when issuing a challenge', () => {
      const { message } = service.createChallenge({ walletAddress: `  ${address}  ` } as any);
      expect(message).toContain(`Wallet: ${address}`);
    });

    it('creates a user on first valid login and returns tokens', async () => {
      const { message, nonce } = service.createChallenge({ walletAddress: address } as any);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'u1', walletAddress: address });

      const tokens = await service.verifyWallet({
        walletAddress: address,
        nonce,
        signature: signSep53(wallet, message),
      } as any);

      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(tokens.accessToken).toBe('access-token');
      expect(tokens.refreshToken).toMatch(/^[0-9a-f]{96}$/);
    });

    it('does not create a second user for a returning wallet', async () => {
      const { message, nonce } = service.createChallenge({ walletAddress: address } as any);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', walletAddress: address });

      await service.verifyWallet({
        walletAddress: address,
        nonce,
        signature: signSep53(wallet, message),
      } as any);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects a wrong signature and issues no tokens', async () => {
      const { nonce } = service.createChallenge({ walletAddress: address } as any);
      await expect(
        service.verifyWallet({
          walletAddress: address,
          nonce,
          signature: Buffer.alloc(64, 1).toString('base64'),
        } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it("rejects another wallet's signature over the same challenge", async () => {
      const { message, nonce } = service.createChallenge({ walletAddress: address } as any);
      await expect(
        service.verifyWallet({
          walletAddress: address,
          nonce,
          signature: signSep53(Keypair.random(), message),
        } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an unknown nonce before checking the signature', async () => {
      await expect(
        service.verifyWallet({
          walletAddress: address,
          nonce: 'never-issued',
          signature: Buffer.alloc(64).toString('base64'),
        } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('cannot be replayed with the same signed challenge', async () => {
      const { message, nonce } = service.createChallenge({ walletAddress: address } as any);
      const dto = { walletAddress: address, nonce, signature: signSep53(wallet, message) } as any;
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', walletAddress: address });

      await service.verifyWallet(dto);
      await expect(service.verifyWallet(dto)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('stores only a hash of the refresh token', async () => {
      const { message, nonce } = service.createChallenge({ walletAddress: address } as any);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', walletAddress: address });

      const { refreshToken } = await service.verifyWallet({
        walletAddress: address,
        nonce,
        signature: signSep53(wallet, message),
      } as any);

      const stored = prisma.refreshToken.create.mock.calls[0][0].data;
      expect(stored.token).toBe(sha256(refreshToken));
      expect(stored.token).not.toBe(refreshToken);
      expect(stored.userId).toBe('u1');
    });
  });

  describe('refresh', () => {
    it('rotates a valid refresh token: old one deleted, new pair issued', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'r1',
        expiresAt: new Date(Date.now() + 60_000),
        user: { id: 'u1', walletAddress: address },
      });

      const tokens = await service.refresh('old-token');

      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { token: sha256('old-token') },
        include: { user: true },
      });
      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
      expect(tokens.refreshToken).not.toBe('old-token');
    });

    it('rejects an unknown token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh('nope')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired token without issuing anything', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'r1',
        expiresAt: new Date(Date.now() - 1),
        user: { id: 'u1', walletAddress: address },
      });
      await expect(service.refresh('old')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes every refresh token for the user', async () => {
      await expect(service.logout('u1')).resolves.toEqual({ ok: true });
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    });
  });
});
