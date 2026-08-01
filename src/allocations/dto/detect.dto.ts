import { IsOptional, IsString, Matches } from 'class-validator';

export class DetectAllocationsDto {
  /** Optional — override the wallet address scanned for new incoming payments. */
  @IsOptional()
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'Must be a valid Stellar public key (G...)' })
  walletAddress?: string;
}

export class AllocationItem {
  planId: string;
  category: string;
  amount: number;
  contractPlanId: number;
}
