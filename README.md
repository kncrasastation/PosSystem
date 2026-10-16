# Food Court POS

A responsive, multi-branch food court POS and ingredient inventory system (Next.js + Supabase).

## Status

**Current version: working UI with an in-memory demo backend.** Supabase is not connected yet.

| Phase | Scope | State |
|---|---|---|
| UI + demo backend | POS, orders board, dashboard, products, stock view, all backed by an in-memory repository | **Done** |
| 1a | Database access control: RLS policies, role/branch helpers, owner bootstrap, DB test harness | **Done** (SQL only, not wired to the app) |
| 1b | Supabase Auth login, Supabase repository implementation, Realtime | Next |
| 2 | `create_order` RPC with transactional deduction, recipes management, ingredient management | Planned |
| 3 | Purchases, wastage, stock counts & variance, movement history, controlled reversal | Planned |
| 4 | Fuller sales and inventory reports | Planned |

### Demo mode

`npm run dev`, open http://localhost:3000 and pick a user:

| User | Role | Access |
|---|---|---|
| Owner | OWNER | All branches, every page |
| Aminah | STAFF | Main Branch: POS + Orders |
| Ben | STAFF | Mall Branch: POS + Orders |

Data (2 branches, 6 products, 8 ingredients with recipes and opening stock) lives in server memory and **resets when the server restarts**. The demo login is a plain cookie with no password; it is for local evaluation only and must not be deployed.

### How the app is structured

```
src/app/b/[branchId]/{pos,orders,dashboard,products,stock}   pages (dashboard/products/stock: owner only)
src/app/actions/*.ts      server actions: Zod validation → repository
src/server/domain.ts      domain types + Repository interface (the backend contract)
src/server/memory-*.ts    in-memory Repository + seed data (current backend)
src/server/repository.ts  single swap point: memory now, Supabase later
src/server/session.ts     demo session + page guards
src/lib/                  money (integer sen), quantities (integer thousandths), dates, uuid
src/i18n/                 UI strings (English; structured for adding Chinese)
```

The Repository enforces authorization in every method (owner vs staff, branch assignment), so pages and actions cannot bypass it. The in-memory implementation applies the same business rules the database will:
- server-side prices and name/price snapshots on order items
- ingredient usage aggregated across the whole order, then checked and deducted all-or-nothing
- rejection naming the short ingredient
- idempotency key per submission (retries and double-taps never deduct twice)
- a stock movement for every deduction
- cancellation never restores stock
- per-branch, per-day order numbers

**Payment:** staff choose **QR Pay** or **Cash** on the POS before submitting. For cash, type the amount received or tap note buttons (1, 5, 10, 20, 50, 100). Each tap adds to the amount, so tapping 50 twice gives RM 100.00; **Exact** fills in the amount due and **Clear** resets it. The change is shown automatically; the server recalculates it from its own total and rejects amounts below the total. Leaving it empty means exact cash. Then the order card and dashboard show the total and method. This is a manual record. There is no payment gateway, QR payments are not verified against the bank or e-wallet, and refunds are not tracked.

**AA split bill:** tap **AA split** under Payment and choose 2–10 people. The total is divided evenly in whole sen (leftover sen go to the first payers, so shares always add up, e.g. RM 10.00 ÷ 3 = 3.34 + 3.33 + 3.33). Or switch the tab from **Equal** to **By item** to charge each person for what they had: every unit is listed (2× Teh Tarik = 2 rows) and you tap the person number who had it; submit stays disabled until every unit is assigned and everyone has at least one item. Each person picks QR Pay or Cash, and cash payers get their own change calculation. The server recomputes every share and change from its own total. Orders store one payment row per payer, and the dashboard's Cash/QR totals sum those rows.

**Pay now or pay later:** the POS defaults to **Pay now** (现在付款), where payment is recorded with the order. **Pay later** (稍后付款) sends the order to the kitchen unpaid, and stock is still deducted when it is placed. After you submit any order, the POS opens the Orders page and highlights the order. Unpaid orders show a red **Unpaid** badge and a **Collect payment** button. That button opens the same payment panel as the POS: QR or Cash, AA split, by item and change. Collecting payment is separate from the kitchen status, so an order can be READY and still unpaid; the **Unpaid only** filter lists them. Payment is recorded once. If two staff collect the same bill, only the first is recorded and the second is rejected. Cancelled orders cannot be paid. The dashboard's Cash/QR totals count collected payments only, and an **Unpaid** tile shows what is still outstanding.

**Languages:** English / 中文 toggle in the header and on the login page (remembered per device in a cookie). All UI text and server error messages are translated; strings live in `src/i18n/en.ts` and `src/i18n/zh.ts`, and TypeScript enforces that both have the same keys. Products and categories have an optional Chinese name; the POS and kitchen cards show the active language's name with the other underneath. Order items snapshot both names.

**Product photos:** the owner uploads a photo per menu item on the Products page (camera or gallery). The browser resizes it to ≤800 px JPEG before upload; the server checks owner permission first, verifies the file's magic bytes (JPG/PNG/WebP only, ≤2 MB), stores it under `.data/uploads/` (git-ignored) and serves it at `/api/uploads/<uuid>.<ext>`. Replacing or removing a photo deletes the old file. This local storage moves to a Supabase Storage bucket when the database is connected (`src/server/image-storage.ts` is the only file that changes).

Order status sync currently uses polling (every 5 s on the orders board, 15 s for POS estimates); this becomes Supabase Realtime later.

## Requirements
- Node.js 20.9 or later, npm
- A Supabase project (for running the app)
- No Docker needed for tests: the database tests download and run a real PostgreSQL binary via `embedded-postgres`.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase URL and publishable/anon key
```

Never place the Supabase service-role key in a `NEXT_PUBLIC_*` variable or browser code.

### Database (Supabase CLI)

The Supabase CLI is a dev dependency, so no global install is needed. Migrations live in `supabase/migrations/` and are applied in filename order:

1. `0001_initial_schema.sql`: tables, enums, constraints
2. `0002_access_control.sql`: RLS policies, privileges, helper functions
3. `0003_order_payment_method.sql`: payment method (Cash / QR), cash received and change on orders
4. `0004_bilingual_names.sql`: optional Chinese names on categories/products, Chinese name snapshot on order items
5. `0005_order_payments.sql`: one payment row per payer (AA split); moves 0003's single-payment columns into it
6. `0006_order_payment_items.sql`: split by item: which order items each payer paid for, enforced to cover every unit exactly once
7. `0007_pay_later.sql`: `paid_at` / `paid_by` on orders; an order is unpaid with no payment rows, can be paid once (guarded update), and a recorded payment cannot be changed

One-time link to your hosted project:

```bash
npx supabase login                               # opens the browser for an access token
npx supabase link --project-ref <project-ref>    # asks for the database password
```

`<project-ref>` is the `xxxx` in `https://xxxx.supabase.co` (Project Settings → General).

Apply migrations:

```bash
npm run db:status   # local vs remote migration list
npm run db:push     # = npx supabase db push
```

New migration: `npm run db:new -- <name>` creates `supabase/migrations/<timestamp>_<name>.sql`. Never edit a migration after it has been pushed; add a new one.

If you already ran a migration by hand in the SQL Editor, mark it as applied instead of re-running it, e.g. `npx supabase migration repair --status applied 0001`.

In **Authentication → Providers → Email**, disable public sign-ups; accounts are created by the Owner only. (`supabase/config.toml` already has sign-ups disabled, but that file configures the local stack. Use `npx supabase config push` or the dashboard for the hosted project.)

### Create the first Owner

1. Supabase dashboard → **Authentication → Users → Add user** (auto-confirm).
2. Edit and run `supabase/scripts/bootstrap_owner.sql` in the SQL Editor.

`app.bootstrap_owner` refuses to run if an owner already exists and is not callable from the app.

## Security model

- **Reads** are filtered by Row Level Security. Staff see only rows for branches they are assigned to (and only if both the staff profile and the branch are active); owners see everything.
- **Catalog writes** (branches, categories, products, branch prices, staff assignments) are allowed for owners only, enforced by RLS.
- **Orders and inventory** have no direct write privileges for any app role, owners included. They will only change through `SECURITY DEFINER` database functions that check authorization and always write a stock movement.
- A logged-in user without an active `profiles` row has no access.
- Helper functions live in the private `app` schema: `app.is_owner()`, `app.has_branch_access(branch_id)`, `app.require_owner()`, `app.require_branch_access(branch_id)`.

## Development

```bash
npm run dev        # http://localhost:3000
npm run typecheck
npm run lint
npm test           # all tests (unit + database)
npm run test -- --project unit   # unit tests only (lib + in-memory repository)
npm run test:db    # database tests only
npm run db:push    # apply pending migrations to the linked Supabase project
```

Database tests (`tests/db/`) start a throwaway PostgreSQL, apply `tests/db/supabase-shim.sql` (a minimal stand-in for Supabase's `auth` schema and API roles), then every migration in `supabase/migrations/`. Tests impersonate users with `asUser(userId, fn)`, which switches to the `authenticated` role with JWT claims, exactly as Supabase does.

## Core inventory rule

Chicken stock of 1,200 g with a recipe usage of 120 g per serving represents 10 theoretical servings. If 4 servings are confirmed, deduct 480 g and leave 720 g, assuming no other consumption or wastage.

Order creation and all inventory changes will run in a single database transaction with an idempotency key, row locks on stock balances, and a stock movement record for every change.
