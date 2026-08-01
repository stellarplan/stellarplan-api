import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { PlansModule } from './plans/plans.module';
import { VaultsModule } from './vaults/vaults.module';
import { AllocationsModule } from './allocations/allocations.module';
import { TransactionsModule } from './transactions/transactions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StellarModule } from './stellar/stellar.module';
import { PrismaModule } from './common/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    PlansModule,
    VaultsModule,
    AllocationsModule,
    TransactionsModule,
    NotificationsModule,
    StellarModule,
  ],
})
export class AppModule {}
