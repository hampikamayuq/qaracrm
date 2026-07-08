ALTER TABLE "AiRunLog"
ADD COLUMN "promptTokens" INTEGER,
ADD COLUMN "completionTokens" INTEGER,
ADD COLUMN "totalTokens" INTEGER,
ADD COLUMN "estimatedCostCents" INTEGER;
