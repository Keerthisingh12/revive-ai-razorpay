/**
 * Database Seed Script
 *
 * Inserts the synthetic dataset into the database.
 * Also creates a default MerchantPolicy for each merchant.
 *
 * Run: npm run db:seed
 */

import { PrismaClient, TransactionStatus } from '@prisma/client';
import { generateSyntheticDataset, summarizeDataset, DEMO_SEED } from './generateDataset';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...\n');

  // Clear existing data (safe for dev/demo)
  console.log('🗑️  Clearing existing data...');
  await prisma.auditLog.deleteMany();
  await prisma.recoveryActionRecord.deleteMany();
  await prisma.agentDecision.deleteMany();
  await prisma.riskAssessment.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.merchantPolicy.deleteMany();
  await prisma.simulationRun.deleteMany();

  // Generate synthetic dataset
  console.log(`📊 Generating ${2000} synthetic transactions (seed: ${DEMO_SEED})...`);
  const dataset = generateSyntheticDataset(DEMO_SEED, 2000);
  const summary = summarizeDataset(dataset);

  console.log('\n📈 Dataset summary:');
  console.log(`   Total:      ${summary.total}`);
  console.log(`   Captured:   ${summary.captured}`);
  console.log(`   Failed:     ${summary.failed} (${summary.failedRate})`);
  console.log(`   At Risk ₹:  ₹${summary.totalAtRiskINR.toLocaleString('en-IN')}`);
  console.log(`   Recoverable: ${summary.recoverable} (${summary.recoverableRate})`);
  console.log(`   Opted Out:  ${summary.optedOut}`);
  console.log('\n   By failure reason:');
  summary.byReason.forEach(({ code, count }) => {
    if (count > 0) console.log(`     ${code}: ${count}`);
  });

  // Batch insert transactions (chunked for performance)
  const CHUNK_SIZE = 100;
  const chunks = [];
  for (let i = 0; i < dataset.length; i += CHUNK_SIZE) {
    chunks.push(dataset.slice(i, i + CHUNK_SIZE));
  }

  console.log(`\n💾 Inserting ${dataset.length} transactions in ${chunks.length} chunks...`);

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    await prisma.$transaction(
      chunk.map((t) =>
        prisma.transaction.create({
          data: {
            id: t.id,
            merchantId: t.merchantId,
            customerId: t.customerId,
            customerEmail: t.customerEmail,
            customerPhone: t.customerPhone,
            amount: t.amount,
            currency: t.currency,
            status: t.status as TransactionStatus,
            failureReason: t.failureReason,
            failureCode: t.failureCode,
            isReturningCustomer: t.isReturningCustomer,
            priorSuccessCount: t.priorSuccessCount,
            priorFailureCount: t.priorFailureCount,
            retryCount: t.retryCount,
            optedOutOfContact: t.optedOutOfContact,
            createdAt: t.createdAt,
          },
        })
      )
    );
    if ((ci + 1) % 5 === 0) {
      process.stdout.write(`   Progress: ${((ci + 1) / chunks.length * 100).toFixed(0)}%\r`);
    }
  }
  console.log('   Progress: 100%  ');

  // Seed merchant policies (one per merchant)
  const merchants = [...new Set(dataset.map((t) => t.merchantId))];
  console.log(`\n🏪 Seeding ${merchants.length} merchant policies...`);
  for (const merchantId of merchants) {
    await prisma.merchantPolicy.upsert({
      where: { merchantId },
      update: {},
      create: {
        merchantId,
        autoActionLimit: 5000,
        humanApprovalLimit: 25000,
        maxRetries: 2,
        confidenceThreshold: 0.80,
        maxContactsPerDay: 2,
      },
    });
  }

  console.log('\n✅ Seed complete!');
  console.log(`   Run "npm run db:studio" to browse the data.`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
