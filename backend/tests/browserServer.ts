import { readFileSync } from "node:fs";
import { parse } from "dotenv";

// Only the disposable test database is ever reset. Never load development credentials.
const testEnv = parse(readFileSync(new URL("../.env.test", import.meta.url)));
if (!/test/i.test(new URL(testEnv["DATABASE_URL"] ?? "").pathname)) throw new Error("Browser tests require a test database");
Object.assign(process.env, testEnv, { PORT: "4001", CORS_ORIGIN: "http://localhost:5174", NODE_ENV: "test" });

const { default: applyMigrations } = await import("./globalSetup.js");
applyMigrations();

const { prisma, resetDatabase, createUser, buildApp } = await import("./helpers.js");
const { createStore } = await import("./inventoryHelpers.js");
const { createProduct } = await import("./catalogHelpers.js");
await resetDatabase();
await createUser("OWNER", { email: "browser-owner@example.com" });
await createUser("MANAGER", { email: "browser-manager@example.com" });
await createUser("CASHIER", { email: "browser-cashier@example.com" });
await createStore({ name: "Browser Test Store", code: "BROWSER" });
await createProduct({ name: "Browser Test Coffee", sku: "BROWSER-COFFEE", costPrice: "12.34" });
const server = buildApp().listen(4001, "127.0.0.1", () => console.log("Browser test API ready on port 4001"));
async function stop() { server.close(); await prisma.$disconnect(); process.exit(0); }
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
