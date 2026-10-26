-- Extend the existing purchasing tables; no existing records are rewritten or removed.
CREATE TYPE "PurchasePaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER');

CREATE TABLE "purchase_payments" (
  "id" UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "method" "PurchasePaymentMethod" NOT NULL,
  "reference" VARCHAR(160),
  "paid_at" DATE NOT NULL,
  "recorded_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_payments_positive_amount" CHECK ("amount" > 0),
  CONSTRAINT "purchase_payments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "purchase_payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "purchase_payments_idempotency_key_key" ON "purchase_payments"("idempotency_key");
CREATE INDEX "purchase_payments_purchase_order_id_paid_at_idx" ON "purchase_payments"("purchase_order_id", "paid_at");
CREATE INDEX "purchase_payments_recorded_by_id_idx" ON "purchase_payments"("recorded_by_id");
CREATE TRIGGER "purchase_payments_immutable"
  BEFORE UPDATE OR DELETE ON "purchase_payments"
  FOR EACH ROW EXECUTE FUNCTION "prevent_history_change"();
