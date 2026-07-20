-- AlterTable
ALTER TABLE "DubbingLine" ADD COLUMN "lineageId" TEXT;

-- CreateIndex
CREATE INDEX "DubbingLine_lineageId_idx" ON "DubbingLine"("lineageId");
