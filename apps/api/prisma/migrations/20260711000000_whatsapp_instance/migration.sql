-- Coexistência de múltiplos números: instâncias de WhatsApp conectadas por QR
-- via gateway Evolution API. O número oficial (Meta Cloud API) NÃO vira
-- instância — conversas dele seguem com instanceId NULL.

-- CreateTable
CREATE TABLE "WhatsAppInstance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'EVOLUTION',
    "instanceName" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "lastConnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppInstance_instanceName_key" ON "WhatsAppInstance"("instanceName");

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "instanceId" TEXT;

-- AddForeignKey (SET NULL preserva conversas/mensagens quando a instância é removida)
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsAppInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex (lookup do ingest: conversa por canal + contato + instância)
CREATE INDEX "Conversation_channel_externalId_instanceId_idx" ON "Conversation"("channel", "externalId", "instanceId");
