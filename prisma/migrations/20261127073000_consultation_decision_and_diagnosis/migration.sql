-- AlterEnum
ALTER TYPE "VisitTypesEnum" ADD VALUE 'DIRECT_DIAGNOSIS';

-- AlterTable
ALTER TABLE "consultation"
  ADD COLUMN "diagnosis" TEXT,
  ADD COLUMN "suggestions" TEXT,
  ALTER COLUMN "doctor_decision" TYPE "VisitTypesEnum"
  USING (
    CASE
      WHEN "doctor_decision" IS NULL THEN NULL
      ELSE 'CONSULTATION'::"VisitTypesEnum"
    END
  );

-- DropEnum
DROP TYPE "ConsultationModeEnum";
