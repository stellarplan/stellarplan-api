import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../common/decorators/current-user.decorator';
import { AllocationsService } from './allocations.service';
import { DetectAllocationsDto } from './dto/detect.dto';

@UseGuards(JwtAuthGuard)
@Controller('allocations')
export class AllocationsController {
  constructor(private readonly allocations: AllocationsService) {}

  /** Scan the connected wallet for new incoming payments and allocate them. */
  @Post('detect')
  detect(@CurrentUser() user: CurrentUserData, @Body() dto: DetectAllocationsDto) {
    return this.allocations.detectAndAllocate(user.id, dto.walletAddress);
  }

  /** Return the synthetic allocation history (grouped vaults + txs). */
  @Get('history')
  history(@CurrentUser() user: CurrentUserData) {
    return this.allocations.historyFor(user.id);
  }
}
