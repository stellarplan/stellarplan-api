import { IsString } from 'class-validator';

export class BreakVaultChallengeDto {
  @IsString()
  vaultId: string;
}

export class BreakVaultDto {
  @IsString()
  vaultId: string;

  /** Nonce issued by POST /vaults/break/challenge. */
  @IsString()
  nonce: string;

  /** Base64 ed25519 signature of the challenge message, from the user's wallet. */
  @IsString()
  signature: string;
}
