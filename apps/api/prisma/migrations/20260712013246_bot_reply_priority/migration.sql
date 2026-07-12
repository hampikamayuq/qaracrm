-- AlterTable
ALTER TABLE "Bot" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BotReply" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "botName" TEXT NOT NULL,
    "ruleIndex" INTEGER NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'reply',
    "conversationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotReply_botId_createdAt_idx" ON "BotReply"("botId", "createdAt");

-- CreateIndex
CREATE INDEX "BotReply_createdAt_idx" ON "BotReply"("createdAt");
