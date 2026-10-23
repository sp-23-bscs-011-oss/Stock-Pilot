import { prisma } from "../lib/prisma.js";
import { isForeignKeyViolation, isUniqueViolation, uniqueViolationMentions } from "../lib/prismaErrors.js";
import { AppError } from "../utils/AppError.js";
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from "../validators/catalog.schemas.js";
import type { Category, Prisma, Product, Role } from "../generated/prisma/client.js";

/** Cost prices and margins are management information; cashiers never receive them. */
export function canViewCost(role: Role): boolean {
  return role === "OWNER" || role === "MANAGER";
}

type ProductWithCategory = Product & { category: Pick<Category, "id" | "name"> | null };

function toProductDto(product: ProductWithCategory, viewerRole: Role) {
  return {
    id: product.id,
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    description: product.description,
    // Money is serialized as a fixed 2-decimal string so it never passes through a float.
    sellingPrice: product.sellingPrice.toFixed(2),
    ...(canViewCost(viewerRole) ? { costPrice: product.costPrice.toFixed(2) } : {}),
    reorderThreshold: product.reorderThreshold,
    category: product.category ? { id: product.category.id, name: product.category.name } : null,
    isArchived: product.archivedAt !== null,
    archivedAt: product.archivedAt,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export type ProductDto = ReturnType<typeof toProductDto>;

const includeCategory = { category: { select: { id: true, name: true } } } as const;

// ─── Uniqueness ──────────────────────────────────────────────────────────────

interface FieldIssue {
  path: string[];
  message: string;
}

function duplicateError(issues: FieldIssue[]) {
  return new AppError(409, "DUPLICATE_VALUE", issues.map((issue) => issue.message).join(" "), issues);
}

/**
 * Checks the two uniqueness rules up front so the response can say which field clashes:
 * - SKU: unique across every product, archived included.
 * - Barcode: unique among active products only.
 * The database indexes enforce the same rules if two requests race past this check.
 */
async function assertIdentifiersAvailable(
  values: { sku?: string; barcode?: string | null },
  excludeId?: string,
) {
  const issues: FieldIssue[] = [];

  if (values.sku) {
    const holder = await prisma.product.findUnique({ where: { sku: values.sku }, select: { id: true, archivedAt: true } });
    if (holder && holder.id !== excludeId) {
      issues.push({
        path: ["sku"],
        message: holder.archivedAt
          ? "This SKU belongs to an archived product. SKUs are never reused, so past invoices stay unambiguous."
          : "Another product already uses this SKU.",
      });
    }
  }

  if (values.barcode) {
    const holder = await prisma.product.findFirst({
      where: { barcode: values.barcode, archivedAt: null, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    if (holder) issues.push({ path: ["barcode"], message: "Another active product already uses this barcode." });
  }

  if (issues.length > 0) throw duplicateError(issues);
}

/** Translates database constraint errors that slipped past the pre-checks (concurrent writes). */
function translateWriteError(error: unknown): never {
  if (isUniqueViolation(error)) {
    if (uniqueViolationMentions(error, "barcode", "products_active_barcode_key")) {
      throw duplicateError([{ path: ["barcode"], message: "Another active product already uses this barcode." }]);
    }
    throw duplicateError([{ path: ["sku"], message: "Another product already uses this SKU." }]);
  }
  if (isForeignKeyViolation(error)) {
    throw AppError.badRequest("The selected category no longer exists", [
      { path: ["categoryId"], message: "The selected category no longer exists" },
    ]);
  }
  throw error;
}

async function assertCategoryExists(categoryId: string | null | undefined) {
  if (!categoryId) return;
  const exists = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } });
  if (!exists) {
    throw AppError.badRequest("The selected category does not exist", [
      { path: ["categoryId"], message: "The selected category does not exist" },
    ]);
  }
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function listProducts(query: ListProductsQuery, viewerRole: Role) {
  if (!canViewCost(viewerRole)) {
    if (query.status !== "active") throw AppError.forbidden("Only managers can view archived products");
    if (query.sort === "costPrice") throw AppError.forbidden("Only managers can sort by cost price");
  }

  const where: Prisma.ProductWhereInput = {
    archivedAt: query.status === "active" ? null : query.status === "archived" ? { not: null } : undefined,
    categoryId: query.categoryId === "none" ? null : query.categoryId,
    sellingPrice:
      query.minPrice || query.maxPrice ? { gte: query.minPrice, lte: query.maxPrice } : undefined,
    OR: query.search
      ? [
          { name: { contains: query.search, mode: "insensitive" } },
          { sku: { contains: query.search, mode: "insensitive" } },
          { barcode: { contains: query.search, mode: "insensitive" } },
        ]
      : undefined,
  };

  const [total, products] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: includeCategory,
      // The id tie-breaker keeps page boundaries stable when sort values repeat.
      orderBy: [{ [query.sort]: query.order }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: products.map((product) => toProductDto(product, viewerRole)),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getProduct(id: string, viewerRole: Role) {
  const product = await prisma.product.findUnique({ where: { id }, include: includeCategory });
  // Archived products are invisible to cashiers, as if they didn't exist.
  if (!product || (product.archivedAt && !canViewCost(viewerRole))) throw AppError.notFound("Product not found");
  return toProductDto(product, viewerRole);
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function createProduct(input: CreateProductInput, actorId: string, viewerRole: Role) {
  await assertCategoryExists(input.categoryId);
  await assertIdentifiersAvailable(input);
  try {
    const product = await prisma.product.create({
      data: { ...input, createdById: actorId, updatedById: actorId },
      include: includeCategory,
    });
    return toProductDto(product, viewerRole);
  } catch (error) {
    translateWriteError(error);
  }
}

async function findOrThrow(id: string): Promise<Product> {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw AppError.notFound("Product not found");
  return product;
}

export async function updateProduct(id: string, input: UpdateProductInput, actorId: string, viewerRole: Role) {
  const existing = await findOrThrow(id);
  if (existing.archivedAt) {
    throw AppError.conflict("Archived products can't be edited. Restore it first.", "PRODUCT_ARCHIVED");
  }
  await assertCategoryExists(input.categoryId);
  await assertIdentifiersAvailable({ sku: input.sku, barcode: input.barcode }, id);
  try {
    const product = await prisma.product.update({
      where: { id },
      data: { ...input, updatedById: actorId },
      include: includeCategory,
    });
    return toProductDto(product, viewerRole);
  } catch (error) {
    translateWriteError(error);
  }
}

/**
 * Hides a product from listings and (in later phases) from new sales and purchases, while
 * keeping the row and its identifiers so historical invoices still resolve. Idempotent.
 */
export async function archiveProduct(id: string, actorId: string, viewerRole: Role) {
  const existing = await findOrThrow(id);
  const product = existing.archivedAt
    ? await prisma.product.findUniqueOrThrow({ where: { id }, include: includeCategory })
    : await prisma.product.update({
        where: { id },
        data: { archivedAt: new Date(), archivedById: actorId, updatedById: actorId },
        include: includeCategory,
      });
  return toProductDto(product, viewerRole);
}

/** Brings an archived product back, unless its barcode has since been given to another active product. */
export async function restoreProduct(id: string, actorId: string, viewerRole: Role) {
  const existing = await findOrThrow(id);
  if (!existing.archivedAt) {
    return toProductDto(await prisma.product.findUniqueOrThrow({ where: { id }, include: includeCategory }), viewerRole);
  }
  try {
    await assertIdentifiersAvailable({ barcode: existing.barcode }, id);
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(
        409,
        "DUPLICATE_VALUE",
        "Another active product now uses this product's barcode. Change or clear that product's barcode, then restore this one.",
        error.details,
      );
    }
    throw error;
  }
  try {
    const product = await prisma.product.update({
      where: { id },
      data: { archivedAt: null, archivedById: null, updatedById: actorId },
      include: includeCategory,
    });
    return toProductDto(product, viewerRole);
  } catch (error) {
    translateWriteError(error);
  }
}
