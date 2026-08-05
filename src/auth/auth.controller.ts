import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { WalletChallengeDto, WalletVerifyDto } from './dto/wallet-auth.dto';
import { RefreshDto } from './dto/refresh.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Step 1 of Freighter login: request a nonce to sign. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('challenge')
  challenge(@Body() dto: WalletChallengeDto) {
    return this.auth.createChallenge(dto);
  }

  /** Step 2 of Freighter login: submit the signed nonce. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('wallet')
  verifyWallet(@Body() dto: WalletVerifyDto) {
    return this.auth.verifyWallet(dto);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@CurrentUser() user: CurrentUserData) {
    return this.auth.logout(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: CurrentUserData) {
    return this.auth.profile(user.id);
  }
}
