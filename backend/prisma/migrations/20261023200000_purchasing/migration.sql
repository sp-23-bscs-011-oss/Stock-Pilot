-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'PURCHASE_RECEIPT';

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "purchase_receipt_id" UUID;

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "name_key" VARCHAR(120) NOT NULL,
    "contact_name" VARCHAR(100),
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "address" VARCHAR(500),
    "payment_terms" VARCHAR(120),
    "notes" VARCHAR(2000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "supplier_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "expected_at" DATE,
    "note" VARCHAR(1000),
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ordered_at" TIMESTAMPTZ(3),
    "ordered_by_id" UUID,
    "received_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "product_name" VARCHAR(160) NOT NULL,
    "quantity_ordered" INTEGER NOT NULL,
    "quantity_received" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(12,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipts" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "note" VARCHAR(500),
    "received_by_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipt_lines" (
    "id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "purchase_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "actor_id" UUID,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_name_key_key" ON "suppliers"("name_key");

-- CreateIndex
CREATE INDEX "suppliers_is_active_name_idx" ON "suppliers"("is_active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_number_key" ON "purchase_orders"("number");

-- CreateIndex
CREATE INDEX "purchase_orders_status_created_at_idx" ON "purchase_orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_created_at_idx" ON "purchase_orders"("supplier_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_orders_store_id_status_idx" ON "purchase_orders"("store_id", "status");

-- CreateIndex
CREATE INDEX "purchase_order_lines_product_id_idx" ON "purchase_order_lines"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_product_id_key" ON "purchase_order_lines"("purchase_order_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipts_idempotency_key_key" ON "purchase_receipts"("idempotency_key");

-- CreateIndex
CREATE INDEX "purchase_receipts_purchase_order_id_received_at_idx" ON "purchase_receipts"("purchase_order_id", "received_at");

-- CreateIndex
CREATE INDEX "purchase_receipts_received_at_idx" ON "purchase_receipts"("received_at");

-- CreateIndex
CREATE INDEX "purchase_receipt_lines_purchase_order_line_id_idx" ON "purchase_receipt_lines"("purchase_order_line_id");

-- CreateIndex
CREATE INDEX "purchase_receipt_lines_product_id_idx" ON "purchase_receipt_lines"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipt_lines_receipt_id_purchase_order_line_id_key" ON "purchase_receipt_lines"("receipt_id", "purchase_order_line_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "stock_movements_purchase_receipt_id_idx" ON "stock_movements"("purchase_receipt_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_receipt_id_fkey" FOREIGN KEY ("purchase_receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_ordered_by_id_fkey" FOREIGN KEY ("ordered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Hand-written additions (Prisma doesn't model these) ─────────────────────

-- Supplier contact fields stay tidy whatever writes to the table.
ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_name_not_blank_check" CHECK (btrim("name") <> '');

-- Order lines: positive quantities, never more received than ordered, exact line totals.
ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_quantity_ordered_check" CHECK ("quantity_ordered" > 0),
  ADD CONSTRAINT "purchase_order_lines_quantity_received_check" CHECK ("quantity_received" >= 0 AND "quantity_received" <= "quantity_ordered"),
  ADD CONSTRAINT "purchase_order_lines_unit_cost_check" CHECK ("unit_cost" >= 0),
  ADD CONSTRAINT "purchase_order_lines_line_total_check" CHECK ("line_total" = "quantity_ordered" * "unit_cost");

-- Order header: timestamps agree with the status.
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_total_check" CHECK ("total" >= 0),
  ADD CONSTRAINT "purchase_orders_ordered_at_check"
    CHECK ("status" NOT IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED') OR "ordered_at" IS NOT NULL),
  ADD CONSTRAINT "purchase_orders_received_at_check" CHECK (("status" = 'RECEIVED') = ("received_at" IS NOT NULL)),
  ADD CONSTRAINT "purchase_orders_cancelled_at_check" CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL));

ALTER TABLE "purchase_receipt_lines"
  ADD CONSTRAINT "purchase_receipt_lines_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "purchase_receipt_lines_unit_cost_check" CHECK ("unit_cost" >= 0);

-- A purchase-receipt movement always says which receipt it belongs to, and only those do.
-- (Compared as text: PostgreSQL won't let a new enum value be used in the transaction that adds it.)
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_purchase_receipt_check"
    CHECK (("type"::text = 'PURCHASE_RECEIPT') = ("purchase_receipt_id" IS NOT NULL));

-- Receipts and the audit log are permanent history, like the stock ledger.
CREATE FUNCTION "prevent_history_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (id %)', TG_TABLE_NAME, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "purchase_receipts_immutable"
  BEFORE UPDATE OR DELETE ON "purchase_receipts"
  FOR EACH ROW EXECUTE FUNCTION "prevent_history_change"();

CREATE TRIGGER "purchase_receipt_lines_immutable"
  BEFORE UPDATE OR DELETE ON "purchase_receipt_lines"
  FOR EACH ROW EXECUTE FUNCTION "prevent_history_change"();

CREATE TRIGGER "audit_logs_immutable"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "prevent_history_change"();
