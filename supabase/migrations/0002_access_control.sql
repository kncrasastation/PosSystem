-- Phase 1a: access-control foundation.
--
-- Model:
--   * Reads are filtered by Row Level Security.
--   * Catalog/branch/staff-assignment writes are owner-only via RLS.
--   * Orders and every inventory change are written ONLY through SECURITY DEFINER
--     functions (added in later migrations); the app roles get no direct write grants
--     on those tables, so stock can never change without a stock movement.
--   * A user with no profile, or an inactive profile, has no access at all.

-- ---------------------------------------------------------------------------
-- Branch settings
-- ---------------------------------------------------------------------------
alter table public.branches
  add column timezone text not null default 'Asia/Kuala_Lumpur';

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_branches_updated_at before update on public.branches
  for each row execute function public.set_updated_at();
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger trg_products_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger trg_ingredients_updated_at before update on public.ingredients
  for each row execute function public.set_updated_at();
create trigger trg_orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Private helper schema (not exposed through the Supabase Data API)
-- ---------------------------------------------------------------------------
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated;

-- SECURITY DEFINER so policies on profiles/assignments do not recurse.
create or replace function app.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
  );
$$;

create or replace function app.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role = 'OWNER'
  );
$$;

-- Owners: every branch. Staff: active branches they are assigned to.
create or replace function app.has_branch_access(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_owner() or exists (
    select 1
    from public.staff_branch_assignments a
    join public.profiles p on p.id = a.user_id
    join public.branches b on b.id = a.branch_id
    where a.user_id = auth.uid()
      and a.branch_id = p_branch_id
      and p.is_active
      and b.is_active
  );
$$;

revoke all on function app.is_active_user() from public;
revoke all on function app.is_owner() from public;
revoke all on function app.has_branch_access(uuid) from public;
grant execute on function app.is_active_user() to authenticated;
grant execute on function app.is_owner() to authenticated;
grant execute on function app.has_branch_access(uuid) to authenticated;

-- Raises unless the caller may act on the branch. For use inside RPCs.
create or replace function app.require_branch_access(p_branch_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_branch_access(p_branch_id) then
    raise exception 'Not authorized for this branch' using errcode = '42501';
  end if;
end;
$$;

create or replace function app.require_owner()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_owner() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
end;
$$;

revoke all on function app.require_branch_access(uuid) from public;
revoke all on function app.require_owner() from public;

-- ---------------------------------------------------------------------------
-- Table privileges: deny by default, then grant what RLS will further filter.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

grant select on all tables in schema public to authenticated;

-- Owner-managed reference data (RLS restricts these to owners).
grant insert, update on public.branches to authenticated;
grant insert, update on public.categories to authenticated;
grant insert, update on public.products to authenticated;
grant insert, update, delete on public.branch_products to authenticated;
grant insert, delete on public.staff_branch_assignments to authenticated;

-- Column-level guard: owners may only edit these profile fields directly.
-- Profile creation happens through the server-side staff-management flow.
grant update (name, role, is_active) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security policies
-- ---------------------------------------------------------------------------

-- branches
create policy branches_select on public.branches
  for select to authenticated using (app.has_branch_access(id));
create policy branches_owner_insert on public.branches
  for insert to authenticated with check (app.is_owner());
create policy branches_owner_update on public.branches
  for update to authenticated using (app.is_owner()) with check (app.is_owner());

-- profiles: everyone sees their own row; owners see all and may update others.
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or app.is_owner());
create policy profiles_owner_update on public.profiles
  for update to authenticated
  using (app.is_owner() and id <> auth.uid())
  with check (app.is_owner() and id <> auth.uid());

-- staff_branch_assignments
create policy assignments_select on public.staff_branch_assignments
  for select to authenticated using (user_id = auth.uid() or app.is_owner());
create policy assignments_owner_insert on public.staff_branch_assignments
  for insert to authenticated with check (app.is_owner());
create policy assignments_owner_delete on public.staff_branch_assignments
  for delete to authenticated using (app.is_owner());

-- categories / products: shared catalog, readable by any active user.
create policy categories_select on public.categories
  for select to authenticated using (app.is_active_user());
create policy categories_owner_insert on public.categories
  for insert to authenticated with check (app.is_owner());
create policy categories_owner_update on public.categories
  for update to authenticated using (app.is_owner()) with check (app.is_owner());

create policy products_select on public.products
  for select to authenticated using (app.is_active_user());
create policy products_owner_insert on public.products
  for insert to authenticated with check (app.is_owner());
create policy products_owner_update on public.products
  for update to authenticated using (app.is_owner()) with check (app.is_owner());

-- branch_products: price/availability per branch.
create policy branch_products_select on public.branch_products
  for select to authenticated using (app.has_branch_access(branch_id));
create policy branch_products_owner_insert on public.branch_products
  for insert to authenticated with check (app.is_owner());
create policy branch_products_owner_update on public.branch_products
  for update to authenticated using (app.is_owner()) with check (app.is_owner());
create policy branch_products_owner_delete on public.branch_products
  for delete to authenticated using (app.is_owner());

-- ingredients: names/units are visible to staff for POS stock warnings.
create policy ingredients_select on public.ingredients
  for select to authenticated using (app.is_active_user());

-- Branch-scoped inventory reads (staff need these for serving estimates).
create policy product_recipes_select on public.product_recipes
  for select to authenticated using (app.has_branch_access(branch_id));
create policy stock_balances_select on public.ingredient_stock_balances
  for select to authenticated using (app.has_branch_access(branch_id));

-- orders / order_items
create policy orders_select on public.orders
  for select to authenticated using (app.has_branch_access(branch_id));
create policy order_items_select on public.order_items
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and app.has_branch_access(o.branch_id)
    )
  );

-- Owner-only records.
create policy stock_movements_select on public.stock_movements
  for select to authenticated using (app.is_owner());
create policy purchase_records_select on public.purchase_records
  for select to authenticated using (app.is_owner());
create policy wastage_records_select on public.wastage_records
  for select to authenticated using (app.is_owner());
create policy stock_counts_select on public.stock_counts
  for select to authenticated using (app.is_owner());
create policy stock_count_items_select on public.stock_count_items
  for select to authenticated using (app.is_owner());
create policy audit_logs_select on public.audit_logs
  for select to authenticated using (app.is_owner());

-- ---------------------------------------------------------------------------
-- One-time owner bootstrap. Not callable by app roles; run from the SQL editor.
-- ---------------------------------------------------------------------------
create or replace function app.bootstrap_owner(p_email text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if exists (select 1 from public.profiles where role = 'OWNER') then
    raise exception 'An owner already exists; manage further accounts from the app';
  end if;

  select id into v_user_id from auth.users where lower(email) = lower(p_email);
  if v_user_id is null then
    raise exception 'No auth user with email %. Create it under Authentication > Users first.', p_email;
  end if;

  insert into public.profiles (id, name, role)
  values (v_user_id, p_name, 'OWNER');

  return v_user_id;
end;
$$;

revoke all on function app.bootstrap_owner(text, text) from public, authenticated;
