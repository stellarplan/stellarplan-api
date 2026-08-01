import { IsString } from 'class-validator';

export class BreakVaultDto {
  @IsString()
  vaultId: string;
}
