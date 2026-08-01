import { Module } from '@nestjs/common';
import { BudgetsController } from './budgets.controller';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  controllers: [PlansController, BudgetsController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
