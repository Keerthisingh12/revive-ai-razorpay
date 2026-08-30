-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'FAILED', 'CAPTURED', 'REFUNDED', 'AT_RISK');

-- CreateEnum
CREATE TYPE "RecoveryAction" AS ENUM ('RETRY', 'PAYMENT_LINK', 'REMINDER', 'SCHEDULE_RETRY', 'ESCALATE', 'STOP');

-- CreateEnum
CREATE TYPE "GuardrailDecision" AS ENUM ('APPROVED', 'DOWNGRADED', 'ESCALATED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "RecoveryOutcome" AS ENUM ('RECOVERED', 'FAILED', 'PENDING', 'ESCALATED', 'STOPPED');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('RISK_DETECTED', 'AI_DIAGNOSIS', 'AI_RECOMMENDATION', 'GUARDRAIL_CHECK', 'ACTION_EXECUTED', 'OUTCOME_RECORDED', 'HUMAN_APPROVED', 'HUMAN_REJECTED', 'HUMAN_STOPPED');

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "merchantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "failureCode" TEXT,
    "isReturningCustomer" BOOLEAN NOT NULL DEFAULT false,
    "priorSuccessCount" INTEGER NOT NULL DEFAULT 0,
    "priorFailureCount" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "optedOutOfContact" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "amountAtRisk" DOUBLE PRECISION NOT NULL,
    "riskFactors" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "recommendedAction" "RecoveryAction" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "expectedRecoveryAmount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "aiRaw" JSONB,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "guardrailDecision" "GuardrailDecision" NOT NULL,
    "guardrailReason" TEXT NOT NULL,
    "guardrailChecks" JSONB NOT NULL,
    "finalAction" "RecoveryAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryActionRecord" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "action" "RecoveryAction" NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "RecoveryOutcome" NOT NULL DEFAULT 'PENDING',
    "amountRecovered" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outcomeReason" TEXT,
    "simulationRunId" TEXT,

    CONSTRAINT "RecoveryActionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "eventType" "AuditEventType" NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationRun" (
    "id" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "totalTransactions" INTEGER NOT NULL,
    "atRiskCount" INTEGER NOT NULL,
    "atRiskAmount" DOUBLE PRECISION NOT NULL,
    "opportunityCount" INTEGER NOT NULL,
    "approvedCount" INTEGER NOT NULL,
    "executedCount" INTEGER NOT NULL,
    "escalatedCount" INTEGER NOT NULL,
    "stoppedCount" INTEGER NOT NULL,
    "recoveredCount" INTEGER NOT NULL,
    "recoveredAmount" DOUBLE PRECISION NOT NULL,
    "recoveryRate" DOUBLE PRECISION NOT NULL,
    "funnelData" JSONB NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantPolicy" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "autoActionLimit" DOUBLE PRECISION NOT NULL DEFAULT 5000,
    "humanApprovalLimit" DOUBLE PRECISION NOT NULL DEFAULT 25000,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.80,
    "maxContactsPerDay" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_razorpayPaymentId_key" ON "Transaction"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "Transaction_merchantId_idx" ON "Transaction"("merchantId");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiskAssessment_transactionId_key" ON "RiskAssessment"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDecision_transactionId_key" ON "AgentDecision"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryActionRecord_transactionId_key" ON "RecoveryActionRecord"("transactionId");

-- CreateIndex
CREATE INDEX "RecoveryActionRecord_simulationRunId_idx" ON "RecoveryActionRecord"("simulationRunId");

-- CreateIndex
CREATE INDEX "AuditLog_transactionId_idx" ON "AuditLog"("transactionId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantPolicy_merchantId_key" ON "MerchantPolicy"("merchantId");

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryActionRecord" ADD CONSTRAINT "RecoveryActionRecord_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryActionRecord" ADD CONSTRAINT "RecoveryActionRecord_simulationRunId_fkey" FOREIGN KEY ("simulationRunId") REFERENCES "SimulationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

