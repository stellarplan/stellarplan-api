import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../common/decorators/current-user.decorator';
import { TransactionsService } from './transactions.service';

@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentUserData,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    return this.transactions.listForUser(user.id, { type, limit: limit ? parseInt(limit, 10) : 50 });
  }
}
