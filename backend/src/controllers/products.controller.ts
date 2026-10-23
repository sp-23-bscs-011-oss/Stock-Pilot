import type { RequestHandler } from "express";
import { getAuth } from "../middleware/authenticate.js";
import * as productService from "../services/product.service.js";
import { AppError } from "../utils/AppError.js";
import { createProductSchema, listProductsQuerySchema, updateProductSchema } from "../validators/catalog.schemas.js";
import { uuidParamSchema } from "../validators/common.js";

function productIdParam(params: unknown): string {
  const parsed = uuidParamSchema.safeParse(params);
  if (!parsed.success) throw AppError.notFound("Product not found");
  return parsed.data.id;
}

export const listProducts: RequestHandler = async (req, res) => {
  const query = listProductsQuerySchema.parse(req.query);
  res.json(await productService.listProducts(query, getAuth(req).user.role));
};

export const getProduct: RequestHandler = async (req, res) => {
  res.json({ product: await productService.getProduct(productIdParam(req.params), getAuth(req).user.role) });
};

export const createProduct: RequestHandler = async (req, res) => {
  const input = createProductSchema.parse(req.body);
  const { user } = getAuth(req);
  res.status(201).json({ product: await productService.createProduct(input, user.id, user.role) });
};

export const updateProduct: RequestHandler = async (req, res) => {
  const id = productIdParam(req.params);
  const input = updateProductSchema.parse(req.body);
  const { user } = getAuth(req);
  res.json({ product: await productService.updateProduct(id, input, user.id, user.role) });
};

export const archiveProduct: RequestHandler = async (req, res) => {
  const { user } = getAuth(req);
  res.json({ product: await productService.archiveProduct(productIdParam(req.params), user.id, user.role) });
};

export const restoreProduct: RequestHandler = async (req, res) => {
  const { user } = getAuth(req);
  res.json({ product: await productService.restoreProduct(productIdParam(req.params), user.id, user.role) });
};
