/*
  Warnings:

  - Made the column `started_at` on table `doctor_profile` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "doctor_profile" ADD COLUMN     "secondary_specialties" "DoctorSpecialtiesEnum"[],
ALTER COLUMN "started_at" SET NOT NULL;
