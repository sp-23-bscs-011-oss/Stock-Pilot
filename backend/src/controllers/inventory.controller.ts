import type { RequestHandler } from "express";
import { getAuth } from "../middleware/authenticate.js";
import * as inventoryService from "../services/inventory.service.js";
import * as storeService from "../services/store.service.js";
import { AppError } from "../utils/AppError.js";
import { uuidParamSchema } from "../validators/common.js";
import {
  adjustStockSchema,
  createStoreSchema,
  listInventoryQuerySchema,
  listMovementsQuerySchema,
  updateStoreSchema,
} from "../validators/inventory.schemas.js";

export const listInventory: RequestHandler = async (req, res) => {
  res.json(await inventoryService.listInventory(listInventoryQuerySchema.parse(req.query)));
};

export const adjustStock: RequestHandler = async (req, res) => {
  const input = adjustStockSchema.parse(req.body);
  res.status(201).json(await inventoryService.adjustStock(input, getAuth(req).user.id));
};

export const listMovements: RequestHandler = async (req, res) => {
  res.json(await inventoryService.listMovements(listMovementsQuerySchema.parse(req.query)));
};

export const listStores: RequestHandler = async (req, res) => {
  // Only the owner manages stores, so only the owner needs to see inactive ones.
  const includeInactive = getAuth(req).user.role === "OWNER" && req.query["includeInactive"] === "true";
  res.json({ stores: await storeService.listStores(includeInactive) });
};

export const createStore: RequestHandler = async (req, res) => {
  res.status(201).json({ store: await storeService.createStore(createStoreSchema.parse(req.body)) });
};

export const updateStore: RequestHandler = async (req, res) => {
  const params = uuidParamSchema.safeParse(req.params);
  if (!params.success) throw AppError.notFound("Store not found");
  res.json({ store: await storeService.updateStore(params.data.id, updateStoreSchema.parse(req.body)) });
};
