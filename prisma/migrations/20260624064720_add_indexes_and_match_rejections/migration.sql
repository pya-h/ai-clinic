-- CreateTable
CREATE TABLE "match_rejection" (
    "id" TEXT NOT NULL,
    "match_request_id" TEXT NOT NULL,
    "doctor_id" INTEGER NOT NULL,
    "rejected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_rejection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_rejection_match_request_id_idx" ON "match_rejection"("match_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_rejection_match_request_id_doctor_id_key" ON "match_rejection"("match_request_id", "doctor_id");

-- CreateIndex
CREATE INDEX "ai_conversation_user_id_idx" ON "ai_conversation"("user_id");

-- CreateIndex
CREATE INDEX "appointment_doctor_id_date_time_idx" ON "appointment"("doctor_id", "date_time");

-- CreateIndex
CREATE INDEX "appointment_patient_id_date_time_idx" ON "appointment"("patient_id", "date_time");

-- CreateIndex
CREATE INDEX "call_consultation_id_idx" ON "call"("consultation_id");

-- CreateIndex
CREATE INDEX "consultation_patient_id_status_idx" ON "consultation"("patient_id", "status");

-- CreateIndex
CREATE INDEX "consultation_doctor_id_status_idx" ON "consultation"("doctor_id", "status");

-- CreateIndex
CREATE INDEX "patient_soap_user_id_idx" ON "patient_soap"("user_id");

-- CreateIndex
CREATE INDEX "payment_user_id_status_idx" ON "payment"("user_id", "status");

-- AddForeignKey
ALTER TABLE "match_rejection" ADD CONSTRAINT "match_rejection_match_request_id_fkey" FOREIGN KEY ("match_request_id") REFERENCES "match_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
