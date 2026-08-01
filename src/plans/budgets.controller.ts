import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../common/decorators/current-user.decorator';
import { CreatePlanDto, UpdatePlanDto } from '../plans/dto/plan.dto';
import { PlansService } from '../plans/plans.service';

/**
 * PRD Document 3 defines the public contract as `/budgets`.
 * Internally the domain entity is a "plan" (PlansModule), so this controller
 * is a thin alias so API consumers can use either path.
 */
@UseGuards(JwtAuthGuard)
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserData) {
    return this.plans.listForUser(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.plans.getForUser(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreatePlanDto) {
    return this.plans.create(user.id, dto);
  }

  @Put(':id')
  update(@CurrentUser() user: CurrentUserData, @Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.plans.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.plans.remove(user.id, id);
  }
}
