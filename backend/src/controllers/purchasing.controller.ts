import type { RequestHandler } from "express";
import { getAuth } from "../middleware/authenticate.js";
import * as auditService from "../services/audit.service.js";
import * as purchaseOrderService from "../services/purchaseOrder.service.js";
import * as supplierService from "../services/supplier.service.js";
import { AppError } from "../utils/AppError.js";
import { listAuditLogsQuerySchema } from "../validators/audit.schemas.js";
import { uuidParamSchema } from "../validators/common.js";
import {
  cancelPurchaseOrderSchema,
  createSupplierSchema,
  listPurchaseOrdersQuerySchema,
  listSuppliersQuerySchema,
  purchaseOrderSchema,
  receivePurchaseOrderSchema,
  supplierReportQuerySchema,
  updateSupplierSchema,
  supplierStatusSchema,
  purchasePaymentSchema,
} from "../validators/purchasing.schemas.js";

function idParam(params: unknown, notFound: string): string {
  const parsed = uuidParamSchema.safeParse(params);
  if (!parsed.success) throw AppError.notFound(notFound);
  return parsed.data.id;
}

const supplierId = (params: unknown) => idParam(params, "Supplier not found");
const orderId = (params: unknown) => idParam(params, "Purchase order not found");

// ─── Suppliers ───────────────────────────────────────────────────────────────

export const listSuppliers: RequestHandler = async (req, res) => {
  res.json(await supplierService.listSuppliers(listSuppliersQuerySchema.parse(req.query)));
};

export const supplierReport: RequestHandler = async (req, res) => {
  res.json(await supplierService.supplierReport(supplierReportQuerySchema.parse(req.query)));
};

export const getSupplier: RequestHandler = async (req, res) => {
  res.json({ supplier: await supplierService.getSupplier(supplierId(req.params)) });
};

export const createSupplier: RequestHandler = async (req, res) => {
  const input = createSupplierSchema.parse(req.body);
  res.status(201).json({ supplier: await supplierService.createSupplier(input, getAuth(req).user.id) });
};

export const updateSupplier: RequestHandler = async (req, res) => {
  const id = supplierId(req.params);
  const input = updateSupplierSchema.parse(req.body);
  res.json({ supplier: await supplierService.updateSupplier(id, input, getAuth(req).user.id) });
};

export const deleteSupplier: RequestHandler = async (req, res) => {
  await supplierService.deleteSupplier(supplierId(req.params), getAuth(req).user.id);
  res.status(204).end();
};

export const updateSupplierStatus: RequestHandler = async (req, res) => {
  const input = supplierStatusSchema.parse(req.body);
  res.json({ supplier: await supplierService.updateSupplier(supplierId(req.params), input, getAuth(req).user.id) });
};

export const listPurchaseReceipts: RequestHandler = async (req, res) => {
  const order = await purchaseOrderService.getPurchaseOrder(orderId(req.params));
  res.json({ receipts: order.receipts });
};

export const recordPurchasePayment: RequestHandler = async (req, res) => {
  const input = purchasePaymentSchema.parse(req.body);
  const result = await purchaseOrderService.recordPurchasePayment(orderId(req.params), input, getAuth(req).user.id);
  res.status(result.replayed ? 200 : 201).json(result);
};

// ─── Purchase orders ─────────────────────────────────────────────────────────

export const listPurchaseOrders: RequestHandler = async (req, res) => {
  res.json(await purchaseOrderService.listPurchaseOrders(listPurchaseOrdersQuerySchema.parse(req.query)));
};

export const getPurchaseOrder: RequestHandler = async (req, res) => {
  res.json({ order: await purchaseOrderService.getPurchaseOrder(orderId(req.params)) });
};

export const createPurchaseOrder: RequestHandler = async (req, res) => {
  const input = purchaseOrderSchema.parse(req.body);
  res.status(201).json({ order: await purchaseOrderService.createPurchaseOrder(input, getAuth(req).user.id) });
};

export const updatePurchaseOrder: RequestHandler = async (req, res) => {
  const id = orderId(req.params);
  const input = purchaseOrderSchema.parse(req.body);
  res.json({ order: await purchaseOrderService.updatePurchaseOrder(id, input, getAuth(req).user.id) });
};

export const placePurchaseOrder: RequestHandler = async (req, res) => {
  res.json({ order: await purchaseOrderService.placePurchaseOrder(orderId(req.params), getAuth(req).user.id) });
};

export const cancelPurchaseOrder: RequestHandler = async (req, res) => {
  const id = orderId(req.params);
  const { reason } = cancelPurchaseOrderSchema.parse(req.body ?? {});
  res.json({ order: await purchaseOrderService.cancelPurchaseOrder(id, reason, getAuth(req).user.id) });
};

export const receivePurchaseOrder: RequestHandler = async (req, res) => {
  const id = orderId(req.params);
  const input = receivePurchaseOrderSchema.parse(req.body);
  const result = await purchaseOrderService.receivePurchaseOrder(id, input, getAuth(req).user.id);
  // A replayed request created nothing new.
  res.status(result.replayed ? 200 : 201).json(result);
};

// ─── Audit log ───────────────────────────────────────────────────────────────

export const listAuditLogs: RequestHandler = async (req, res) => {
  res.json(await auditService.listAuditLogs(listAuditLogsQuerySchema.parse(req.query)));
};
