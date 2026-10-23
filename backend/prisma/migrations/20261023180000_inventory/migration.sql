-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM ('STOCK_COUNT', 'RECEIVED', 'CUSTOMER_RETURN', 'DAMAGED', 'EXPIRED', 'LOST', 'THEFT', 'RETURNED_TO_SUPPLIER', 'OTHER');

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_levels" (
    "product_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("product_id","store_id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity_change" INTEGER NOT NULL,
    "quantity_before" INTEGER NOT NULL,
    "quantity_after" INTEGER NOT NULL,
    "reason" "AdjustmentReason",
    "note" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stores_code_key" ON "stores"("code");

-- CreateIndex
CREATE INDEX "inventory_levels_store_id_quantity_idx" ON "inventory_levels"("store_id", "quantity");

-- CreateIndex
CREATE INDEX "stock_movements_store_id_created_at_idx" ON "stock_movements"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_store_id_created_at_idx" ON "stock_movements"("product_id", "store_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_created_by_id_idx" ON "stock_movements"("created_by_id");

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Hand-written additions (Prisma doesn't model these) ─────────────────────

-- Every installation starts with one store so inventory works immediately.
INSERT INTO "stores" ("id", "name", "code", "is_active", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'Main Store', 'MAIN', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Last line of defence against negative stock, whatever writes to the table.
ALTER TABLE "inventory_levels"
  ADD CONSTRAINT "inventory_levels_quantity_check" CHECK ("quantity" >= 0);

-- Ledger rows must be internally consistent.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_change_nonzero_check" CHECK ("quantity_change" <> 0),
  ADD CONSTRAINT "stock_movements_arithmetic_check" CHECK ("quantity_after" = "quantity_before" + "quantity_change"),
  ADD CONSTRAINT "stock_movements_non_negative_check" CHECK ("quantity_before" >= 0 AND "quantity_after" >= 0),
  ADD CONSTRAINT "stock_movements_adjustment_reason_check" CHECK ("type" <> 'ADJUSTMENT' OR "reason" IS NOT NULL);

-- The movement ledger is append-only: corrections are new movements, never edits.
CREATE FUNCTION "prevent_stock_movement_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Stock movements are immutable; record a correcting adjustment instead (movement %)', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "stock_movements_immutable"
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "prevent_stock_movement_change"();
