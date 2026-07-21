-- Integração Kommo: vínculo 1:1 entre o Lead do QARA e o lead do Kommo.
-- Conversas do canal usam Conversation.channel = 'KOMMO' (coluna String já
-- existente) e WebhookEvent.source = 'kommo' — nenhuma outra mudança de schema.

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "kommoLeadId" TEXT;

-- CreateIndex (lookup do ingest de webhook Kommo — hot-path, e unicidade do vínculo)
CREATE UNIQUE INDEX "Lead_kommoLeadId_key" ON "Lead"("kommoLeadId");
