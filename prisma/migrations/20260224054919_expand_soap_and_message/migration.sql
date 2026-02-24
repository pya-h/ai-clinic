-- CreateEnum
CREATE TYPE "MessageTypeEnum" AS ENUM ('TEXT', 'IMAGE', 'FILE', 'AUDIO', 'VIDEO', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TriageLevelEnum" AS ENUM ('SELF_CARE', 'SEE_DOCTOR', 'URGENT', 'EMERGENCY');

-- AlterTable
ALTER TABLE "chat_participant" ADD COLUMN     "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "last_seen_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "message" ADD COLUMN     "content" TEXT NOT NULL,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "edited_at" TIMESTAMP(3),
ADD COLUMN     "file_url" TEXT,
ADD COLUMN     "read_by" JSONB,
ADD COLUMN     "sender_id" TEXT NOT NULL,
ADD COLUMN     "type" "MessageTypeEnum" NOT NULL DEFAULT 'TEXT';

-- AlterTable
ALTER TABLE "patient_soap" DROP COLUMN "note",
ADD COLUMN     "assessment" TEXT,
ADD COLUMN     "confidence_scores" JSONB,
ADD COLUMN     "objective" TEXT,
ADD COLUMN     "plan" TEXT,
ADD COLUMN     "raw_note" TEXT NOT NULL,
ADD COLUMN     "subjective" TEXT,
ADD COLUMN     "suggested_specialty" "DoctorSpecialtiesEnum",
ADD COLUMN     "triage_level" "TriageLevelEnum";

-- CreateIndex
CREATE INDEX "message_chat_id_created_at_idx" ON "message"("chat_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "patient_soap_conversation_id_key" ON "patient_soap"("conversation_id");

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

