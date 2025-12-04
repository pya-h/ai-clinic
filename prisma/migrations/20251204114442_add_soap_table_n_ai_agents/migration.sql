-- CreateEnum
CREATE TYPE "AiAgentsEnum" AS ENUM ('BOTPRESS', 'OPENAI', 'GEMENI', 'DEEPSEEK', 'KIMI', 'CLAUDE', 'GROK');

-- AlterTable
ALTER TABLE "AiConversations" ADD COLUMN     "agentType" "AiAgentsEnum" NOT NULL DEFAULT 'BOTPRESS';

-- CreateTable
CREATE TABLE "PatientSOAP" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,

    CONSTRAINT "PatientSOAP_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PatientSOAP" ADD CONSTRAINT "PatientSOAP_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientSOAP" ADD CONSTRAINT "PatientSOAP_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "AiConversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
