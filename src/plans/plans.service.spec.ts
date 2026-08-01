import { Test } from '@nestjs/testing';
import { PlansService } from './plans.service';
import { PrismaService } from '../common/prisma.service';
import { PlanType } from '@prisma/client';

const mockPrisma = () => ({
  budgetPlan: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
});

describe('PlansService', () => {
  let service: PlansService;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [PlansService, { provide: PrismaService, useFactory: mockPrisma }],
    }).compile();
    service = module.get(PlansService);
    prisma = module.get(PrismaService) as any;
  });

  it('creates a bill plan with an unlock day', async () => {
    prisma.budgetPlan.create.mockResolvedValue({ id: 'p1' });
    await service.create('u1', {
      name: 'House Rent', category: 'Rent', amount: 900, unlockDay: 30, planType: PlanType.BILL,
    });
    expect(prisma.budgetPlan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', category: 'rent', unlockDay: 30, icon: '🏠' }),
    });
  });

  it('clears unlockDay for emergency plans', async () => {
    prisma.budgetPlan.create.mockResolvedValue({ id: 'p2' });
    await service.create('u1', {
      name: 'Emergency', category: 'emergency', amount: 250, planType: PlanType.EMERGENCY,
    });
    expect(prisma.budgetPlan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ unlockDay: null, icon: '🛡' }),
    });
  });

  it('rejects reading another user\'s plan', async () => {
    prisma.budgetPlan.findUnique.mockResolvedValue({ id: 'p1', userId: 'someone-else' });
    await expect(service.getForUser('u1', 'p1')).rejects.toThrow();
  });
});
