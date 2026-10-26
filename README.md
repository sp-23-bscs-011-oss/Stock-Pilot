# StockPilot

Smart Inventory & POS Management System.

| Part       | Stack                                                                    |
| ---------- | ------------------------------------------------------------------------ |
| `backend`  | Node.js · Express 5 · TypeScript · Prisma 7 (`@prisma/adapter-pg`) · Pino |
| `frontend` | React 19 · TypeScript · Vite · React Router · TanStack Query · Axios     |
| Database   | PostgreSQL                                                               |

## Prerequisites

- Node.js **20.19+** (developed on 24.x) and npm
- PostgreSQL 14+ — either Docker Desktop (uses `docker-compose.yml`) or a native install

## 1. Start PostgreSQL

**Option A — Docker**

```bash
docker compose up -d          # or: npm run db:up
docker compose ps             # wait until the postgres service shows "healthy"
```

This creates the user and password `stockpilot`, plus the databases `stockpilot` (development) and `stockpilot_test` (used by `npm test`). They're published on **`localhost:5433`**, so they can run alongside a native PostgreSQL on 5432. This matches `backend/.env.example` and `backend/.env.test`.

> `stockpilot_test` is created by `docker/postgres-init/` only when the volume is first created. If your volume predates Phase 2, create it once:
> `docker compose exec postgres createdb -U stockpilot stockpilot_test`

**Option B — native PostgreSQL** (for example, the Windows installer from postgresql.org)

```bash
psql -U postgres -f backend/prisma/local-setup.sql   # creates the role and both databases
```

Then change the port in `DATABASE_URL` from `5433` to `5432` in `backend/.env` and `backend/.env.test`, along with any credentials you changed.

## 2. Backend

```bash
cd backend
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
npm install                   # also runs `prisma generate`
npm run prisma:deploy         # create or update the tables
npm run dev                   # http://localhost:4000
```

Before the first run, set `SETUP_TOKEN` in `backend/.env` (see [Authentication](#authentication)).

| Script                    | Purpose                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `npm run dev`             | Watch mode with `tsx`                                       |
| `npm run build` / `start` | Compile to `dist/` and run the compiled server              |
| `npm run typecheck`       | Type-check the app and the tests without emitting           |
| `npm test`                | Integration tests against `stockpilot_test` (see below)     |
| `npm run prisma:generate` | Regenerate the client into `src/generated/prisma`           |
| `npm run prisma:migrate`  | Create and apply a new migration after editing the schema   |
| `npm run prisma:deploy`   | Apply existing migrations (CI or production)                |
| `npm run prisma:studio`   | Open Prisma Studio                                          |

Environment variables are validated at startup (`src/config/env.ts`). The server exits with a clear message if one is missing or invalid.

## 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev                   # http://localhost:5173
```

In development the browser calls `/api/*` on the Vite origin, and Vite proxies those calls to `VITE_DEV_API_PROXY_TARGET` (`http://localhost:4000` by default), so CORS isn't involved locally.

## 4. Verify the foundation (Phase 1)

1. **API and database are healthy:**
   ```bash
   curl -i http://localhost:4000/api/health
   ```
   This should return `200` with `"status":"ok"` and `"database":{"status":"up","latencyMs":…}`.
2. **The database-down path works:** stop Postgres (`docker compose stop postgres`) and run the same request again. It should return `503` with `"status":"degraded"` and a reason such as `ECONNREFUSED`. Start Postgres again afterwards.
3. **Centralized errors:** `curl http://localhost:4000/api/unknown` should return a JSON `404` with `code`, `message`, and `requestId`.
4. **Security headers and CORS:** the `curl -i` output includes Helmet headers (`Content-Security-Policy`, `X-Content-Type-Options`, …) and `X-Request-Id`.
5. **Frontend:** open http://localhost:5173 and sign in (see [Authentication](#authentication)).
   - The Dashboard shows live API and database status from `/api/health`, and the top-bar badge says "All systems operational".
   - As the owner, every sidebar link (Products, Inventory, Suppliers, Purchases, POS, Sales, Reports, Staff, Settings) opens its page. Unknown URLs show "Page not found".
   - Stop the backend: the badge changes to "API offline", and the Dashboard shows an error with a **Try again** button.
6. **Builds:** `npm run typecheck` and `npm run build` from the repo root.

## Authentication

### Roles

| Role        | Can open                                                                  | How the account is created             |
| ----------- | ------------------------------------------------------------------------- | -------------------------------------- |
| **Owner**   | Everything, including Staff and Settings                                  | Once, through the protected setup step |
| **Manager** | Dashboard, Products, Inventory, Suppliers, Purchases, POS, Sales, Reports | By the owner, on the Staff page        |
| **Cashier** | Dashboard, Products, POS, Sales                                           | By the owner, on the Staff page        |

Every user can open **Your account** (`/account`) to see their profile, change their password, and sign out of all devices.

The API enforces every rule. The UI only hides what a role can't use (`frontend/src/auth/permissions.ts`).

### First owner (one-time setup)

1. Generate a token and put it in `backend/.env`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # backend/.env  ->  SETUP_TOKEN=<that value>
   ```
2. Restart the API, open http://localhost:5173/setup, and enter the token with the owner's name, email, and password.
3. After that, remove `SETUP_TOKEN` from `.env`. Setup also refuses permanently once any user exists.

Several safeguards keep anyone from registering another owner:

- The endpoint requires a secret that only exists in the server environment.
- It works only while the `users` table is empty.
- Wrong-token attempts are rate-limited.
- The database has a partial unique index (`users_single_owner_key`) that allows only one `OWNER` row, so a race can't create two.
- Staff management never accepts `OWNER` as a role, and it can't modify the owner account.

### Sessions and security

| Concern             | Implementation |
| ------------------- | -------------- |
| Passwords           | bcryptjs, cost `BCRYPT_ROUNDS` (12; at least 10 in production). Policy: 10+ characters with a letter and a number, at most 72 bytes. |
| Session token       | 32 random bytes in an **HttpOnly** cookie. Only its SHA-256 hash is stored (`sessions.token_hash`), so a database leak can't be replayed. |
| Cookie flags        | `HttpOnly`, `SameSite=Strict` (configurable), `Path=/`, `Expires`. In production it's also `Secure` with the `__Host-` prefix. |
| Expiry              | Absolute `SESSION_TTL_HOURS` (12h) plus idle `SESSION_IDLE_TIMEOUT_MINUTES` (120m). Both are checked server-side on every request. |
| CSRF                | (1) Writes whose `Origin` isn't in `CORS_ORIGIN` are rejected. (2) Authenticated writes must send the session's synchronizer token in `X-CSRF-Token`. The SPA keeps it in memory only. |
| Revocation          | Logout ends that session. "Sign out of all devices", password change, owner password reset, and deactivation end all of the user's sessions. Signing in always issues a new session, which prevents session fixation. |
| Live authorization  | Role and active status are read from the database on each request, so a role change or deactivation applies immediately. |
| Brute force         | Failed sign-ins are limited per (IP, email) to `LOGIN_RATE_LIMIT_MAX` per window, with a per-IP cap of 5x. Unknown emails take as long as wrong passwords. |
| Temporary passwords | Staff accounts start with `must_change_password`. Until it's cleared, the API answers `403 PASSWORD_CHANGE_REQUIRED` everywhere except `/api/auth/*`, and the UI sends the user to `/change-password`. |

### Database changes (migration `20261023000000_auth_rbac`)

- Enum `Role` with values `OWNER`, `MANAGER`, `CASHIER`.
- Table `users`: `id` uuid, `email` (unique, stored lower-case), `name`, `password_hash`, `role`, `is_active`, `must_change_password`, `password_changed_at`, `last_login_at`, `created_by_id` (references users), timestamps. Indexes: unique `email`, `(role, is_active)`, and the partial unique `users_single_owner_key ON users(role) WHERE role = 'OWNER'`.
- Table `sessions`: `id`, `token_hash` (unique), `csrf_token`, `user_id` (references users, cascade delete), `ip_address`, `user_agent`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at`, `revoked_reason`. Indexes: `(user_id, revoked_at)` and `expires_at`.

### REST endpoints

Errors use the standard envelope `{ error: { code, message, details?, requestId } }`. Validation failures return `400 VALIDATION_ERROR`, with field issues in `details`.

| Method | Path                            | Access                 | Body                                    | Success |
| ------ | ------------------------------- | ---------------------- | --------------------------------------- | ------- |
| GET    | `/api/auth/setup`               | Public                 | -                                       | `200 { setupRequired, setupEnabled }` |
| POST   | `/api/auth/setup`               | Public + `SETUP_TOKEN` | `{ setupToken, name, email, password }` | `201` session response + cookie |
| POST   | `/api/auth/login`               | Public                 | `{ email, password }`                   | `200` session response + cookie |
| GET    | `/api/auth/me`                  | Signed in              | -                                       | `200` session response |
| POST   | `/api/auth/logout`              | Signed in + CSRF       | -                                       | `204`, cookie cleared |
| POST   | `/api/auth/logout-all`          | Signed in + CSRF       | -                                       | `204`, all of the user's sessions revoked |
| POST   | `/api/auth/change-password`     | Signed in + CSRF       | `{ currentPassword, newPassword }`      | `200` new session response + cookie |
| GET    | `/api/users?status=&role=`      | Owner                  | -                                       | `200 { users }` |
| POST   | `/api/users`                    | Owner + CSRF           | `{ name, email, role, password }`       | `201 { user }` (role is `MANAGER` or `CASHIER`) |
| GET    | `/api/users/:id`                | Owner                  | -                                       | `200 { user }` |
| PATCH  | `/api/users/:id`                | Owner + CSRF           | `{ name?, role? }`                      | `200 { user }` |
| POST   | `/api/users/:id/activate`       | Owner + CSRF           | -                                       | `200 { user }` |
| POST   | `/api/users/:id/deactivate`     | Owner + CSRF           | -                                       | `200 { user }`, their sessions revoked |
| POST   | `/api/users/:id/reset-password` | Owner + CSRF           | `{ password }`                          | `200 { user }`, sessions revoked, must change at next sign-in |

A session response is `{ user, csrfToken, session: { expiresAt } }`, and `user` never includes the password hash. Common error codes:

- `401`: `UNAUTHENTICATED`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS`
- `403`: `FORBIDDEN`, `CSRF_TOKEN_INVALID`, `ORIGIN_NOT_ALLOWED`, `ACCOUNT_DISABLED`, `PASSWORD_CHANGE_REQUIRED`, `OWNER_IMMUTABLE`, `INVALID_SETUP_TOKEN`
- `409`: `EMAIL_TAKEN`, `SETUP_ALREADY_COMPLETED`
- `429`: `TOO_MANY_ATTEMPTS`

### Tests

```bash
docker compose up -d postgres
cd backend && npm test
```

The suite boots the real Express app against the real `stockpilot_test` database. It applies migrations once, truncates tables before each test, and refuses to run unless the database name contains `test`. Settings live in `backend/.env.test`.

- `tests/auth.test.ts` covers setup (token, once only, concurrent race, DB-level single owner, token-guess throttling), login (cookie flags, hashed storage, uniform errors, deactivated accounts, rate limit, Origin check, fixation), sessions (forged, revoked, absolute and idle expiry, logout, logout-all, CSRF), password change (rotation, revoking other sessions, the temporary-password gate), and CORS.
- `tests/users.test.ts` covers RBAC on every staff endpoint for managers and cashiers, no self-promotion, no creating or promoting owners, owner immutability, duplicate emails, deactivation (immediate sign-out, sign-in blocked, reactivation), live role changes, password resets, and 404s.

### Manual check

1. Run `npm run dev:backend` and `npm run dev:frontend`, then open http://localhost:5173. You're redirected to `/login`, which links to setup.
2. Complete `/setup`. You land on the Dashboard as Owner, and the sidebar shows every section.
3. **Staff > Add staff member**: create a cashier and copy the temporary password.
4. In a private window, sign in as the cashier. You must choose a new password first. Afterwards the sidebar shows only Dashboard, Products, POS, and Sales, and opening `/staff` directly shows "You don't have access to this page".
5. As the owner, **Deactivate** the cashier. The cashier's next request sends them to sign-in with "Your session has ended", and signing in again reports the account is deactivated.
6. Enter a wrong password six times: the sixth attempt is rate-limited.

## Catalog: products and categories

### Who can do what

| Action                                               | Owner | Manager | Cashier |
| ---------------------------------------------------- | :---: | :-----: | :-----: |
| Browse and search active products, list categories   |  yes  |   yes   |   yes   |
| See cost prices and margins, view archived products  |  yes  |   yes   |   no    |
| Create, edit, archive and restore products           |  yes  |   yes   |   no    |
| Create, rename and delete categories                 |  yes  |   yes   |   no    |

For cashiers, the API leaves `costPrice` out of every response. It returns `403` if a cashier asks for archived products or tries to sort by cost.

### Prisma models (migration `20261023120000_catalog`)

**`Category`** (`categories`): `id`, `name`, `name_key` (unique), `description`, timestamps.
- `name_key` is the name lower-cased with whitespace collapsed, so "Soft Drinks" and " soft  drinks" count as the same category.

**`Product`** (`products`):

| Column              | Type            | Notes |
| ------------------- | --------------- | ----- |
| `sku`               | varchar(64)     | Stored upper-cased. **Unique across all products, archived included**, so an SKU on an old invoice always identifies one product. |
| `barcode`           | varchar(64)?    | **Unique among active products only** (partial index `products_active_barcode_key ... WHERE archived_at IS NULL AND barcode IS NOT NULL`). A manufacturer barcode can move to a new product once the old one is archived. Many products may have no barcode. |
| `name`, `description` | varchar        | |
| `cost_price`, `selling_price` | decimal(12,2) | Exact decimal storage. The API always sends and receives strings like `"12.50"`, never floats. |
| `reorder_threshold` | int, default 0  | Used by the inventory phase for low-stock alerts. |
| `category_id`       | uuid?           | FK with `ON DELETE RESTRICT`. Empty means "Uncategorized". |
| `archived_at`, `archived_by_id` | | Archive marker and who archived it. |
| `created_by_id`, `updated_by_id`, timestamps | | Audit trail (FK to `users`, `ON DELETE SET NULL`). |

Indexes cover `(archived_at, name)`, `category_id`, `selling_price`, and `created_at`, so the default listing, filters, and sorts stay index-backed.

The migration also adds things Prisma can't model. Prisma ignores both when diffing, so they cause no drift:
- `CHECK` constraints that keep both prices and the reorder threshold non-negative.
- The trigger `products_prevent_delete`, described next.

### Why archiving can never break historical invoices

Products are **archived, never deleted**:
1. The API has no delete route for products (`DELETE /api/products/:id` returns 404).
2. The trigger `products_prevent_delete` rejects any `DELETE` on `products` with SQLSTATE `23001`. This holds for every client: the API, Prisma Studio, or raw SQL.
3. An archived product keeps its row, SKU, prices, and category. Its SKU is never reissued, and archived products can't be edited, so what an invoice points at doesn't change underneath it.
4. Categories that still hold products, archived ones included, can't be deleted (API check plus FK `RESTRICT`).
5. The sales and purchase phases will reference products with `ON DELETE RESTRICT` and copy the SKU, name, and price onto each line at the time of sale, so an invoice stays correct even if a product is later renamed or repriced.

Restoring a product fails with `409` if another active product has since taken its barcode.

### REST endpoints

All endpoints require a session. Writes also require the `X-CSRF-Token` header and the Owner or Manager role.

| Method | Path                           | Body / query | Success |
| ------ | ------------------------------ | ------------ | ------- |
| GET    | `/api/products`                | `page` (1), `pageSize` (20, max 100), `search` (name/SKU/barcode, case-insensitive), `categoryId` (uuid or `none`), `status` (`active`/`archived`/`all`), `sort` (`name`, `sku`, `sellingPrice`, `costPrice`, `reorderThreshold`, `createdAt`, `updatedAt`), `order` (`asc`/`desc`), `minPrice`, `maxPrice` | `200 { items, page, pageSize, total, totalPages }` |
| GET    | `/api/products/:id`            | - | `200 { product }` |
| POST   | `/api/products`                | `{ sku, barcode?, name, description?, costPrice, sellingPrice, categoryId?, reorderThreshold? }` | `201 { product }` |
| PATCH  | `/api/products/:id`            | Any subset of the create fields | `200 { product }` |
| POST   | `/api/products/:id/archive`    | - | `200 { product }` (idempotent) |
| POST   | `/api/products/:id/restore`    | - | `200 { product }` |
| GET    | `/api/categories`              | - | `200 { categories }`, each with `productCount` (active) and `totalProductCount` |
| POST   | `/api/categories`              | `{ name, description? }` | `201 { category }` |
| PATCH  | `/api/categories/:id`          | `{ name?, description? }` | `200 { category }` |
| DELETE | `/api/categories/:id`          | - | `204` |

Errors you can expect:
- `400 VALIDATION_ERROR`, with field issues in `details`.
- `409 DUPLICATE_VALUE`, with `details` naming each clashing field, e.g. `[{ "path": ["sku"], "message": "..." }]`. If the SKU and barcode both clash, both are reported.
- `409 PRODUCT_ARCHIVED` (restore before editing).
- `409 CATEGORY_IN_USE`.
- `403 FORBIDDEN`.

Duplicates are checked before writing so the response names the field. The unique indexes still decide when two requests race, and those errors are translated into the same `409`.

### Frontend components

| File | Purpose |
| ---- | ------- |
| `pages/ProductsPage.tsx` | Products page: debounced search, category/status/sort filters, pagination. All of it lives in the URL, so it survives reloads and works with Back. Keeps the previous page on screen while the next loads. Has empty and error states, and only shows management actions to management roles. |
| `components/products/ProductTable.tsx` | Sortable table (`aria-sort` headers) showing price, cost and margin (managers), and status. Below 760px each row becomes a labelled card. |
| `components/products/ProductFormDialog.tsx` | Create/edit dialog with a live margin hint and a below-cost warning. Server field errors (such as a duplicate SKU) land on the matching input. |
| `components/products/productFormSchema.ts` | The Zod schema that validates the form and converts its strings into the API payload. Mirrors `backend/src/validators/catalog.schemas.ts`. |
| `components/products/CategoryManagerDialog.tsx` | Add, rename and delete categories inline. Delete is disabled, with an explanation, while products use the category. |
| `components/Dialog.tsx`, `ConfirmDialog.tsx` | Modal on the native `<dialog>` element, so focus trapping, Escape, and focus restore come built in. It can't be closed mid-save, and it goes full-screen on phones. |
| `components/Pagination.tsx`, `components/Field.tsx` | Reusable pager, and a label/hint/error wrapper for selects and textareas. |
| `services/catalogService.ts`, `types/catalog.ts` | API client and types. |

Prices display in `VITE_CURRENCY` (default `USD`, set in `frontend/.env`) until store settings exist.

### Tests

`npm test` in `backend/` now runs 91 tests. The catalog adds two files:
- `tests/products.test.ts` covers role checks (cashier read-only, no cost or archived data), CSRF, creation (normalization, exact decimals, blank optional fields, nine validation cases, unknown category), SKU uniqueness including archived products, barcode uniqueness only among active products, concurrent duplicate requests resolved by the database, the DB price checks, partial updates and audit fields, no editing archived products, archive (idempotent, hidden from the default list, no delete route, delete trigger), restore including the barcode conflict, and listing (pagination, search, filters, sorting, query validation).
- `tests/categories.test.ts` covers listing with counts, role checks, case- and space-insensitive uniqueness, rename, and delete rules including the FK.

### Manual check

1. Sign in as owner or manager and open **Products**. Click **Categories** and add "Drinks" and "Snacks".
2. Click **New product**. Submit it empty to see the inline errors, then fill it in. Enter a selling price below cost to see the warning.
3. Create a second product with the same SKU in lower case. The SKU field reports the clash.
4. Add a few more products, then try search, the category filter, sorting (headers or dropdown), and paging. Reload the page: the filters stay.
5. Archive a product. It leaves the list, and **Status > Archived** shows it with **Restore**.
6. Narrow the window below 760px: rows become cards, and dialogs go full-screen.
7. Sign in as a cashier. There are no buttons, no cost column, and no status filter.

## Inventory

### Who can do what

| Action                                              | Owner | Manager | Cashier |
| --------------------------------------------------- | :---: | :-----: | :-----: |
| View on-hand stock and low-stock status per store   |  yes  |   yes   |   yes   |
| Adjust stock (with a mandatory reason)              |  yes  |   yes   |   no    |
| View movement history (who, when, how much, why)    |  yes  |   yes   |   no    |
| Add, rename, deactivate stores (Settings)           |  yes  |   no    |   no    |

### Prisma models (migration `20261023180000_inventory`)

- **`Store`** (`stores`): `name`, unique upper-cased `code`, and `is_active`. The migration seeds **Main Store (`MAIN`)**. Stores are deactivated, never deleted, and at least one must stay active.
- **`InventoryLevel`** (`inventory_levels`): primary key `(product_id, store_id)`, plus `quantity` and `updated_at`.
  - A missing row means 0 on hand, so products from the catalog phase need no backfill.
  - `CHECK (quantity >= 0)`.
- **`StockMovement`** (`stock_movements`): the append-only ledger of **every** change.
  - Columns: `type` (`ADJUSTMENT` for now; sales, purchases and transfers add values later), signed `quantity_change`, `quantity_before`, `quantity_after`, `reason`, `note`, `created_by_id`, `created_at`.
  - Constraints:
    - change is never 0
    - `after = before + change`
    - neither side is ever negative
    - adjustments must carry a reason
  - The trigger `stock_movements_immutable` rejects `UPDATE` and `DELETE`. A mistake is fixed with a new, correcting adjustment.
- Enum **`AdjustmentReason`**: `STOCK_COUNT`, `RECEIVED`, `CUSTOMER_RETURN`, `DAMAGED`, `EXPIRED`, `LOST`, `THEFT`, `RETURNED_TO_SUPPLIER`, `OTHER`.
  - The API enforces direction: `RECEIVED` and `CUSTOMER_RETURN` only add stock; damage, expiry, loss, theft and supplier returns only remove it.
  - A counted quantity must use `STOCK_COUNT` or `OTHER`.
  - `OTHER` requires a note.

For every (product, store), the sum of `quantity_change` equals the current `quantity`. The concurrency tests assert this.

### How stock changes stay correct under concurrency

Every change goes through `applyStockChange(tx, change)` in `backend/src/services/inventory.service.ts`, inside a PostgreSQL transaction:

1. `INSERT ... ON CONFLICT DO NOTHING` makes sure the `(product, store)` row exists, so a product that was never stocked still has something to lock.
2. `SELECT quantity ... FOR UPDATE` locks that row. Concurrent changes to the same product in the same store queue here, and each one reads the result the previous one committed.
3. The new quantity is computed and checked on the server:
   - not below zero (`409 INSUFFICIENT_STOCK`)
   - not a no-op (`409 NO_STOCK_CHANGE`)
   - optionally, still what the user was looking at (`expectedQuantity`, otherwise `409 STOCK_CHANGED`)
4. The row is updated and the movement is inserted in the same transaction. Either both happen or neither does.

The `CHECK` constraints are a final safety net if application code ever gets it wrong. Frontend checks only give quick feedback; the server re-validates everything.

Purchase receipts (and, later, sales) call `applyStockChange` for each line inside their own transaction. To avoid deadlocks, they lock lines in a consistent order (by `productId`).

### REST endpoints

| Method | Path | Access | Body / query | Success |
| ------ | ---- | ------ | ------------ | ------- |
| GET | `/api/stores` | All | `includeInactive=true` (owner only) | `200 { stores }` |
| POST | `/api/stores` | Owner + CSRF | `{ name, code }` | `201 { store }` |
| PATCH | `/api/stores/:id` | Owner + CSRF | `{ name?, code?, isActive? }` | `200 { store }` |
| GET | `/api/inventory` | All | `storeId` (required), `page`, `pageSize`, `search`, `categoryId` (uuid or `none`), `stockStatus` (`all`, `needs_reorder`, `low`, `out`, `ok`), `sort` (`name`, `sku`, `quantity`, `reorderThreshold`, `updatedAt`), `order` | `200 { items, page, pageSize, total, totalPages, summary: { products, units, low, out } }` |
| POST | `/api/inventory/adjustments` | Owner/Manager + CSRF | `{ storeId, productId, mode: "change" \| "set", quantity, reason, note?, expectedQuantity? }` | `201 { level, movement }` |
| GET | `/api/inventory/movements` | Owner/Manager | `storeId`, `productId`, `reason`, `userId`, `from`, `to` (ISO), `page`, `pageSize` | `200 { items, ... }`, newest first, each with product, store and `createdBy { id, name }` |

How the two adjustment modes and the stock status work:
- In `mode: "change"`, `quantity` is a signed delta (`-3` removes three). In `mode: "set"`, it's the counted on-hand quantity.
- **Stock status:** `OUT` when on hand is 0, `LOW` when on hand is at or below the product's reorder threshold, otherwise `OK`.

Errors you can expect:
- `400 VALIDATION_ERROR`
- `409`: `INSUFFICIENT_STOCK`, `STOCK_CHANGED`, `NO_STOCK_CHANGE` (each with `details.currentQuantity`), `PRODUCT_ARCHIVED`, `STORE_INACTIVE`, `LAST_ACTIVE_STORE`
- `403 FORBIDDEN`

### Frontend components

| File | Purpose |
| ---- | ------- |
| `pages/InventoryPage.tsx` | Store picker (remembered per browser), summary tiles (clicking Low or Out filters the list), stock table with search, category and status filters, sorting and paging (all in the URL), and a **Movement history** tab for management. |
| `components/inventory/StockTable.tsx` | Responsive table of on-hand quantity, reorder level, status badge and last change, with **Adjust** and **History** actions. |
| `components/inventory/AdjustStockDialog.tsx` | Add stock / Remove stock / Set counted quantity. Shows a live "on hand → after" preview and only offers reasons that fit the chosen action. Sends `expectedQuantity`; if someone changed the stock meanwhile, the dialog shows the new number and asks again instead of applying a stale decision. |
| `components/inventory/adjustmentSchema.ts` | Zod validation for the form, mirroring the API's rules. |
| `components/inventory/MovementHistory.tsx` | History filtered by product, reason and date range, showing date, product, change, before → after, reason and note, and staff name. |
| `components/settings/StoresSection.tsx` | Owner's store list on the Settings page: add, activate and deactivate stores. |
| `hooks/useSearchParamsUpdater.ts` | Shared URL-state helper, now also used by the Products page. |

### Tests

`npm test` in `backend/` now runs 135 tests. `tests/inventory.test.ts` adds 44:
- **Authorization:** cashiers can view stock but can't adjust it or read history. CSRF is required.
- **Adjustments:** add, remove, set count, refusing to go negative (with nothing written), no-op adjustments, stale `expectedQuantity`, separation between stores, archived products and inactive stores, unknown ids, and 13 validation cases (fractions, strings, zero, oversized quantities, reason/direction mismatches, `OTHER` without a note, unknown fields).
- **Database guarantees:** the negative-stock CHECK, ledger immutability, and the ledger arithmetic constraint.
- **Concurrency:**
  - 20 simultaneous removals of 1 from a stock of 10 give exactly 10 successes, 10 `INSUFFICIENT_STOCK`, a final 0, and the serialized before-values 10 down to 1.
  - 15 simultaneous additions to a never-stocked product lose no updates.
  - A mixed burst of additions and removals keeps on-hand equal to the start plus the successful changes, and equal to the ledger sum.
  - Two counts based on the same quantity: exactly one wins and the other gets `STOCK_CHANGED`.
- **Listing:** statuses, summary, status filters, search with literal `%` and `_`, sorting and paging, per-store quantities, query validation. Also movement history filters and paging, and store management rules.

### Manual check

1. As owner or manager, open **Inventory**. Products from the catalog show 0 on hand and "Out of stock".
2. **Adjust** a product: Add stock, quantity 12, reason Received. The preview reads 0 → 12, the row updates, and the summary tiles change.
3. Remove 20. The form stops you ("Only 12 on hand"), and the API would refuse even if it didn't.
4. Open the same Adjust dialog in two tabs and save a change in one. Saving in the other says the stock changed and shows the new number.
5. Click **History** on the row. It lists both movements with your name, the date, the change, and before → after.
6. In **Settings**, add a second store, then switch stores on the Inventory page. Its stock is separate.
7. Sign in as a cashier. Inventory is visible, with no Adjust buttons and no history tab.

## Suppliers and purchasing

Phase 5 completion: see [API contract, payment rules, validation results, and full changed-file manifest](docs/phase5.md).

### Who can do what

Purchasing shows costs and supplier terms, so it's management-only. Supplier and purchase operations require an owner or manager; recording payments requires the owner. Cashiers get `403`.

| Action | Owner | Manager | Cashier |
| ------ | :---: | :-----: | :-----: |
| Add, edit, deactivate, delete suppliers | yes | yes | no |
| Create and edit draft purchase orders | yes | yes | no |
| Place, cancel and receive purchase orders | yes | yes | no |
| Purchase history, supplier report, audit log | yes | yes | no |
| Record supplier payments | yes | no | no |

### Order lifecycle

```
DRAFT ──place──▶ ORDERED ──receive (some)──▶ PARTIALLY_RECEIVED ──receive (rest)──▶ RECEIVED
  │                 │                               │
  └──cancel──▶ CANCELLED ◀──cancel──────────────────┘
```

- **Draft:** editable. Saving sends the whole order and replaces every line. A draft may have no lines; placing it needs at least one.
- **Placing** (`DRAFT → ORDERED`) fixes the lines. Stock doesn't change: inventory goes up only when goods are received.
- **Receiving** books one delivery. Lines can be received partially, over several deliveries, in any mix. The order becomes `RECEIVED` when nothing is outstanding.
- **Cancelling** works for drafts and open orders unless payments exceed the value already received. On a partially received order it cancels only the outstanding remainder; stock already received stays, and so do its receipts. Received and cancelled orders can't be cancelled.

### Database changes (migration `20261023200000_purchasing`)

New tables:

- **`Supplier`** (`suppliers`): `name`, unique `name_key` (lower-cased, single-spaced, so "Acme  Foods" and "acme foods" clash), `contact_name`, `email`, `phone`, `address`, `payment_terms`, `notes`, `is_active`, created/updated by and timestamps.
  - Deleted only while it has no purchase orders (`ON DELETE RESTRICT` from `purchase_orders`); otherwise deactivated.
- **`PurchaseOrder`** (`purchase_orders`): `number` (a `SERIAL`, shown as `PO-00042`), `supplier_id`, `store_id` (where goods are delivered), `status`, `expected_at` (`DATE`), `note`, `total` (`DECIMAL(14,2)`), `ordered_at`/`ordered_by_id`, `received_at`, `cancelled_at`/`cancelled_by_id`/`cancel_reason`, `created_by_id`, timestamps.
  - CHECKs: `total >= 0`; open and received orders have `ordered_at`; `received_at` is set exactly when `RECEIVED`; `cancelled_at` is set exactly when `CANCELLED`.
- **`PurchaseOrderLine`** (`purchase_order_lines`): `product_id`, `position`, snapshot `sku` and `product_name`, `quantity_ordered`, `quantity_received`, `unit_cost` (`DECIMAL(12,2)`), `line_total` (`DECIMAL(14,2)`). Unique `(purchase_order_id, product_id)`: one line per product.
  - CHECKs: `quantity_ordered > 0`; `0 <= quantity_received <= quantity_ordered` (the database-level over-receipt guard); `unit_cost >= 0`; `line_total = quantity_ordered * unit_cost`.
- **`PurchaseReceipt`** (`purchase_receipts`): one delivery: `purchase_order_id`, unique `idempotency_key` (UUID), `note`, `received_by_id`, `received_at`.
- **`PurchaseReceiptLine`** (`purchase_receipt_lines`): `receipt_id`, `purchase_order_line_id`, `product_id`, `quantity > 0`, snapshot `unit_cost`. Unique `(receipt_id, purchase_order_line_id)`.
- **`AuditLog`** (`audit_logs`): `action` (e.g. `purchase_order.received`), `entity_type`, `entity_id`, `actor_id`, `details` (JSONB), `created_at`. Indexed by entity and by time.

Changes to existing tables:

- `StockMovementType` gains **`PURCHASE_RECEIPT`**.
- `stock_movements` gains a nullable **`purchase_receipt_id`** (FK to `purchase_receipts`, indexed). A CHECK requires it exactly for `PURCHASE_RECEIPT` movements, so every received unit traces back to its delivery and order.

Triggers: `purchase_receipts`, `purchase_receipt_lines` and `audit_logs` are append-only (`prevent_history_change()` rejects `UPDATE` and `DELETE`), like the stock ledger.

Money is always `DECIMAL` in the database, `Prisma.Decimal` in the API, and a 2-decimal string on the wire. Totals are computed with decimal arithmetic on the server (and with integer cents in the editor's preview), so `3 × 0.10` is exactly `0.30`.

### How receiving stays correct

`receivePurchaseOrder()` in `backend/src/services/purchaseOrder.service.ts` does everything in **one Prisma interactive transaction**:

1. `SELECT ... FOR UPDATE` locks the order row. Concurrent receipts, cancellations and edits of the same order run one at a time, each seeing the previous one's committed result.
2. **Idempotency:** if a receipt with the request's `idempotencyKey` exists, the original result is returned (`200`, `replayed: true`) and nothing changes. A key used for a different order is refused (`409 IDEMPOTENCY_KEY_REUSED`). The unique index backs this up.
3. Status check: drafts (`ORDER_NOT_PLACED`), received (`ALREADY_RECEIVED`) and cancelled (`ORDER_CANCELLED`) orders refuse receipts; so does an inactive store.
4. **Over-receipt check** against the locked, current received quantities. If any line exceeds what's outstanding, the whole receipt is refused (`409 OVER_RECEIPT`, with the offending lines in `details`).
5. Creates the receipt; then, for each line sorted by `productId`: `applyStockChange()` (inventory row lock, quantity increase, `PURCHASE_RECEIPT` movement linked to the receipt), the receipt line, and `quantity_received += n`.
6. Sets the new status, writes the `purchase_order.received` audit entry, and returns the updated order.

If any step fails (for example a quantity that would exceed the on-hand maximum), the transaction rolls back: no stock, movements, receipt or status change.

The frontend persists the exact receipt/payment request and idempotency key in session storage, scoped to the signed-in user and order. Retries after a lost response, navigation, refresh, or authentication/CSRF failure reuse that payload. A different quantity or note with an already-used receipt key is rejected. Only a definitive business rejection or a confirmed success resolves the attempt.

### Audit log

Written in the same transaction as the change, so an event exists if and only if the change committed:

`supplier.created`, `supplier.updated` (with `{ field: { from, to } }`), `supplier.deactivated`, `supplier.reactivated`, `supplier.deleted`, `purchase_order.created`, `purchase_order.updated`, `purchase_order.ordered`, `purchase_order.received` (receipt id, units, value, new status), `purchase_order.cancelled` (previous status, reason, units cancelled).

Stock changes are additionally recorded in the stock movement ledger, as before.

### REST endpoints (compatible original routes)

The frontend now uses `/api/purchases`, `PATCH /:id`, and `POST /:id/submit`. The original `/api/purchase-orders` routes below remain supported. New status, receipt-list and payment routes are documented in [Phase 5](docs/phase5.md#api-contract).

| Method | Path | Body / query | Success |
| ------ | ---- | ------------ | ------- |
| GET | `/api/suppliers` | `page`, `pageSize`, `search` (name, contact, email, phone), `status` (`active`, `inactive`, `all`), `sort` (`name`, `createdAt`, `updatedAt`), `order` | `200 { items, page, pageSize, total, totalPages }`, each with `stats` |
| GET | `/api/suppliers/report` | `from`, `to` (ISO) | `200 { from, to, rows: [{ supplier, stats }], totals }` |
| GET | `/api/suppliers/:id` | | `200 { supplier }` with `stats` and `activity` |
| POST | `/api/suppliers` | `{ name, contactName?, email?, phone?, address?, paymentTerms?, notes? }` | `201 { supplier }` |
| PATCH | `/api/suppliers/:id` | any of the above, plus `isActive` | `200 { supplier }` |
| DELETE | `/api/suppliers/:id` | | `204` (only without orders) |
| GET | `/api/purchase-orders` | `page`, `pageSize`, `search` (PO number, supplier, SKU, product name), `status`, `open=true`, `supplierId`, `storeId`, `productId`, `from`, `to`, `sort` (`number`, `createdAt`, `expectedAt`, `total`), `order` | `200 { items, ..., statusCounts }` |
| GET | `/api/purchase-orders/:id` | | `200 { order }` with lines, receipts and activity |
| POST | `/api/purchase-orders` | `{ supplierId, storeId, expectedAt? (yyyy-mm-dd), note?, lines: [{ productId, quantity, unitCost }] }` | `201 { order }` (a draft) |
| PUT | `/api/purchase-orders/:id` | same as POST; drafts only | `200 { order }` |
| POST | `/api/purchase-orders/:id/order` | | `200 { order }` |
| POST | `/api/purchase-orders/:id/cancel` | `{ reason? }` | `200 { order }` |
| POST | `/api/purchase-orders/:id/receipts` | `{ idempotencyKey (uuid), note?, lines: [{ lineId, quantity }] }`; zero quantities are ignored | `201 { replayed: false, receiptId, order }` or `200 { replayed: true, ... }` |
| GET | `/api/audit-logs` | `entityType`, `entityId`, `action`, `actorId`, `from`, `to`, `page`, `pageSize` | `200 { items, ... }` |

All writes need the CSRF header. `/api/inventory/movements` also accepts `type=PURCHASE_RECEIPT`, and each movement now includes `purchaseOrder { id, number }` when it came from a receipt.

**Supplier stats:** `orderCount` (placed orders, cancelled included), `openOrders`, `draftOrders`, `orderedValue` (placed, not cancelled), `receivedValue`, `unitsReceived`, `outstandingValue` (open orders, always as of now), `averageLeadTimeDays` (order placed → first delivery), `lastOrderedAt`. In the report, the date range limits orders by `ordered_at` and received value by delivery date.

Errors you can expect:
- `400 VALIDATION_ERROR` / `BAD_REQUEST` (unknown or archived product, unknown supplier/store, order total too large), with `details[].path` such as `["lines", 2, "quantity"]`
- `409`: `DUPLICATE_VALUE`, `SUPPLIER_HAS_ORDERS`, `SUPPLIER_INACTIVE`, `STORE_INACTIVE`, `INVALID_STATUS`, `EMPTY_ORDER`, `PRODUCT_ARCHIVED`, `ORDER_NOT_PLACED`, `ALREADY_RECEIVED`, `ORDER_CANCELLED`, `OVER_RECEIPT`, `IDEMPOTENCY_KEY_REUSED`
- `403 FORBIDDEN` for cashiers, `404 NOT_FOUND`

### Backend files

| File | Purpose |
| ---- | ------- |
| `prisma/schema.prisma` | New models `Supplier`, `PurchaseOrder`, `PurchaseOrderLine`, `PurchaseReceipt`, `PurchaseReceiptLine`, `AuditLog`; `PURCHASE_RECEIPT` movement type and `purchaseReceiptId` link. |
| `prisma/migrations/20261023200000_purchasing/migration.sql` | Generated DDL plus the hand-written CHECKs and immutability triggers. |
| `src/services/supplier.service.ts` | Supplier CRUD with audit entries; supplier stats and report (one SQL query, exact `NUMERIC` sums). |
| `src/services/purchaseOrder.service.ts` | Drafts, placing, cancelling, receiving; DTOs with exact totals. |
| `src/services/audit.service.ts` | `recordAudit(tx, …)`, change diffs, audit log listing. |
| `src/services/inventory.service.ts` | `applyStockChange` accepts `purchaseReceiptId`; `TRANSACTION_OPTIONS` is exported; movements carry their purchase order. |
| `src/validators/purchasing.schemas.ts`, `audit.schemas.ts` | Zod request schemas. |
| `src/controllers/purchasing.controller.ts`, `src/routes/purchasing.routes.ts` | `/api/suppliers`, `/api/purchase-orders`, `/api/audit-logs`. |
| `src/utils/documentNumbers.ts` | `PO-00042` formatting and parsing (for search). |

### Frontend components

| File | Purpose |
| ---- | ------- |
| `pages/SuppliersPage.tsx` | Supplier list (search, status filter, open orders, outstanding and ordered value), add/edit, archive/reactivate action menus, and a **Purchasing report** tab. |
| `pages/SupplierDetailPage.tsx` | Supplier figures, contact card, paged purchase history, activity log, "New purchase order" for that supplier. |
| `pages/PurchasesPage.tsx` | Purchase history: status tabs with counts (including "Awaiting delivery"), search, supplier and store filters, sorting and paging in the URL. |
| `pages/PurchaseOrderEditorPage.tsx` | Create and edit drafts: supplier (with payment terms), store, expected date, product lines with exact live totals, "Save draft" or "Save & mark as ordered". Server errors land on the exact line and field. |
| `pages/PurchaseOrderDetailPage.tsx` | Order header and receipt progress, lines (ordered, received, due), totals, deliveries, activity, and the actions allowed in the current status. |
| `components/purchasing/ReceiveStockDialog.tsx` | Enter what arrived per line ("Fill all outstanding" for a full delivery), with over-receipt checks and an idempotency key per attempt. |
| `components/purchasing/ProductPicker.tsx` | Product search by name, SKU or barcode; Enter adds an exact SKU/barcode match (works with scanners). Unit cost defaults to the product's cost price. |
| `components/purchasing/SupplierFormDialog.tsx` | Supplier form with a Zod schema mirroring the API. |
| `components/purchasing/PurchaseOrderTable.tsx`, `PurchaseStatusBadge.tsx`, `ActivityLog.tsx`, `SupplierReportView.tsx`, `purchasingLabels.ts` | Shared table, status badge, audit timeline, report and labels. |
| `services/purchasingService.ts`, `types/purchasing.ts`, `lib/money.ts` | API client, types, and BigInt-cents money helpers. |
| `components/inventory/MovementHistory.tsx` | Purchase receipts show as "Purchase receipt · PO-00042", linking to the order. |

Routes: `/suppliers/:id`, `/purchases/new` (`?supplier=` preselects), `/purchases/:id`, `/purchases/:id/edit`, all under the same owner/manager rule as their parent page.

### Tests

`npm test` in `backend/` now runs 203 tests. The original purchasing suite contains 48 tests, and `tests/purchasePayments.test.ts` adds 20 payment, API contract and retry-integrity tests. Three Playwright browser tests cover the connected UI, lost-response recovery and roles. See [commands and results](docs/phase5.md#verification).
- `tests/suppliers.test.ts` (18): authorization and CSRF; create with normalization and audit entry; blank optional fields; 5 validation cases; duplicate names ignoring case and spacing; update/deactivate/reactivate with the recorded changes; deleting only suppliers without orders; listing, search, status filters and paging; the report's ordered, received and outstanding values, cancelled orders excluded, totals and date range.
- `tests/purchaseOrders.test.ts` (30):
  - **Drafts:** exact totals (`3 × 0.10 = 0.30`), sequential numbers, 7 validation cases, duplicate products, unknown or archived products, inactive suppliers, replacing lines and recomputing the total.
  - **Status changes:** placing locks editing; empty orders and since-archived products can't be placed; what can and can't be cancelled; cancelling a partial order keeps received stock and blocks further receipts.
  - **Receiving:** not against drafts; partial then full receipt, checking stock, the ledger sum, movements linked to receipts and visible in the movement history, status, `received_at` and the audit trail; over-receipt refused with nothing written; foreign lines and empty receipts rejected; idempotent replay; **5 concurrent submits with one key receive once**; **6 concurrent receipts of 4 against 10 ordered: exactly 2 succeed, 8 received, never more**; **rollback** when a stock update fails mid-receipt; inactive store.
  - **Database guarantees:** the over-receipt and line-total CHECKs, and immutable receipts and audit log.
  - **History:** status, open, supplier, product and text filters, status counts, sorting, and the audit log endpoint.

### Manual check

1. As owner or manager, open **Suppliers** → **New supplier**. Add one with payment terms "Net 30".
2. **Purchases** → **New purchase order**. Choose the supplier; its terms show under the field. Search a product and add it; scan or type an exact SKU and press Enter to add another. Change quantities and costs; line totals and the order total update.
3. **Save draft**. Inventory hasn't changed. **Edit draft**, then **Mark as ordered**. The Edit button disappears.
4. **Receive stock**. Enter more than ordered for a line: the dialog refuses. Receive part of it. The order becomes "Partially received", and Inventory → Movement history shows "Purchase receipt · PO-…".
5. Receive the rest with **Fill all outstanding**. The order becomes "Received" and the activity list shows every step.
6. Open the supplier: purchase history and figures reflect the order. Check **Suppliers → Purchasing report**.
7. Sign in as a cashier: Suppliers and Purchases aren't in the menu, and the API returns 403.

## Project layout

```
backend/
  prisma/schema.prisma        Role, User, Session, Category, Product, Store, InventoryLevel, StockMovement,
                              Supplier, PurchaseOrder(+Line), PurchaseReceipt(+Line), AuditLog
  prisma/migrations/          SQL migrations (apply with `npm run prisma:deploy`)
  prisma.config.ts            Prisma 7 CLI config (schema, migrations, DATABASE_URL)
  src/
    config/env.ts             zod-validated environment
    lib/logger.ts             pino logger (pretty in dev, JSON otherwise)
    lib/prisma.ts             single PrismaClient using the pg driver adapter
    middleware/               logging, 404, errors, auth (requireAuth/requireRole), CSRF, rate limits
    controllers/, routes/     /api/health, /api/auth, /api/users, /api/products, /api/categories,
                              /api/stores, /api/inventory, /api/suppliers, /api/purchase-orders,
                              /api/audit-logs
    services/                 auth, session, user, product, category, store, inventory, supplier,
                              purchase order and audit logic
    validators/               zod request schemas (password policy, money, SKU/barcode rules)
    lib/password.ts           bcrypt hashing and timing-safe verification
    lib/sessionCookie.ts      session cookie name and flags
    utils/AppError.ts         typed operational errors
    app.ts, server.ts         app factory, startup, and graceful shutdown
  tests/                      vitest + supertest integration tests (real PostgreSQL)
frontend/
  src/
    config/env.ts             typed VITE_* configuration
    auth/                     AuthProvider, useAuth, route guards, role-to-page access map
    services/                 axios client (CSRF header, 401 handling), ApiError, auth/user services
    lib/                      QueryClient + query keys
    providers/                app-wide providers (TanStack Query + devtools)
    routes/                   paths, nav config, router (lazy-loaded pages)
    layouts/                  AppLayout (sidebar + top bar), AuthLayout
    components/               dialogs, form fields, pagination, loaders, error states, page chrome
    components/products/      product table, product form dialog + Zod schema, category manager
    components/inventory/     stock table, adjustment dialog + Zod schema, movement history
    components/purchasing/    supplier form, order table, product picker, receive dialog, report, activity log
    components/settings/      store management
    pages/                    Dashboard, Products, … Login, NotFound
```
