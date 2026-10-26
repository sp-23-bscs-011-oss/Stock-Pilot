import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, role = "owner") {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(`browser-${role}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("Str0ngPassw0rd");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/");
}

test("supplier to purchase to partial/full receiving and payments, including lost-response recovery", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  await page.goto("/suppliers");
  await page.getByRole("button", { name: "New supplier" }).click();
  await page.getByLabel("Supplier name", { exact: true }).fill("Browser Wholesale");
  await page.getByLabel("Email (optional)").fill("orders@browser.example");
  await page.getByLabel("Contact person (optional)").fill("Test Buyer");
  await page.getByRole("button", { name: "Add supplier", exact: true }).click();
  await page.getByRole("link", { name: "Browser Wholesale", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Phone (optional)").fill("+92 300 1234567");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("+92 300 1234567", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "New purchase order" }).click();
  await page.getByLabel("Add a product", { exact: true }).fill("Browser Test Coffee");
  await page.getByRole("button", { name: /Browser Test Coffee.*BROWSER-COFFEE/ }).click();
  await page.getByLabel("Quantity of Browser Test Coffee", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/purchases\/[0-9a-f-]+$/);
  const orderPath = new URL(page.url()).pathname;
  const orderId = orderPath.split("/").pop()!;
  const getOrder = async () => (await (await page.request.get(`/api/purchases/${orderId}`)).json()).order;
  const draft = await getOrder();
  expect(draft.total).toBe("123.40");
  expect(draft.status).toBe("DRAFT");
  const stock = async () => {
    const response = await page.request.get(`/api/inventory?storeId=${draft.store.id}&search=BROWSER-COFFEE`);
    expect(response.ok()).toBeTruthy();
    return (await response.json()).items[0].quantity;
  };
  expect(await stock()).toBe(0);
  await page.getByRole("button", { name: "Mark as ordered", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark as ordered", exact: true }).click();
  await expect(page.getByRole("link", { name: "Receive stock", exact: true })).toBeVisible();
  expect(await stock()).toBe(0);

  // The server commits, but the response is lost. Refresh must replay the original key.
  let loseReceiptResponse = true;
  let rejectReceiptRetry = true;
  await page.route("**/api/purchases/*/receipts", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (!loseReceiptResponse && rejectReceiptRetry) {
      rejectReceiptRetry = false;
      return route.fulfill({ status: 403, json: { error: { code: "CSRF_INVALID", message: "Refresh your session and retry" } } });
    }
    if (!loseReceiptResponse) return route.continue();
    loseReceiptResponse = false;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.getByRole("link", { name: "Receive stock", exact: true }).click();
  await page.getByLabel(/Quantity of Browser Test Coffee received/).fill("4");
  await page.getByRole("button", { name: "Receive into stock" }).click();
  await expect(page.getByText(/A delivery request is awaiting confirmation/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Retry delivery confirmation" }).click();
  await expect(page.getByText("Refresh your session and retry")).toBeVisible();
  await page.getByRole("button", { name: "Retry delivery confirmation" }).click();
  await expect(page).toHaveURL(orderPath);
  expect(await stock()).toBe(4);
  expect((await getOrder()).receipts).toHaveLength(1);

  let losePaymentResponse = true;
  await page.route("**/api/purchases/*/payments", async (route) => {
    if (!losePaymentResponse) return route.continue();
    losePaymentResponse = false;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("20.10");
  await page.getByLabel("Reference (optional)").fill("BANK-BROWSER-1");
  await page.getByRole("dialog").getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(page.getByText(/A payment request is awaiting confirmation/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await page.getByRole("button", { name: "Confirm saved payment", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect((await getOrder()).payments).toHaveLength(1);
  expect((await getOrder()).balanceDue).toBe("103.30");

  await page.getByRole("link", { name: "Receive stock", exact: true }).click();
  await page.getByRole("button", { name: "Fill all outstanding" }).click();
  await page.getByRole("button", { name: "Receive into stock" }).click();
  await expect(page).toHaveURL(orderPath);
  expect(await stock()).toBe(10);
  expect((await getOrder()).status).toBe("RECEIVED");
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect((await getOrder()).paymentStatus).toBe("PAID");
  await page.screenshot({ path: testInfo.outputPath("purchase-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("heading", { name: "Supplier payments" })).toBeVisible();
  await expect.poll(() => page.locator(".sidebar").evaluate((sidebar) => sidebar.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("purchase-mobile.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/purchases/history");
  await page.getByRole("searchbox", { name: "Search orders" }).fill(draft.number);
  await expect(page.getByRole("link", { name: draft.number, exact: true })).toBeVisible();
  await page.goto("/suppliers");
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Browser Wholesale", exact: true }) });
  await row.locator("summary").click();
  await row.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Deactivate", exact: true }).click();
  await expect(page.getByRole("link", { name: "Browser Wholesale", exact: true })).not.toBeVisible();
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("inactive");
  await row.locator("summary").click();
  await row.getByRole("button", { name: "Reactivate", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reactivate", exact: true }).click();
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("active");
  await expect(page.getByRole("link", { name: "Browser Wholesale", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("manager can view purchasing but cannot record payments", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/purchases");
  await page.getByRole("link", { name: /PO-\d+/ }).first().click();
  await expect(page.getByText("Only the owner can record supplier payments.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record payment", exact: true })).toHaveCount(0);
});

test("cashier cannot access the administrative purchase pages", async ({ page }) => {
  await login(page, "cashier");
  await page.goto("/purchases");
  await expect(page.getByRole("heading", { name: "Purchases", exact: true })).toHaveCount(0);
  expect((await page.request.get("/api/purchases")).status()).toBe(403);
  expect((await page.request.get("/api/suppliers")).status()).toBe(403);
});
