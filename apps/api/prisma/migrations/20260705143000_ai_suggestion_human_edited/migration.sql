ALTER TABLE "AiSuggestion" ADD COLUMN "humanEdited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiSuggestion" ADD COLUMN "originalBody" TEXT;
ALTER TABLE "AiSuggestion" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "AiSuggestion_humanEdited_idx" ON "AiSuggestion"("humanEdited");
