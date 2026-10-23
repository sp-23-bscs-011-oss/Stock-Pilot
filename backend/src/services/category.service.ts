import { prisma } from "../lib/prisma.js";
import { isForeignKeyViolation, isUniqueViolation } from "../lib/prismaErrors.js";
import { AppError } from "../utils/AppError.js";
import type { Category } from "../generated/prisma/client.js";

export function categoryNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function toCategoryDto(category: Category, counts: { active: number; total: number }) {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    /** Active products in this category. */
    productCount: counts.active,
    /** Including archived products; a category can only be deleted when this is 0. */
    totalProductCount: counts.total,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

export type CategoryDto = ReturnType<typeof toCategoryDto>;

const nameTaken = () =>
  new AppError(409, "DUPLICATE_VALUE", "A category with this name already exists", [
    { path: ["name"], message: "A category with this name already exists" },
  ]);

async function countsFor(categoryIds?: string[]) {
  const where = categoryIds ? { categoryId: { in: categoryIds } } : { categoryId: { not: null } };
  const [all, active] = await Promise.all([
    prisma.product.groupBy({ by: ["categoryId"], where, _count: { _all: true } }),
    prisma.product.groupBy({ by: ["categoryId"], where: { ...where, archivedAt: null }, _count: { _all: true } }),
  ]);
  const total = new Map(all.map((row) => [row.categoryId, row._count._all]));
  const activeCount = new Map(active.map((row) => [row.categoryId, row._count._all]));
  return (id: string) => ({ active: activeCount.get(id) ?? 0, total: total.get(id) ?? 0 });
}

export async function listCategories(): Promise<CategoryDto[]> {
  const [categories, counts] = await Promise.all([
    prisma.category.findMany({ orderBy: { nameKey: "asc" } }),
    countsFor(),
  ]);
  return categories.map((category) => toCategoryDto(category, counts(category.id)));
}

async function findOrThrow(id: string): Promise<Category> {
  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) throw AppError.notFound("Category not found");
  return category;
}

async function withCounts(category: Category): Promise<CategoryDto> {
  return toCategoryDto(category, (await countsFor([category.id]))(category.id));
}

export async function createCategory(input: { name: string; description: string | null }) {
  try {
    const category = await prisma.category.create({
      data: { name: input.name, nameKey: categoryNameKey(input.name), description: input.description },
    });
    return toCategoryDto(category, { active: 0, total: 0 });
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
}

export async function updateCategory(id: string, input: { name?: string; description?: string | null }) {
  await findOrThrow(id);
  try {
    const category = await prisma.category.update({
      where: { id },
      data: {
        name: input.name,
        nameKey: input.name === undefined ? undefined : categoryNameKey(input.name),
        description: input.description,
      },
    });
    return withCounts(category);
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
}

/**
 * Only empty categories can be deleted. Archived products still count: they keep their
 * category for historical reports. The foreign key (ON DELETE RESTRICT) backs this up.
 */
export async function deleteCategory(id: string): Promise<void> {
  await findOrThrow(id);
  const [active, total] = await Promise.all([
    prisma.product.count({ where: { categoryId: id, archivedAt: null } }),
    prisma.product.count({ where: { categoryId: id } }),
  ]);
  if (active > 0) {
    throw AppError.conflict(
      `This category is used by ${active} product${active === 1 ? "" : "s"}. Move them to another category first.`,
      "CATEGORY_IN_USE",
    );
  }
  if (total > 0) {
    throw AppError.conflict(
      "Archived products still belong to this category, so it's kept for their history. Rename it instead.",
      "CATEGORY_IN_USE",
    );
  }
  try {
    await prisma.category.delete({ where: { id } });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw AppError.conflict("This category is still used by products", "CATEGORY_IN_USE");
    }
    throw error;
  }
}
