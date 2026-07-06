-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "deliveryStatus" TEXT,
ADD COLUMN     "messageType" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "handoffReason" TEXT;
