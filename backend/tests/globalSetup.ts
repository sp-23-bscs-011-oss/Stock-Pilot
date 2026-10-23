import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";

/** Applies migrations to the test database once before the suite runs. */
export default function setup() {
  const testEnv = parse(readFileSync(new URL("../.env.test", import.meta.url)));
  const url = testEnv["DATABASE_URL"] ?? "";
  const databaseName = new URL(url).pathname.slice(1);

  // The suite truncates tables; refuse to touch anything that doesn't look like a test database.
  if (!/test/i.test(databaseName)) {
    throw new Error(`Refusing to run tests against "${databaseName}": the database name must contain "test".`);
  }

  execSync("npx prisma migrate deploy", {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}
