import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';
import { PlanType } from '@prisma/client';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string) {
    return this.prisma.budgetPlan.findMany({
      where: { userId },
      orderBy: [{ planType: 'asc' }, { unlockDay: 'asc' }],
    });
  }

  async getForUser(userId: string, id: string) {
    const plan = await this.prisma.budgetPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.userId !== userId) throw new ForbiddenException();
    return plan;
  }

  async create(userId: string, dto: CreatePlanDto) {
    // Determine unlockDay for bills; others are "always locked" until broken.
    const planType = dto.planType ?? PlanType.BILL;
    const unlockDay = planType === PlanType.BILL ? (dto.unlockDay ?? null) : null;

    return this.prisma.budgetPlan.create({
      data: {
        userId,
        name: dto.name,
        category: dto.category.toLowerCase(),
        amount: dto.amount,
        unlockDay,
        planType,
        description: dto.description,
        icon: dto.icon ?? (planType === PlanType.BILL ? '🏠' : planType === PlanType.EMERGENCY ? '🛡' : '🌱'),
      },
    });
  }

  async update(userId: string, id: string, dto: UpdatePlanDto) {
    await this.getForUser(userId, id); // ownership check
    return this.prisma.budgetPlan.update({
      where: { id },
      data: {
        ...dto,
        category: dto.category?.toLowerCase(),
        unlockDay: dto.planType === PlanType.BILL ? dto.unlockDay : null,
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.getForUser(userId, id);
    return this.prisma.budgetPlan.delete({ where: { id } });
  }
}
