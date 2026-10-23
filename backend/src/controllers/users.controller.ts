import type { RequestHandler } from "express";
import { getAuth } from "../middleware/authenticate.js";
import * as userService from "../services/user.service.js";
import { uuidParamSchema } from "../validators/common.js";
import {
  createStaffSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateStaffSchema,
} from "../validators/user.schemas.js";
import { AppError } from "../utils/AppError.js";

function userIdParam(params: unknown): string {
  const parsed = uuidParamSchema.safeParse(params);
  if (!parsed.success) throw AppError.notFound("User not found");
  return parsed.data.id;
}

export const listUsers: RequestHandler = async (req, res) => {
  const filter = listUsersQuerySchema.parse(req.query);
  res.json({ users: await userService.listUsers(filter) });
};

export const getUser: RequestHandler = async (req, res) => {
  res.json({ user: await userService.getUser(userIdParam(req.params)) });
};

export const createStaff: RequestHandler = async (req, res) => {
  const input = createStaffSchema.parse(req.body);
  res.status(201).json({ user: await userService.createStaff(input, getAuth(req).user.id) });
};

export const updateStaff: RequestHandler = async (req, res) => {
  const id = userIdParam(req.params);
  const input = updateStaffSchema.parse(req.body);
  res.json({ user: await userService.updateStaff(id, input) });
};

export const activateStaff: RequestHandler = async (req, res) => {
  res.json({ user: await userService.setStaffActive(userIdParam(req.params), true) });
};

export const deactivateStaff: RequestHandler = async (req, res) => {
  res.json({ user: await userService.setStaffActive(userIdParam(req.params), false) });
};

export const resetStaffPassword: RequestHandler = async (req, res) => {
  const id = userIdParam(req.params);
  const { password } = resetPasswordSchema.parse(req.body);
  res.json({ user: await userService.resetStaffPassword(id, password) });
};
