# Claude Code Instructions — Food Court POS

## Project goal
Build a small, reliable, responsive multi-branch food court POS and ingredient inventory application for 2–3 staff initially. Keep UX simple and touch-friendly.

## Stack
- Next.js App Router + TypeScript
- Tailwind CSS
- Supabase Auth + PostgreSQL
- Supabase SSR helpers
- Zod for input validation

## Non-negotiable business rules
1. Inventory deduction occurs only when an order is successfully confirmed and persisted.
2. Order creation, order items, ingredient balance deductions, stock movement rows, and idempotency handling must be atomic in a PostgreSQL transaction/RPC.
3. Aggregate ingredient usage across all products in an order before deducting.
4. Prevent duplicate deductions using a client-generated idempotency UUID with a database unique constraint and server-side handling.
5. Prevent concurrent overselling by locking relevant stock rows or using guarded atomic updates inside the database transaction.
6. If stock is insufficient, reject by default and identify the ingredient. Do not silently permit negative stock.
7. Never automatically restore stock merely because an order is cancelled. Implement an owner-controlled reversal for ingredients confirmed unused/recoverable, with audit records.
8. Every inventory change must create a stock movement. Never overwrite inventory without a movement.
9. Use integer minor units or exact PostgreSQL numeric for money and exact numeric for quantities; do not use JavaScript floating-point arithmetic as the authoritative stock/money calculation.
10. Every branch-specific query and mutation must enforce branch authorization server-side. Staff may access only assigned branches; owners may access all branches.
11. Never expose Supabase service-role keys to client code. Do not prefix secrets with NEXT_PUBLIC_.
12. Historical order item names and prices must be snapshots.
13. Displayed serving estimates are advisory only; revalidate stock on submission.
14. Do not claim payments are collected unless payment processing is implemented.

## Roles and features
Owner: branches, staff, categories, products/prices, recipes, ingredients, purchases, wastage, stock counts, reports, orders.
Staff: POS and order status management for assigned branch only.
Order statuses: NEW, PREPARING, READY, CANCELLED.
Ingredient base units: g, ml, pcs.
Each branch has separate stock balances and stock movements.

## Workflow
Before implementing a feature:
1. Inspect the existing project.
2. State the proposed design and affected files.
3. Implement in small increments.
4. Run `npm run typecheck`, `npm run lint`, and relevant tests.
5. Fix errors before moving to the next phase.
6. Update README.

## Phases
1. Auth, roles, branch access, product/category management, POS, orders.
2. Ingredients, recipes, transactional auto-deduction, serving estimates and low-stock warnings.
3. Purchases, wastage, stock counts, variance and movement history.
4. Sales and inventory reports.

## Tests required
Order creation/status changes; recipe deduction; insufficient stock; duplicate submissions; concurrent stock contention; cancellation and controlled reversal; stock count variance; branch-level access.

## Scope exclusions
No payment gateway, accounting, payroll, loyalty, preparation timers, countdowns, supplier procurement workflow, or kitchen performance analytics unless explicitly requested.

## First task
Read `README.md` and `supabase/migrations/0001_initial_schema.sql`, inspect the starter app, then propose the architecture and phased implementation plan. Explain transaction atomicity, idempotency, concurrency protection, and branch isolation before implementing business logic. Do not implement the entire system in one unreviewed pass.
