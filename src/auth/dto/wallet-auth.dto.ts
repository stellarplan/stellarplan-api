import { IsString, Matches } from 'class-validator';

export class WalletChallengeDto {
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'Must be a valid Stellar public key' })
  walletAddress: string;
}

export class WalletVerifyDto {
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'Must be a valid Stellar public key' })
  walletAddress: string;

  @IsString()
  signature: string;

  @IsString()
  nonce: string;
}
