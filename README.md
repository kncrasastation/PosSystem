# Food Court POS Starter

A starter project for a responsive, multi-branch food court POS and ingredient inventory system.

## Included
- Next.js App Router + TypeScript + Tailwind CSS setup
- Basic starter dashboard page
- Supabase browser/server client helpers
- Initial PostgreSQL schema migration
- Claude Code project instructions in `CLAUDE.md`
- Environment variable example

**Important:** this is an initialization package, not a production-ready POS. Authentication screens, reviewed Row Level Security policies, order RPC, and inventory deduction logic still need to be implemented and tested.

## Requirements
- Node.js 20.9 or later
- npm
- A Supabase project
- VS Code; Claude Code is optional

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and replace the placeholders with your Supabase Project URL and publishable/anon key.

Never place a Supabase service-role key in a `NEXT_PUBLIC_*` variable or browser code.

## 3. Create database tables

In Supabase, open **SQL Editor**, then run the SQL in:

`supabase/migrations/0001_initial_schema.sql`

The migration enables Row Level Security but intentionally does not create permissive policies. Before connecting live data, implement and test least-privilege policies and backend authorization. Do not use production customer/business data during initial development.

## 4. Start the development server

```bash
npm run dev
```

Open http://localhost:3000.

## 5. Checks

```bash
npm run typecheck
npm run lint
npm run build
```

## Recommended next step with Claude Code

Open this folder in VS Code, start Claude Code in the project terminal, and ask it to read `CLAUDE.md` and `README.md`. Have it propose the architecture and implement Phase 1 incrementally. Review each change and run checks before proceeding.

## Core inventory rule

For example, chicken stock of 1,200 g with a recipe usage of 120 g per serving represents 10 theoretical servings. If 4 servings are confirmed, deduct 480 g and leave 720 g, assuming no other consumption or wastage.

The real implementation must perform order creation and all inventory changes in a single database transaction, use an idempotency key, guard concurrent stock updates, and write stock movement records for every change.
