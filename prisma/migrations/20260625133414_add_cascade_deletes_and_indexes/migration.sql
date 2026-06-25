-- DropForeignKey
ALTER TABLE "ai_conversation" DROP CONSTRAINT "ai_conversation_user_id_fkey";

-- DropForeignKey
ALTER TABLE "appointment" DROP CONSTRAINT "appointment_doctor_id_fkey";

-- DropForeignKey
ALTER TABLE "appointment" DROP CONSTRAINT "appointment_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "availability_exception" DROP CONSTRAINT "availability_exception_doctor_id_fkey";

-- DropForeignKey
ALTER TABLE "call" DROP CONSTRAINT "call_caller_id_fkey";

-- DropForeignKey
ALTER TABLE "call" DROP CONSTRAINT "call_receiver_id_fkey";

-- DropForeignKey
ALTER TABLE "chat_participant" DROP CONSTRAINT "chat_participant_chat_id_fkey";

-- DropForeignKey
ALTER TABLE "chat_participant" DROP CONSTRAINT "chat_participant_user_id_fkey";

-- DropForeignKey
ALTER TABLE "consultation" DROP CONSTRAINT "consultation_doctor_id_fkey";

-- DropForeignKey
ALTER TABLE "consultation" DROP CONSTRAINT "consultation_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "doctor_availability" DROP CONSTRAINT "doctor_availability_doctor_id_fkey";

-- DropForeignKey
ALTER TABLE "doctor_document" DROP CONSTRAINT "doctor_document_doctor_id_fkey";

-- DropForeignKey
ALTER TABLE "doctor_nurse_assignment" DROP CONSTRAINT "doctor_nurse_assignment_doctor_id_fkey";

-- DropForeignKey
ALTER TABLE "doctor_nurse_assignment" DROP CONSTRAINT "doctor_nurse_assignment_nurse_id_fkey";

-- DropForeignKey
ALTER TABLE "doctor_profile" DROP CONSTRAINT "doctor_profile_user_id_fkey";

-- DropForeignKey
ALTER TABLE "doctor_review" DROP CONSTRAINT "doctor_review_doctor_id_fkey";

-- DropForeignKey
ALTER TABLE "doctor_review" DROP CONSTRAINT "doctor_review_reviewer_id_fkey";

-- DropForeignKey
ALTER TABLE "match_request" DROP CONSTRAINT "match_request_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "message" DROP CONSTRAINT "message_chat_id_fkey";

-- DropForeignKey
ALTER TABLE "message" DROP CONSTRAINT "message_sender_id_fkey";

-- DropForeignKey
ALTER TABLE "notification" DROP CONSTRAINT "notification_user_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_profile" DROP CONSTRAINT "patient_profile_user_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_soap" DROP CONSTRAINT "patient_soap_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_soap" DROP CONSTRAINT "patient_soap_user_id_fkey";

-- DropForeignKey
ALTER TABLE "payment" DROP CONSTRAINT "payment_user_id_fkey";

-- DropForeignKey
ALTER TABLE "push_subscription" DROP CONSTRAINT "push_subscription_user_id_fkey";

-- DropForeignKey
ALTER TABLE "slot_duration" DROP CONSTRAINT "slot_duration_doctor_id_fkey";

-- DropForeignKey
ALTER TABLE "subscription" DROP CONSTRAINT "subscription_user_id_fkey";

-- CreateIndex
CREATE INDEX "ai_conversation_created_at_idx" ON "ai_conversation"("created_at");

-- CreateIndex
CREATE INDEX "appointment_status_idx" ON "appointment"("status");

-- CreateIndex
CREATE INDEX "call_caller_id_idx" ON "call"("caller_id");

-- CreateIndex
CREATE INDEX "call_receiver_id_idx" ON "call"("receiver_id");

-- CreateIndex
CREATE INDEX "consultation_status_idx" ON "consultation"("status");

-- CreateIndex
CREATE INDEX "match_request_specialty_triage_level_idx" ON "match_request"("specialty", "triage_level");

-- CreateIndex
CREATE INDEX "message_sender_id_idx" ON "message"("sender_id");

-- CreateIndex
CREATE INDEX "payment_status_idx" ON "payment"("status");

-- CreateIndex
CREATE INDEX "user_user_role_idx" ON "user"("user_role");

-- CreateIndex
CREATE INDEX "user_is_active_idx" ON "user"("is_active");

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participant" ADD CONSTRAINT "chat_participant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participant" ADD CONSTRAINT "chat_participant_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation" ADD CONSTRAINT "ai_conversation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_soap" ADD CONSTRAINT "patient_soap_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_soap" ADD CONSTRAINT "patient_soap_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_profile" ADD CONSTRAINT "doctor_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_review" ADD CONSTRAINT "doctor_review_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_review" ADD CONSTRAINT "doctor_review_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_profile" ADD CONSTRAINT "patient_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_duration" ADD CONSTRAINT "slot_duration_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exception" ADD CONSTRAINT "availability_exception_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_document" ADD CONSTRAINT "doctor_document_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_nurse_assignment" ADD CONSTRAINT "doctor_nurse_assignment_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_nurse_assignment" ADD CONSTRAINT "doctor_nurse_assignment_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_request" ADD CONSTRAINT "match_request_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call" ADD CONSTRAINT "call_caller_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call" ADD CONSTRAINT "call_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
