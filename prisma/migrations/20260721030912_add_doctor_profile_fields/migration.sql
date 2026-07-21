-- AlterTable
ALTER TABLE "doctor_profile" ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "license_number" TEXT,
ADD COLUMN     "phone_number" TEXT;
