/*
 * Seed a demo user with budget-plan definitions for local development.
 *
 * Deliberately does NOT create vaults or salary/allocation transactions: those
 * represent real funds locked on-chain, and fabricating them (fake contract ids,
 * fake tx hashes) would reintroduce exactly the mock state this project removed.
 * Vaults appear only after a real salary payment is detected and locked on-chain.
 */
const { PrismaClient } = require('@prisma/client');
const { Keypair } = require('@stellar/stellar-sdk');

const prisma = new PrismaClient();

async function main() {
  // Deterministic, checksum-valid demo wallet (never use this key for real funds).
  const demoWallet = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();

  const user = await prisma.user.upsert({
    where: { walletAddress: demoWallet },
    update: { name: 'CJ' },
    create: {
      name: 'CJ',
      walletAddress: demoWallet,
    },
  });

  await prisma.walletConnection.upsert({
    where: { userId: user.id },
    update: { address: demoWallet, walletId: 'FREIGHTER' },
    create: { userId: user.id, walletId: 'FREIGHTER', address: demoWallet },
  });

  const planDefs = [
    { name: 'House Rent', category: 'rent', amount: 900, unlockDay: 28, planType: 'BILL', icon: '🏠', description: 'Monthly house rent' },
    { name: 'Electricity', category: 'electricity', amount: 80, unlockDay: 28, planType: 'BILL', icon: '⚡', description: 'Power bill' },
    { name: 'Internet', category: 'internet', amount: 60, unlockDay: 25, planType: 'BILL', icon: '📶', description: 'Home internet' },
    { name: 'Water', category: 'water', amount: 35, unlockDay: 27, planType: 'BILL', icon: '💧', description: 'Water & sewage' },
    { name: 'School Fees', category: 'school', amount: 300, unlockDay: 5, planType: 'BILL', icon: '🎓', description: 'Kids school fees' },
    { name: 'Emergency Fund', category: 'emergency', amount: 250, planType: 'EMERGENCY', icon: '🛡', description: 'Break-glass fund' },
    { name: 'Savings', category: 'savings', amount: 400, planType: 'SAVINGS', icon: '🌱', description: 'Long-term savings' },
  ];

  for (const def of planDefs) {
    const existing = await prisma.budgetPlan.findFirst({ where: { userId: user.id, name: def.name } });
    if (!existing) {
      await prisma.budgetPlan.create({ data: { userId: user.id, ...def } });
    }
  }

  await prisma.notification.create({
    data: {
      userId: user.id,
      title: 'Welcome to StellarPlan',
      message: 'Your plans are set up. Send a testnet USDC payment to your wallet to see funds allocated automatically.',
    },
  });

  console.log('Seeded demo user with wallet:', demoWallet);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
