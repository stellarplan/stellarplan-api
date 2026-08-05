import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../common/decorators/current-user.decorator';
import { WalletsService } from './wallets.service';

/**
 * The wallet is established at login: proving control of the key via signature
 * IS the connection. There is deliberately no endpoint to set an arbitrary
 * address — that would let an authenticated session point payment detection at
 * a wallet it never proved ownership of. This controller is read-only.
 */
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Get()
  status(@CurrentUser() user: CurrentUserData) {
    return this.wallets.getWalletStatus(user.id);
  }
}
