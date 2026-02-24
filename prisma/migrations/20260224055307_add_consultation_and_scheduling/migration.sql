-- CreateEnum
CREATE TYPE "ConsultationStatusEnum" AS ENUM ('CREATED', 'PENDING_DOCTOR_REVIEW', 'DOCTOR_DECIDED', 'PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConsultationModeEnum" AS ENUM ('ASYNC', 'ONLINE', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "AppointmentStatusEnum" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "chat" ADD COLUMN     "consultation_id" TEXT;

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

-- CreateIndex
CREATE UNIQUE INDEX "appointment_consultation_id_key" ON "appointment"("consultation_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_availability_doctor_id_day_of_week_start_time_key" ON "doctor_availability"("doctor_id", "day_of_week", "start_time");

-- CreateIndex
CREATE UNIQUE INDEX "slot_duration_doctor_id_minutes_key" ON "slot_duration"("doctor_id", "minutes");

-- CreateIndex
CREATE UNIQUE INDEX "availability_exception_doctor_id_date_key" ON "availability_exception"("doctor_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "chat_consultation_id_key" ON "chat"("consultation_id");

-- AddForeignKey
ALTER TABLE "chat" ADD CONSTRAINT "chat_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_soap_id_fkey" FOREIGN KEY ("soap_id") REFERENCES "patient_soap"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_duration" ADD CONSTRAINT "slot_duration_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exception" ADD CONSTRAINT "availability_exception_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

