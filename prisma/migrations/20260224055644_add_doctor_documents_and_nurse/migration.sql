-- CreateEnum
CREATE TYPE "DocumentTypeEnum" AS ENUM ('LICENSE', 'ID_CARD', 'CERTIFICATION', 'PHOTO', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatusEnum" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NursePermissionEnum" AS ENUM ('VIEW_PATIENTS', 'VIEW_SOAPS', 'CHAT_WITH_PATIENTS', 'MANAGE_SCHEDULE', 'MANAGE_APPOINTMENTS', 'VIEW_CONSULTATION_NOTES');

-- AlterTable
ALTER TABLE "doctor_profile" ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "verified_at" TIMESTAMP(3),
ADD COLUMN     "verified_by" TEXT;

-- CreateTable
CREATE TABLE "doctor_document" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "doctor_id" INTEGER NOT NULL,
    "type" "DocumentTypeEnum" NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "status" "DocumentStatusEnum" NOT NULL DEFAULT 'PENDING',
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "reject_reason" TEXT,

    CONSTRAINT "doctor_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_nurse_assignment" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "doctor_id" INTEGER NOT NULL,
    "nurse_id" TEXT NOT NULL,
    "permissions" "NursePermissionEnum"[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "doctor_nurse_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "doctor_nurse_assignment_doctor_id_nurse_id_key" ON "doctor_nurse_assignment"("doctor_id", "nurse_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_review_reviewer_id_doctor_id_key" ON "doctor_review"("reviewer_id", "doctor_id");

-- AddForeignKey
ALTER TABLE "doctor_document" ADD CONSTRAINT "doctor_document_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_nurse_assignment" ADD CONSTRAINT "doctor_nurse_assignment_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_nurse_assignment" ADD CONSTRAINT "doctor_nurse_assignment_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

