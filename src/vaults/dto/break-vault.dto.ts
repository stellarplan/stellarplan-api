import { IsString } from 'class-validator';

export class BreakVaultDto {
  @IsString()
  vaultId: string;

  /** Re-authentication per PRD §6 ("re-authenticate to unlock early"). */
  @IsString()
  password: string;
}
