-- CreateIndex
CREATE INDEX "doctor_document_doctor_id_idx" ON "doctor_document"("doctor_id");

-- CreateIndex
CREATE INDEX "doctor_document_reviewed_by_idx" ON "doctor_document"("reviewed_by");
