# Phase 5 — Supplier and purchase management

The repository already contained supplier CRUD, purchase orders, receipts, stock locking, reports and audit logging. This completion extends those features, retains the Phase 2 authentication middleware and Phase 4 inventory service, and preserves all existing records and document numbers.

## User workflow

- `/suppliers`: search and paginate suppliers, use the row action menu to edit/archive/reactivate, and open the purchasing report.
- `/suppliers/:id`: contact details, goods ordered/received/outstanding, payments recorded, balance due, purchase history and audit activity.
- `/purchases`: search by number/supplier/product/SKU, filter status/supplier/store/creation dates, sort and paginate. Delivery and payment badges are separate.
- `/purchases/new` and `/purchases/:id/edit`: select a supplier and store, add products, enter quantities and unit costs, save a draft or submit it. Product choices come from the actual catalog. Supplier selectors fetch every page instead of silently stopping at 100 suppliers.
- `/purchases/:id`: order lines, delivery progress, immutable receipts, supplier payments and staff audit trail. Owners can record payments already made; this does not initiate a bank transfer.
- `/purchases/:id/receive`: enter quantities from the current delivery, or fill outstanding quantities. Partial deliveries remain open.
- `/purchases/history`: purchase records with date, supplier, store and status filters.

The UI uses the existing layout, forms and accessible native dialogs. New Tailwind utilities use the `tw:` prefix and omit Preflight to preserve existing styles. The shadcn-style Badge/Skeleton components and Sonner notifications use StockPilot's existing light/dark theme tokens. Lists include loading skeletons, empty/error states, and retry actions.

## Database and transaction rules

Migration: `backend/prisma/migrations/20261026000000_purchase_payments/migration.sql`.

The existing Prisma models `PurchaseOrder`, `PurchaseOrderLine`, and `PurchaseReceiptLine` remain the purchase, purchase-item, and receipt-item models. Renaming/recreating their tables would unnecessarily disrupt previous work. `InventoryLevel` remains the inventory model. Purchase numbers retain the existing PostgreSQL sequence and global uniqueness, which also guarantees uniqueness within every store. Numbers are increasing, not gapless; rolled-back inserts may leave sequence gaps.

The additive migration creates `PurchasePayment`, its method enum, order/user foreign keys, unique idempotency-key index, order/date and recorder indexes, positive-amount constraint, and an immutability trigger. Existing purchasing tables are untouched. Payment amounts use `NUMERIC(14,2)`, costs use `NUMERIC(12,2)`, and quantities remain whole units to match the existing inventory model.

Receiving locks the purchase row with `SELECT ... FOR UPDATE`. It checks the stored idempotency key and original payload before checking status, so a retry still succeeds after the original request fully received the order. Remaining quantities are validated while holding the lock. Inventory rows are locked in product-ID order, and receipt lines, inventory increments, stock movements, status and audit entries commit in one PostgreSQL transaction. Any failure rolls back the entire delivery. Draft creation, submission and payments do not change inventory.

The browser persists the exact pending receipt/payment payload in session storage before sending it. Network/server errors, authentication/CSRF failures and rate limits keep the same key. Closing/reopening a form or refreshing the page also preserves it. Definitive business rejections resolve the attempt; retries with a changed payload or a key belonging to another order are rejected. Storage is scoped to user, order and operation. Cross-tab or independently entered deliveries still require staff to identify which physical delivery they are recording; independently generated keys represent separate deliveries.

## Payment and cancellation rules

Only owners can call the payment endpoint. Managers may view balances and payment history, and manage suppliers, orders and receiving. Cashiers cannot access purchasing APIs. Existing session, CSRF, active-user and password-change middleware applies to all routes.

- `paidTotal` is the exact decimal sum of payment records.
- `payableTotal` is zero on a draft, the order total on a submitted order, and the value of received goods on a cancelled order.
- `balanceDue = payableTotal - paidTotal`.
- `paymentStatus` is derived as `NOT_DUE`, `UNPAID`, `PARTIALLY_PAID`, or `PAID`; it does not alter the purchase status.
- Payment amount must be a positive decimal string with at most two fractional digits and cannot exceed the current balance. Payment date is a valid ISO calendar date, no later than the current UTC date. Methods: `CASH`, `BANK_TRANSFER`, `CARD`, `CHEQUE`, `OTHER`.
- Payments share the purchase row lock with receiving/cancellation, so concurrent payments cannot both consume the same balance. The payment and audit entry commit together. A unique idempotency key prevents duplicate payment records.
- Drafts and open orders may be cancelled. Received/cancelled orders cannot be cancelled again. Partial cancellation keeps delivered stock and its history. Cancellation is blocked if an advance payment exceeds goods received; refunds are outside this phase. A cancelled partial order can still be paid for the goods actually received.
- Supplier profile/report payment balances are current all-time totals. Report date filters continue to apply to orders placed and goods received, as before.

## API contract

All amounts are decimal strings in responses. All writes require `X-CSRF-Token` with the existing authenticated cookie session. Request fields follow the established repository names: `contactName`, `isActive`, `lines`, `quantity`, `unitCost`.

| Method | Endpoint | Body / behavior |
| --- | --- | --- |
| GET | `/api/suppliers` | Search, status, sort, page and pageSize |
| POST | `/api/suppliers` | name, optional contactName/email/phone/address/paymentTerms/notes |
| GET | `/api/suppliers/:id` | Supplier, current stats and activity; purchase history uses supplierId filter below |
| PATCH | `/api/suppliers/:id` | Partial supplier fields |
| PATCH | `/api/suppliers/:id/status` | `{ "isActive": false }` archives; true reactivates |
| GET | `/api/purchases` | page, pageSize, search, status, open, supplierId, storeId, productId, from, to, sort, order |
| POST | `/api/purchases` | supplierId, storeId, expectedAt?, note?, lines: [{ productId, quantity, unitCost }] |
| GET | `/api/purchases/:id` | Order, lines, receipts, payments, balances and activity |
| PATCH | `/api/purchases/:id` | Complete edited draft payload, same shape as create; replaces draft lines |
| POST | `/api/purchases/:id/submit` | Submit draft; body optional |
| POST | `/api/purchases/:id/cancel` | `{ "reason": "..." }`, reason optional |
| POST | `/api/purchases/:id/receipts` | idempotencyKey (UUID), note?, lines: [{ lineId, quantity }]; zero quantities ignored |
| GET | `/api/purchases/:id/receipts` | `{ receipts: [...] }` including staff, timestamps and delivery details |
| POST | `/api/purchases/:id/payments` | Owner only: idempotencyKey, amount, method, paidAt (YYYY-MM-DD), reference? |

New receipt/payment requests return `201`; identical retries return `200` with `replayed: true`, the original receipt/payment ID and current order. Over-receiving, overpayment, disallowed lifecycle changes and mismatched idempotency keys return `409`. Invalid fields return `400`; forbidden roles return `403`. Original `/api/purchase-orders`, `PUT /:id` and `POST /:id/order` remain compatible.

## Setup

From the repository root:

```powershell
npm.cmd --prefix frontend install
npm.cmd --prefix backend run prisma:generate
npm.cmd --prefix backend run prisma:deploy
npm.cmd run dev:backend
# In another terminal:
npm.cmd run dev:frontend
```

The migration was applied to local `stockpilot` and `stockpilot_test`. No development records were reset or seeded. Test fixtures exist only in the disposable test database. The Docker PostgreSQL service uses port 5433.

## Verification

Commands from repository root:

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd --prefix frontend run lint
npm.cmd --prefix backend run prisma:validate
npm.cmd --prefix backend test -- --reporter=dot
npm.cmd --prefix frontend run test:e2e
```

Do not run the API and browser suites simultaneously: both reset `stockpilot_test`. The browser harness applies test migrations, seeds test-only accounts/products, starts temporary API/Vite servers on ports 4001/5174, and shuts them down afterwards. It refuses a database whose name does not contain `test`. Browser tests use installed Microsoft Edge by default; set `PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome.

Validated on 2026-10-26:

- Backend/frontend TypeScript checks: passed.
- Backend/frontend production builds: passed.
- Frontend lint: passed without warnings.
- Prisma schema validation and migration deployment: passed.
- PostgreSQL integration suite: **203 tests passed across 8 files** (183 previous tests plus 20 new tests).
- Playwright: **3 browser tests passed**, including supplier create/edit/archive/reactivate, draft/submit, partial/full receiving, partial/full payments, role restrictions, desktop/mobile rendering, and recovering committed receipts/payments after lost responses and page refreshes.

The integration suite covers exact totals, inventory unchanged until receipt, duplicate and concurrent receiving, over-receiving, rollback, cancellation restrictions, payment validation, concurrent payment/cancellation, cross-order idempotency collisions, immutable database history, CSRF and role enforcement. Prisma's PostgreSQL adapter emits a pg deprecation warning during the suite; it does not fail the checks.

## Changed-file manifest

Paths below are relative to `E:\Projects\StockPilot`.

- [.gitignore](../.gitignore)
- [README.md](../README.md)
- [backend/prisma/migrations/20261026000000_purchase_payments/migration.sql](../backend/prisma/migrations/20261026000000_purchase_payments/migration.sql)
- [backend/prisma/schema.prisma](../backend/prisma/schema.prisma)
- [backend/src/controllers/purchasing.controller.ts](../backend/src/controllers/purchasing.controller.ts)
- [backend/src/routes/index.ts](../backend/src/routes/index.ts)
- [backend/src/routes/purchasing.routes.ts](../backend/src/routes/purchasing.routes.ts)
- [backend/src/services/purchaseOrder.service.ts](../backend/src/services/purchaseOrder.service.ts)
- [backend/src/services/supplier.service.ts](../backend/src/services/supplier.service.ts)
- [backend/src/validators/purchasing.schemas.ts](../backend/src/validators/purchasing.schemas.ts)
- [backend/tests/browserServer.ts](../backend/tests/browserServer.ts)
- [backend/tests/purchasePayments.test.ts](../backend/tests/purchasePayments.test.ts)
- [docs/phase5.md](../docs/phase5.md)
- [frontend/components.json](../frontend/components.json)
- [frontend/e2e/purchasing.spec.ts](../frontend/e2e/purchasing.spec.ts)
- [frontend/package-lock.json](../frontend/package-lock.json)
- [frontend/package.json](../frontend/package.json)
- [frontend/playwright.config.ts](../frontend/playwright.config.ts)
- [frontend/src/components/purchasing/ActivityLog.tsx](../frontend/src/components/purchasing/ActivityLog.tsx)
- [frontend/src/components/purchasing/PaymentPanel.tsx](../frontend/src/components/purchasing/PaymentPanel.tsx)
- [frontend/src/components/purchasing/PaymentStatusBadge.tsx](../frontend/src/components/purchasing/PaymentStatusBadge.tsx)
- [frontend/src/components/purchasing/ProductPicker.tsx](../frontend/src/components/purchasing/ProductPicker.tsx)
- [frontend/src/components/purchasing/PurchaseOrderTable.tsx](../frontend/src/components/purchasing/PurchaseOrderTable.tsx)
- [frontend/src/components/purchasing/PurchasingSkeleton.tsx](../frontend/src/components/purchasing/PurchasingSkeleton.tsx)
- [frontend/src/components/purchasing/ReceiveStockDialog.tsx](../frontend/src/components/purchasing/ReceiveStockDialog.tsx)
- [frontend/src/components/purchasing/SupplierReportView.tsx](../frontend/src/components/purchasing/SupplierReportView.tsx)
- [frontend/src/components/purchasing/purchasingLabels.ts](../frontend/src/components/purchasing/purchasingLabels.ts)
- [frontend/src/components/ui/badge.tsx](../frontend/src/components/ui/badge.tsx)
- [frontend/src/components/ui/skeleton.tsx](../frontend/src/components/ui/skeleton.tsx)
- [frontend/src/components/ui/sonner.tsx](../frontend/src/components/ui/sonner.tsx)
- [frontend/src/hooks/useNoticeToast.ts](../frontend/src/hooks/useNoticeToast.ts)
- [frontend/src/hooks/usePendingSubmission.ts](../frontend/src/hooks/usePendingSubmission.ts)
- [frontend/src/index.css](../frontend/src/index.css)
- [frontend/src/lib/utils.ts](../frontend/src/lib/utils.ts)
- [frontend/src/pages/PurchaseHistoryPage.tsx](../frontend/src/pages/PurchaseHistoryPage.tsx)
- [frontend/src/pages/PurchaseOrderDetailPage.tsx](../frontend/src/pages/PurchaseOrderDetailPage.tsx)
- [frontend/src/pages/PurchaseOrderEditorPage.tsx](../frontend/src/pages/PurchaseOrderEditorPage.tsx)
- [frontend/src/pages/PurchasesPage.tsx](../frontend/src/pages/PurchasesPage.tsx)
- [frontend/src/pages/ReceiveStockPage.tsx](../frontend/src/pages/ReceiveStockPage.tsx)
- [frontend/src/pages/SupplierDetailPage.tsx](../frontend/src/pages/SupplierDetailPage.tsx)
- [frontend/src/pages/SuppliersPage.tsx](../frontend/src/pages/SuppliersPage.tsx)
- [frontend/src/providers/AppProviders.tsx](../frontend/src/providers/AppProviders.tsx)
- [frontend/src/routes/router.tsx](../frontend/src/routes/router.tsx)
- [frontend/src/services/purchasingService.ts](../frontend/src/services/purchasingService.ts)
- [frontend/src/types/purchasing.ts](../frontend/src/types/purchasing.ts)
- [frontend/tsconfig.app.json](../frontend/tsconfig.app.json)
- [frontend/vite.config.ts](../frontend/vite.config.ts)
