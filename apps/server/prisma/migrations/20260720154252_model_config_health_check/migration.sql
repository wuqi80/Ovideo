-- AlterTable
ALTER TABLE "ModelConfig" ADD COLUMN "healthCheckedAt" DATETIME;
ALTER TABLE "ModelConfig" ADD COLUMN "healthDetail" TEXT;
ALTER TABLE "ModelConfig" ADD COLUMN "healthStatus" TEXT;
