-- CreateEnum
CREATE TYPE "UserRolesEnum" AS ENUM ('NONE', 'DOCTOR', 'NURSE', 'ASSISTANT', 'PATIENT', 'STAFF');

-- CreateEnum
CREATE TYPE "AiAgentsEnum" AS ENUM ('BOTPRESS', 'OPENAI', 'GEMENI', 'DEEPSEEK', 'KIMI', 'CLAUDE', 'GROK');

-- CreateEnum
CREATE TYPE "VisitMethodsEnum" AS ENUM ('CHAT', 'VOICE_CALL', 'VIDEO_CALL', 'ON_SITE');

-- CreateEnum
CREATE TYPE "VisitStatusEnum" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

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
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "avatar" TEXT,
    "password" TEXT NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "topic" TEXT,

    CONSTRAINT "chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "chat_id" TEXT NOT NULL,
    "replied_to_id" BIGINT,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_participant" (
    "user_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,

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
    "note" TEXT NOT NULL,

    CONSTRAINT "patient_soap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_profile" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "specialty" "DoctorSpecialtiesEnum" NOT NULL DEFAULT 'GENERAL',
    "university" TEXT,
    "location" TEXT,
    "clinic_location" TEXT,
    "bio" TEXT,
    "visit_methods" "VisitMethodsEnum"[],
    "visit_types" "VisitTypesEnum"[],
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "platform_summuary" TEXT,

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
CREATE TABLE "visit" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "patient_id" TEXT NOT NULL,
    "doctor_id" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "start_time" INTEGER NOT NULL,
    "end_time" INTEGER,
    "method" "VisitMethodsEnum" NOT NULL,
    "type" "VisitTypesEnum" NOT NULL,
    "status" "VisitStatusEnum" NOT NULL,
    "notes" TEXT[],
    "attachments" TEXT[],
    "scheduled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "visit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_profile_user_id_key" ON "doctor_profile"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_profile_user_id_key" ON "patient_profile"("user_id");

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_replied_to_id_fkey" FOREIGN KEY ("replied_to_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participant" ADD CONSTRAINT "chat_participant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participant" ADD CONSTRAINT "chat_participant_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation" ADD CONSTRAINT "ai_conversation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_soap" ADD CONSTRAINT "patient_soap_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_soap" ADD CONSTRAINT "patient_soap_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_profile" ADD CONSTRAINT "doctor_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_review" ADD CONSTRAINT "doctor_review_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_review" ADD CONSTRAINT "doctor_review_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_profile" ADD CONSTRAINT "patient_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
