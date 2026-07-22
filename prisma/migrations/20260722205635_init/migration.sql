-- CreateEnum
CREATE TYPE "UserRolesEnum" AS ENUM ('NONE', 'DOCTOR', 'NURSE', 'PATIENT');

-- CreateEnum
CREATE TYPE "MessageTypeEnum" AS ENUM ('TEXT', 'IMAGE', 'FILE', 'AUDIO', 'VIDEO', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TriageLevelEnum" AS ENUM ('SELF_CARE', 'SEE_DOCTOR', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "ConsultationStatusEnum" AS ENUM ('CREATED', 'PENDING_DOCTOR_REVIEW', 'DOCTOR_DECIDED', 'PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConsultationModeEnum" AS ENUM ('ASYNC', 'ONLINE', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "AppointmentStatusEnum" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "DocumentTypeEnum" AS ENUM ('LICENSE', 'ID_CARD', 'CERTIFICATION', 'PHOTO', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatusEnum" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NursePermissionEnum" AS ENUM ('VIEW_PATIENTS', 'VIEW_SOAPS', 'CHAT_WITH_PATIENTS', 'MANAGE_SCHEDULE', 'MANAGE_APPOINTMENTS', 'VIEW_CONSULTATION_NOTES');

-- CreateEnum
CREATE TYPE "CallTypeEnum" AS ENUM ('VOICE', 'VIDEO');

-- CreateEnum
CREATE TYPE "CallStatusEnum" AS ENUM ('RINGING', 'ACTIVE', 'ENDED', 'MISSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentStatusEnum" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "SubscriptionPlanEnum" AS ENUM ('FREE', 'BASIC', 'PREMIUM');

-- CreateEnum
CREATE TYPE "SubscriptionStatusEnum" AS ENUM ('ACTIVE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MatchStatusEnum" AS ENUM ('SEARCHING', 'MATCHED', 'ACCEPTED', 'CONSULTATION_CREATED', 'TIMEOUT', 'MANUAL_BROWSE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationTypeEnum" AS ENUM ('CONSULTATION_REQUEST', 'DOCTOR_DECISION', 'PAYMENT_CONFIRMED', 'APPOINTMENT_REMINDER', 'APPOINTMENT_CANCELLED', 'NEW_CHAT_MESSAGE', 'NEW_REVIEW', 'DOCTOR_VERIFIED', 'SOAP_READY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationChannelEnum" AS ENUM ('EMAIL', 'PUSH', 'BOTH');

-- CreateEnum
CREATE TYPE "AiAgentsEnum" AS ENUM ('BOTPRESS', 'OPENAI', 'GEMINI', 'DEEPSEEK', 'KIMI', 'CLAUDE', 'GROK');

-- CreateEnum
CREATE TYPE "VisitMethodsEnum" AS ENUM ('CHAT', 'VOICE_CALL', 'VIDEO_CALL', 'ON_SITE');

-- CreateEnum
CREATE TYPE "VisitTypesEnum" AS ENUM ('CONSULTATION', 'EXAMINATION', 'SURGERY', 'LABORATORY', 'RADIOLOGY', 'PHARMACY', 'DENTISTRY', 'THERAPY', 'NUTRITION', 'OTHER');

-- CreateEnum
CREATE TYPE "DoctorSpecialtiesEnum" AS ENUM ('CARDIOLOGY', 'DERMATOLOGY', 'ENT', 'GASTROENTEROLOGY', 'GYNECOLOGY', 'NEUROLOGY', 'ONCOLOGY', 'ORTHOPEDICS', 'PEDIATRICS', 'PSYCHIATRY', 'UROLOGY', 'GENERAL', 'OTHER');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "firstname" TEXT NOT NULL,
    "lastname" TEXT NOT NULL,
    "user_role" "UserRolesEnum" NOT NULL,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_banned" BOOLEAN NOT NULL DEFAULT false,
    "ban_reason" TEXT,
    "banned_at" TIMESTAMP(3),
    "banned_by" TEXT,
    "avatar" TEXT,
    "password" TEXT NOT NULL,
    "botpress_user_key" TEXT,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "topic" TEXT,
    "consultation_id" TEXT,

    CONSTRAINT "chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "chat_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "MessageTypeEnum" NOT NULL DEFAULT 'TEXT',
    "file_url" TEXT,
    "replied_to_id" BIGINT,
    "read_by" JSONB,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_participant" (
    "user_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "chat_participant_pkey" PRIMARY KEY ("chat_id","user_id")
);

-- CreateTable
CREATE TABLE "ai_conversation" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "topic" TEXT,
    "agentType" "AiAgentsEnum" NOT NULL DEFAULT 'BOTPRESS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_soap" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "subjective" TEXT,
    "objective" TEXT,
    "assessment" TEXT,
    "plan" TEXT,
    "raw_note" TEXT NOT NULL,
    "suggested_specialty" "DoctorSpecialtiesEnum",
    "triage_level" "TriageLevelEnum",
    "confidence_scores" JSONB,

    CONSTRAINT "patient_soap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_profile" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "specialty" "DoctorSpecialtiesEnum" NOT NULL DEFAULT 'GENERAL',
    "secondary_specialties" "DoctorSpecialtiesEnum"[],
    "university" TEXT,
    "location" TEXT,
    "clinic_location" TEXT,
    "bio" TEXT,
    "phone_number" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "license_number" TEXT,
    "visit_methods" "VisitMethodsEnum"[],
    "visit_types" "VisitTypesEnum"[],
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "rejection_reason" TEXT,
    "platform_summary" TEXT,

    CONSTRAINT "doctor_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_review" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "doctor_id" INTEGER NOT NULL,
    "title" TEXT,
    "overview" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "rating" INTEGER NOT NULL,

    CONSTRAINT "doctor_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_profile" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,
    "location" TEXT,
    "visit_methods" "VisitMethodsEnum"[],
    "bio" TEXT,
    "medical_history" TEXT[],
    "allergies" TEXT[],
    "medications" TEXT[],
    "surgeries" TEXT[],
    "family_history" TEXT[],

    CONSTRAINT "patient_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "patient_id" TEXT NOT NULL,
    "doctor_id" INTEGER NOT NULL,
    "soap_id" TEXT,
    "status" "ConsultationStatusEnum" NOT NULL DEFAULT 'CREATED',
    "doctor_decision" "ConsultationModeEnum",
    "visit_method" "VisitMethodsEnum",
    "notes" TEXT,
    "summary" TEXT,
    "follow_up_needed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "consultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "patient_id" TEXT NOT NULL,
    "doctor_id" INTEGER NOT NULL,
    "consultation_id" TEXT,
    "date_time" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "method" "VisitMethodsEnum" NOT NULL,
    "status" "AppointmentStatusEnum" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "calendly_event_uri" TEXT,
    "calendly_invitee_uri" TEXT,
    "calendly_reschedule_url" TEXT,
    "calendly_cancel_url" TEXT,

    CONSTRAINT "appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_availability" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "doctor_id" INTEGER NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "doctor_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_duration" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "doctor_id" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "label" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "slot_duration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_exception" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doctor_id" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "is_blocked" BOOLEAN NOT NULL DEFAULT true,
    "start_time" TEXT,
    "end_time" TEXT,
    "reason" TEXT,

    CONSTRAINT "availability_exception_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "match_rejection" (
    "id" TEXT NOT NULL,
    "match_request_id" TEXT NOT NULL,
    "doctor_id" INTEGER NOT NULL,
    "rejected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_rejection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chat_id" TEXT,
    "consultation_id" TEXT,
    "caller_id" TEXT NOT NULL,
    "receiver_id" TEXT NOT NULL,
    "type" "CallTypeEnum" NOT NULL,
    "status" "CallStatusEnum" NOT NULL DEFAULT 'RINGING',
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "duration" INTEGER,
    "recording_url" TEXT,

    CONSTRAINT "call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,
    "consultation_id" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PaymentStatusEnum" NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "gateway_id" TEXT,
    "gateway_response" JSONB,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan" "SubscriptionPlanEnum" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatusEnum" NOT NULL DEFAULT 'ACTIVE',
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "features" JSONB,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT NOT NULL,
    "type" "NotificationTypeEnum" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "channel" "NotificationChannelEnum" NOT NULL DEFAULT 'PUSH',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscription" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_user_role_idx" ON "user"("user_role");

-- CreateIndex
CREATE INDEX "user_is_active_idx" ON "user"("is_active");

-- CreateIndex
CREATE INDEX "user_is_banned_idx" ON "user"("is_banned");

-- CreateIndex
CREATE UNIQUE INDEX "chat_consultation_id_key" ON "chat"("consultation_id");

-- CreateIndex
CREATE INDEX "message_chat_id_created_at_idx" ON "message"("chat_id", "created_at");

-- CreateIndex
CREATE INDEX "message_sender_id_idx" ON "message"("sender_id");

-- CreateIndex
CREATE INDEX "ai_conversation_user_id_idx" ON "ai_conversation"("user_id");

-- CreateIndex
CREATE INDEX "ai_conversation_created_at_idx" ON "ai_conversation"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "patient_soap_conversation_id_key" ON "patient_soap"("conversation_id");

-- CreateIndex
CREATE INDEX "patient_soap_user_id_idx" ON "patient_soap"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_profile_user_id_key" ON "doctor_profile"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_review_reviewer_id_doctor_id_key" ON "doctor_review"("reviewer_id", "doctor_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_profile_user_id_key" ON "patient_profile"("user_id");

-- CreateIndex
CREATE INDEX "consultation_patient_id_status_idx" ON "consultation"("patient_id", "status");

-- CreateIndex
CREATE INDEX "consultation_doctor_id_status_idx" ON "consultation"("doctor_id", "status");

-- CreateIndex
CREATE INDEX "consultation_status_idx" ON "consultation"("status");

-- CreateIndex
CREATE INDEX "consultation_soap_id_idx" ON "consultation"("soap_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_consultation_id_key" ON "appointment"("consultation_id");

-- CreateIndex
CREATE INDEX "appointment_doctor_id_date_time_idx" ON "appointment"("doctor_id", "date_time");

-- CreateIndex
CREATE INDEX "appointment_patient_id_date_time_idx" ON "appointment"("patient_id", "date_time");

-- CreateIndex
CREATE INDEX "appointment_status_idx" ON "appointment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_availability_doctor_id_day_of_week_start_time_key" ON "doctor_availability"("doctor_id", "day_of_week", "start_time");

-- CreateIndex
CREATE UNIQUE INDEX "slot_duration_doctor_id_minutes_key" ON "slot_duration"("doctor_id", "minutes");

-- CreateIndex
CREATE UNIQUE INDEX "availability_exception_doctor_id_date_key" ON "availability_exception"("doctor_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_nurse_assignment_doctor_id_nurse_id_key" ON "doctor_nurse_assignment"("doctor_id", "nurse_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_request_consultation_id_key" ON "match_request"("consultation_id");

-- CreateIndex
CREATE INDEX "match_request_patient_id_status_idx" ON "match_request"("patient_id", "status");

-- CreateIndex
CREATE INDEX "match_request_specialty_triage_level_idx" ON "match_request"("specialty", "triage_level");

-- CreateIndex
CREATE INDEX "match_rejection_match_request_id_idx" ON "match_rejection"("match_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_rejection_match_request_id_doctor_id_key" ON "match_rejection"("match_request_id", "doctor_id");

-- CreateIndex
CREATE INDEX "call_chat_id_idx" ON "call"("chat_id");

-- CreateIndex
CREATE INDEX "call_consultation_id_idx" ON "call"("consultation_id");

-- CreateIndex
CREATE INDEX "call_caller_id_idx" ON "call"("caller_id");

-- CreateIndex
CREATE INDEX "call_receiver_id_idx" ON "call"("receiver_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_consultation_id_key" ON "payment"("consultation_id");

-- CreateIndex
CREATE INDEX "payment_user_id_status_idx" ON "payment"("user_id", "status");

-- CreateIndex
CREATE INDEX "payment_status_idx" ON "payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_user_id_key" ON "subscription"("user_id");

-- CreateIndex
CREATE INDEX "notification_user_id_is_read_idx" ON "notification"("user_id", "is_read");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_user_id_endpoint_key" ON "push_subscription"("user_id", "endpoint");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_banned_by_fkey" FOREIGN KEY ("banned_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat" ADD CONSTRAINT "chat_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_replied_to_id_fkey" FOREIGN KEY ("replied_to_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "doctor_profile" ADD CONSTRAINT "doctor_profile_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_soap_id_fkey" FOREIGN KEY ("soap_id") REFERENCES "patient_soap"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_duration" ADD CONSTRAINT "slot_duration_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exception" ADD CONSTRAINT "availability_exception_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_document" ADD CONSTRAINT "doctor_document_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_document" ADD CONSTRAINT "doctor_document_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_nurse_assignment" ADD CONSTRAINT "doctor_nurse_assignment_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_nurse_assignment" ADD CONSTRAINT "doctor_nurse_assignment_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_request" ADD CONSTRAINT "match_request_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_request" ADD CONSTRAINT "match_request_soap_id_fkey" FOREIGN KEY ("soap_id") REFERENCES "patient_soap"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_request" ADD CONSTRAINT "match_request_matched_doctor_id_fkey" FOREIGN KEY ("matched_doctor_id") REFERENCES "doctor_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_rejection" ADD CONSTRAINT "match_rejection_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_rejection" ADD CONSTRAINT "match_rejection_match_request_id_fkey" FOREIGN KEY ("match_request_id") REFERENCES "match_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call" ADD CONSTRAINT "call_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call" ADD CONSTRAINT "call_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call" ADD CONSTRAINT "call_caller_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call" ADD CONSTRAINT "call_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
