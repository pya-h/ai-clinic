-- CreateEnum
CREATE TYPE "MatchStatusEnum" AS ENUM ('SEARCHING', 'MATCHED', 'ACCEPTED', 'CONSULTATION_CREATED', 'TIMEOUT', 'MANUAL_BROWSE', 'CANCELLED');

-- CreateTable
CREATE TABLE "match_request" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "patient_id" TEXT NOT NULL,
    "soap_id" TEXT,
    "specialty" "DoctorSpecialtiesEnum",
    "triage_level" "TriageLevelEnum",
    "status" "MatchStatusEnum" NOT NULL DEFAULT 'SEARCHING',
    "matched_doctor_id" INTEGER,
    "consultation_id" TEXT,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "match_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "match_request_consultation_id_key" ON "match_request"("consultation_id");

-- CreateIndex
CREATE INDEX "match_request_patient_id_status_idx" ON "match_request"("patient_id", "status");

-- AddForeignKey
ALTER TABLE "match_request" ADD CONSTRAINT "match_request_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_request" ADD CONSTRAINT "match_request_soap_id_fkey" FOREIGN KEY ("soap_id") REFERENCES "patient_soap"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_request" ADD CONSTRAINT "match_request_matched_doctor_id_fkey" FOREIGN KEY ("matched_doctor_id") REFERENCES "doctor_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
