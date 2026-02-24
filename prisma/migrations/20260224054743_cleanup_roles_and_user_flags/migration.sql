-- AlterEnum
BEGIN;
CREATE TYPE "AiAgentsEnum_new" AS ENUM ('BOTPRESS', 'OPENAI', 'GEMINI', 'DEEPSEEK', 'KIMI', 'CLAUDE', 'GROK');
ALTER TABLE "ai_conversation" ALTER COLUMN "agentType" DROP DEFAULT;
ALTER TABLE "ai_conversation" ALTER COLUMN "agentType" TYPE "AiAgentsEnum_new" USING ("agentType"::text::"AiAgentsEnum_new");
ALTER TYPE "AiAgentsEnum" RENAME TO "AiAgentsEnum_old";
ALTER TYPE "AiAgentsEnum_new" RENAME TO "AiAgentsEnum";
DROP TYPE "AiAgentsEnum_old";
ALTER TABLE "ai_conversation" ALTER COLUMN "agentType" SET DEFAULT 'BOTPRESS';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "UserRolesEnum_new" AS ENUM ('NONE', 'DOCTOR', 'NURSE', 'PATIENT');
ALTER TABLE "user" ALTER COLUMN "user_role" TYPE "UserRolesEnum_new" USING ("user_role"::text::"UserRolesEnum_new");
ALTER TYPE "UserRolesEnum" RENAME TO "UserRolesEnum_old";
ALTER TYPE "UserRolesEnum_new" RENAME TO "UserRolesEnum";
DROP TYPE "UserRolesEnum_old";
COMMIT;

-- AlterTable
ALTER TABLE "doctor_profile" DROP COLUMN "platform_summuary",
ADD COLUMN     "platform_summary" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "is_super_admin" BOOLEAN NOT NULL DEFAULT false;

