-- AlterTable
ALTER TABLE "user" ADD COLUMN     "ban_reason" TEXT,
ADD COLUMN     "banned_at" TIMESTAMP(3),
ADD COLUMN     "banned_by" TEXT,
ADD COLUMN     "is_banned" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "user_is_banned_idx" ON "user"("is_banned");
