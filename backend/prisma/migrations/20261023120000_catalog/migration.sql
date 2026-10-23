-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "name_key" VARCHAR(60) NOT NULL,
    "description" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "barcode" VARCHAR(64),
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "cost_price" DECIMAL(12,2) NOT NULL,
    "selling_price" DECIMAL(12,2) NOT NULL,
    "reorder_threshold" INTEGER NOT NULL DEFAULT 0,
    "category_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "archived_by_id" UUID,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key_key" ON "categories"("name_key");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_archived_at_name_idx" ON "products"("archived_at", "name");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_selling_price_idx" ON "products"("selling_price");

-- CreateIndex
CREATE INDEX "products_created_at_idx" ON "products"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "products_active_barcode_key" ON "products"("barcode") WHERE (archived_at IS NULL AND barcode IS NOT NULL);

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Hand-written additions (Prisma doesn't model these) ─────────────────────

-- Money and thresholds can never go negative, whatever writes to the table.
ALTER TABLE "products"
  ADD CONSTRAINT "products_cost_price_check" CHECK ("cost_price" >= 0),
  ADD CONSTRAINT "products_selling_price_check" CHECK ("selling_price" >= 0),
  ADD CONSTRAINT "products_reorder_threshold_check" CHECK ("reorder_threshold" >= 0);

-- Products are archived, never deleted, so historical invoices and purchase records that
-- reference them stay intact. This holds for any client: the API, Prisma Studio, or raw SQL.
CREATE FUNCTION "prevent_product_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Products cannot be deleted; archive them instead (product %)', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "products_prevent_delete"
  BEFORE DELETE ON "products"
  FOR EACH ROW EXECUTE FUNCTION "prevent_product_delete"();
