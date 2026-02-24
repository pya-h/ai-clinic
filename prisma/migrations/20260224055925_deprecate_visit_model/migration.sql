-- DropForeignKey
ALTER TABLE "visit" DROP CONSTRAINT "visit_doctor_id_fkey";

-- DropForeignKey
ALTER TABLE "visit" DROP CONSTRAINT "visit_patient_id_fkey";

-- DropTable
DROP TABLE "visit";

-- DropEnum
DROP TYPE "VisitStatusEnum";

