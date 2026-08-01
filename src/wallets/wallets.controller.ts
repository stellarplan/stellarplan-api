import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../common/decorators/current-user.decorator';
import { ConnectWalletDto } from './dto/connect-wallet.dto';
import { WalletsService } from './wallets.service';

@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post('connect')
  connect(@CurrentUser() user: CurrentUserData, @Body() dto: ConnectWalletDto) {
    return this.wallets.connect(user.id, dto);
  }
}
