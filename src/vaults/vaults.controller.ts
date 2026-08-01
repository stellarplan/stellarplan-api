import { Controller, Get, Param, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../common/decorators/current-user.decorator';
import { BreakVaultDto } from './dto/break-vault.dto';
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

  @Post('break')
  breakVault(@CurrentUser() user: CurrentUserData, @Body() dto: BreakVaultDto) {
    return this.vaults.breakVault(user.id, dto.vaultId);
  }
}
