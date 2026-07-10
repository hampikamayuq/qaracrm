-- CreateIndex
CREATE INDEX "Activity_targetType_type_createdAt_idx" ON "Activity"("targetType", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Appointment_npsSentAt_idx" ON "Appointment"("npsSentAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sentAt_idx" ON "ChatMessage"("sentAt");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_paidAt_idx" ON "Payment"("status", "paidAt");
