/* Seed a demo user with plans, vaults, transactions, and notifications. */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);

  const user = await prisma.user.upsert({
    where: { email: 'demo@stellarplan.app' },
    update: {},
    create: {
      email: 'demo@stellarplan.app',
      passwordHash,
      name: 'CJ',
      walletAddress: 'GBBD47ifRHETYWFMDLQ7RdjwS9q3TzrC6tS2h9xV7vT8W7T8zB3M2u9',
    },
  });

  const planDefs = [
    { name: 'House Rent', category: 'rent', amount: 900, unlockDay: 30, planType: 'BILL', icon: '🏠', description: 'Monthly house rent' },
    { name: 'Electricity', category: 'electricity', amount: 80, unlockDay: 28, planType: 'BILL', icon: '⚡', description: 'Power bill' },
    { name: 'Internet', category: 'internet', amount: 60, unlockDay: 25, planType: 'BILL', icon: '📶', description: 'Home internet' },
    { name: 'Water', category: 'water', amount: 35, unlockDay: 27, planType: 'BILL', icon: '💧', description: 'Water & sewage' },
    { name: 'School Fees', category: 'school', amount: 300, unlockDay: 5, planType: 'BILL', icon: '🎓', description: 'Kids school fees' },
    { name: 'Emergency Fund', category: 'emergency', amount: 250, planType: 'EMERGENCY', icon: '🛡', description: 'Break-glass fund' },
    { name: 'Savings', category: 'savings', amount: 400, planType: 'SAVINGS', icon: '🌱', description: 'Long-term savings' },
  ];

  for (const def of planDefs) {
    await prisma.budgetPlan.create({ data: { userId: user.id, ...def } });
  }

  const vaultDefs = planDefs.map((def) => ({
    userId: user.id,
    category: def.category,
    name: def.name,
    amount: def.amount,
    status: 'LOCKED',
    planType: def.planType,
    unlockDate: def.unlockDay
      ? new Date(new Date().getFullYear(), new Date().getMonth() + 1, def.unlockDay)
      : null,
    contractId: 'sim_contract',
    contractPlanId: Math.floor(Math.random() * 10000),
  }));

  await prisma.vault.createMany({ data: vaultDefs });

  await prisma.transaction.createMany({
    data: [
      { userId: user.id, wallet: user.walletAddress, amount: 2500, type: 'SALARY_DEPOSIT', description: 'Monthly salary received', txHash: 'sim_seed_1' },
      { userId: user.id, wallet: user.walletAddress, amount: 900, type: 'ALLOCATION', description: 'Allocated to rent', txHash: 'sim_seed_2' },
      { userId: user.id, wallet: user.walletAddress, amount: 80, type: 'ALLOCATION', description: 'Allocated to electricity', txHash: 'sim_seed_3' },
    ],
  });

  await prisma.notification.createMany({
    data: [
      { userId: user.id, title: 'Welcome to StellarPlan', message: 'Your financial plan is set up and ready to protect tomorrow.' },
      { userId: user.id, title: 'Salary received', message: '2,500 USDC allocated to 7 plan(s).' },
    ],
  });

  console.log('Seeded demo user:', user.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
