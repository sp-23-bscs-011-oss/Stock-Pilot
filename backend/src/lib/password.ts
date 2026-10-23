import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

// Compared against when the email is unknown, so a miss costs as much as a wrong password
// and response timing doesn't reveal which emails have accounts.
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(password: string, hash: string | undefined): Promise<boolean> {
  if (hash === undefined) {
    dummyHash ??= bcrypt.hash(randomBytes(16).toString("hex"), env.BCRYPT_ROUNDS);
    await bcrypt.compare(password, await dummyHash);
    return false;
  }
  return bcrypt.compare(password, hash);
}
