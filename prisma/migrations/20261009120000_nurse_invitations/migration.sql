-- CreateEnum
CREATE TYPE "NurseAssignmentStatusEnum" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterEnum
ALTER TYPE "NotificationTypeEnum" ADD VALUE 'NURSE_INVITATION';
ALTER TYPE "NotificationTypeEnum" ADD VALUE 'NURSE_INVITATION_ANSWERED';

-- AlterTable
-- Assignments made before invitations existed took effect at once, so they count as accepted.
ALTER TABLE "doctor_nurse_assignment" ADD COLUMN     "responded_at" TIMESTAMP(3),
ADD COLUMN     "status" "NurseAssignmentStatusEnum" NOT NULL DEFAULT 'ACCEPTED',
ALTER COLUMN "is_active" SET DEFAULT false;

ALTER TABLE "doctor_nurse_assignment" ALTER COLUMN "status" SET DEFAULT 'PENDING';
