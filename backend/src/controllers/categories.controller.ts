import type { RequestHandler } from "express";
import * as categoryService from "../services/category.service.js";
import { AppError } from "../utils/AppError.js";
import { createCategorySchema, updateCategorySchema } from "../validators/catalog.schemas.js";
import { uuidParamSchema } from "../validators/common.js";

function categoryIdParam(params: unknown): string {
  const parsed = uuidParamSchema.safeParse(params);
  if (!parsed.success) throw AppError.notFound("Category not found");
  return parsed.data.id;
}

export const listCategories: RequestHandler = async (_req, res) => {
  res.json({ categories: await categoryService.listCategories() });
};

export const createCategory: RequestHandler = async (req, res) => {
  const input = createCategorySchema.parse(req.body);
  res.status(201).json({ category: await categoryService.createCategory(input) });
};

export const updateCategory: RequestHandler = async (req, res) => {
  const id = categoryIdParam(req.params);
  const input = updateCategorySchema.parse(req.body);
  res.json({ category: await categoryService.updateCategory(id, input) });
};

export const deleteCategory: RequestHandler = async (req, res) => {
  await categoryService.deleteCategory(categoryIdParam(req.params));
  res.status(204).end();
};
