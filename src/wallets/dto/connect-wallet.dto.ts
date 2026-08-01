import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { WalletType } from '@prisma/client';

export class ConnectWalletDto {
  @IsEnum(WalletType)
  walletId: WalletType;

  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'Must be a valid Stellar public key (G...)' })
  address: string;
}
