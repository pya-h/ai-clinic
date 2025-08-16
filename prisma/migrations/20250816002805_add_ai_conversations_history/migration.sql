-- CreateTable
CREATE TABLE "AiConversations" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "topic" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConversations_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AiConversations" ADD CONSTRAINT "AiConversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
