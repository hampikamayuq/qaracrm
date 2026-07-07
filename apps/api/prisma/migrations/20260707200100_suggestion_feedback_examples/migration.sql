-- AlterTable
ALTER TABLE "AiSuggestion" ADD COLUMN     "feedback" TEXT,
ADD COLUMN     "feedbackNote" TEXT,
ADD COLUMN     "feedbackById" TEXT;

-- CreateTable
CREATE TABLE "TawanyExample" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TawanyExample_pkey" PRIMARY KEY ("id")
);
