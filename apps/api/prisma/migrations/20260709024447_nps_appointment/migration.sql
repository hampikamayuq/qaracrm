-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "npsRespondedAt" TIMESTAMP(3),
ADD COLUMN     "npsScore" INTEGER,
ADD COLUMN     "npsSentAt" TIMESTAMP(3);
