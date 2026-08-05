import { Controller, Get, Param, Post, Body, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../common/decorators/current-user.decorator';
import { BreakVaultChallengeDto, BreakVaultDto } from './dto/break-vault.dto';
import { VaultsService } from './vaults.service';

@UseGuards(JwtAuthGuard)
@Controller('vaults')
export class VaultsController {
  constructor(private readonly vaults: VaultsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserData) {
    return this.vaults.listForUser(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.vaults.getForUser(user.id, id);
  }

  /** Step 1 of an early break: get the message the wallet must sign. */
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('break/challenge')
  breakChallenge(@CurrentUser() user: CurrentUserData, @Body() dto: BreakVaultChallengeDto) {
    return this.vaults.createBreakChallenge(user.id, dto.vaultId);
  }

  /** Step 2 of an early break: submit the signed challenge. */
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('break')
  breakVault(@CurrentUser() user: CurrentUserData, @Body() dto: BreakVaultDto) {
    return this.vaults.breakVault(user.id, dto.vaultId, dto.nonce, dto.signature);
  }
}
