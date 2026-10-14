-- Food Court POS starter schema.
-- Apply in a development Supabase project first. Review RLS and policies before production.
create extension if not exists pgcrypto;

create type public.app_role as enum ('OWNER', 'STAFF');
create type public.order_status as enum ('NEW', 'PREPARING', 'READY', 'CANCELLED');
create type public.ingredient_unit as enum ('g', 'ml', 'pcs');
create type public.stock_movement_type as enum (
  'OPENING', 'PURCHASE', 'RECIPE_CONSUMPTION', 'WASTAGE',
  'COUNT_ADJUSTMENT', 'REVERSAL', 'MANUAL_ADJUSTMENT'
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role public.app_role not null default 'STAFF',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_branch_assignments (
  user_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  primary key (user_id, branch_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_order integer not null default 0,
  is_active boolean not null default true
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branch_products (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  price numeric(12,2) not null check (price >= 0),
  is_available boolean not null default true,
  unique (branch_id, product_id)
);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  base_unit public.ingredient_unit not null,
  default_package_quantity numeric(14,3) not null default 0 check (default_package_quantity >= 0),
  low_stock_threshold numeric(14,3) not null default 0 check (low_stock_threshold >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_recipes (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  ingredient_id uuid not null references public.ingredients(id),
  quantity_per_serving numeric(14,3) not null check (quantity_per_serving > 0),
  unique (branch_id, product_id, ingredient_id)
);

create table public.ingredient_stock_balances (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  ingredient_id uuid not null references public.ingredients(id),
  quantity_on_hand numeric(14,3) not null default 0 check (quantity_on_hand >= 0),
  updated_at timestamptz not null default now(),
  unique (branch_id, ingredient_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  order_number text not null,
  branch_id uuid not null references public.branches(id),
  table_number text,
  created_by uuid not null references public.profiles(id),
  status public.order_status not null default 'NEW',
  subtotal numeric(12,2) not null check (subtotal >= 0),
  total_amount numeric(12,2) not null check (total_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique (branch_id, order_number)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id),
  product_name_snapshot text not null,
  unit_price_snapshot numeric(12,2) not null check (unit_price_snapshot >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  special_instructions text
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  ingredient_id uuid not null references public.ingredients(id),
  movement_type public.stock_movement_type not null,
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  reason text,
  reference_type text,
  reference_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.purchase_records (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  ingredient_id uuid not null references public.ingredients(id),
  quantity_received numeric(14,3) not null check (quantity_received > 0),
  unit_cost numeric(12,2) check (unit_cost >= 0),
  total_cost numeric(12,2) check (total_cost >= 0),
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.wastage_records (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  ingredient_id uuid not null references public.ingredients(id),
  quantity numeric(14,3) not null check (quantity > 0),
  reason text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'CONFIRMED')),
  counted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table public.stock_count_items (
  id uuid primary key default gen_random_uuid(),
  stock_count_id uuid not null references public.stock_counts(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id),
  theoretical_quantity numeric(14,3) not null,
  actual_quantity numeric(14,3) not null check (actual_quantity >= 0),
  variance numeric(14,3) not null,
  unique (stock_count_id, ingredient_id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id),
  actor_user_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_orders_branch_created on public.orders(branch_id, created_at desc);
create index idx_orders_status on public.orders(branch_id, status);
create index idx_stock_movements_branch_ingredient_created
  on public.stock_movements(branch_id, ingredient_id, created_at desc);
create index idx_recipes_branch_product on public.product_recipes(branch_id, product_id);
create index idx_assignments_branch on public.staff_branch_assignments(branch_id);

-- RLS is enabled by default for application-facing tables.
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.staff_branch_assignments enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.branch_products enable row level security;
alter table public.ingredients enable row level security;
alter table public.product_recipes enable row level security;
alter table public.ingredient_stock_balances enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.purchase_records enable row level security;
alter table public.wastage_records enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_items enable row level security;
alter table public.audit_logs enable row level security;

-- Intentionally no permissive policies are added here.
-- Add reviewed policies and server-side authorization before connecting the app to live data.
-- Do not expose service-role credentials to the browser.
