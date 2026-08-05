import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { ChallengeService } from '../common/challenge.service';
import { verifyStellarSignature } from '../common/signature';
import { WalletChallengeDto, WalletVerifyDto } from './dto/wallet-auth.dto';

export interface JwtPayload {
  sub: string;
  walletAddress: string;
}

/**
 * Build the human-readable message a wallet signs. The exact bytes must match
 * on the frontend or verification fails. `action` lets the same handshake cover
 * login and sensitive actions (e.g. breaking a vault) with distinct context.
 */
export function challengeMessage(walletAddress: string, nonce: string, action = 'Sign in', context?: string): string {
  return [
    'StellarPlan authentication request.',
    '',
    `Action: ${action}`,
    ...(context ? [`Details: ${context}`] : []),
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    '',
    'Signing proves you control this wallet. It authorizes no transfer by itself.',
  ].join('\n');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly challenges: ChallengeService,
  ) {}

  /** Step 1 of login: issue a nonce for the wallet to sign. */
  createChallenge(dto: WalletChallengeDto) {
    const walletAddress = dto.walletAddress.trim();
    const nonce = this.challenges.issue(`login:${walletAddress}`);
    return { message: challengeMessage(walletAddress, nonce), nonce };
  }

  /**
   * Step 2 of login: verify the signature over the issued challenge. A valid
   * signature proves ownership of the public key; the account is created on
   * first successful login.
   */
  async verifyWallet(dto: WalletVerifyDto) {
    const walletAddress = dto.walletAddress.trim();
    if (!this.challenges.consume(`login:${walletAddress}`, dto.nonce)) {
      throw new UnauthorizedException('Challenge invalid or expired — request a new one');
    }

    const message = challengeMessage(walletAddress, dto.nonce);
    const ok = await verifyStellarSignature(walletAddress, message, dto.signature);
    if (!ok) throw new UnauthorizedException('Signature verification failed');

    let user = await this.prisma.user.findUnique({ where: { walletAddress } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          name: `Stellar ${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`,
          walletAddress,
        },
      });
    }

    await this.prisma.walletConnection
      .upsert({
        where: { userId: user.id },
        create: { userId: user.id, walletId: 'FREIGHTER', address: walletAddress },
        update: { address: walletAddress, walletId: 'FREIGHTER' },
      })
      .catch(() => {});

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    const hashed = hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { token: hashed }, include: { user: true } });
    if (!record || record.expiresAt < new Date()) throw new UnauthorizedException('Invalid refresh token');
    await this.prisma.refreshToken.delete({ where: { id: record.id } });
    return this.issueTokens(record.user);
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
    return { ok: true };
  }

  async profile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, walletAddress: true, vaultContractId: true, createdAt: true },
    });
  }

  private async issueTokens(user: { id: string; walletAddress: string | null }) {
    const payload: JwtPayload = { sub: user.id, walletAddress: user.walletAddress ?? '' };
    const accessToken = await this.jwt.signAsync(payload);
    // Store only a hash of the refresh token so a DB leak can't be replayed.
    const refreshToken = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({ data: { token: hashToken(refreshToken), expiresAt, userId: user.id } });
    return { accessToken, refreshToken };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
