-- Pay later: an order can go to the kitchen unpaid and be paid once afterwards.
-- Unpaid = paid_at is null and no order_payments rows. Payment rows are still written only
-- by RPCs; the collection RPC claims the order with a guarded update
--   update orders set paid_at = now(), paid_by = auth.uid()
--   where id = $1 and paid_at is null and status <> 'CANCELLED'
-- so when two staff collect the same bill concurrently, exactly one succeeds.
alter table public.orders
  add column paid_at timestamptz,
  add column paid_by uuid references public.profiles(id),
  add constraint orders_paid_fields_check check ((paid_at is null) = (paid_by is null));

-- Every order recorded before this migration was paid when placed.
update public.orders set paid_at = created_at, paid_by = created_by;

create index idx_orders_branch_unpaid on public.orders(branch_id) where paid_at is null;

-- Payment is recorded once: it can be set but never changed or cleared.
-- (Corrections will go through an owner-approved request with its own audit trail.)
create or replace function app.guard_order_paid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.paid_at is not null and (new.paid_at is distinct from old.paid_at or new.paid_by is distinct from old.paid_by) then
    raise exception 'Order % is already paid', old.id using errcode = '23514';
  end if;
  if old.paid_at is null and new.paid_at is not null and old.status = 'CANCELLED' then
    raise exception 'Cancelled order % cannot be paid', old.id using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_orders_guard_paid
  before update of paid_at, paid_by on public.orders
  for each row execute function app.guard_order_paid();

-- Payment rows exist exactly when the order is marked paid. Checked at commit, after the RPC
-- has written the order and its payment rows (the existing trigger checks they sum to the total).
create or replace function app.check_order_paid_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_paid_at timestamptz;
  v_has_rows boolean;
begin
  -- Record fields are resolved at run time, so read only the ones this table has.
  if tg_table_name = 'orders' then
    v_order_id := new.id;
  elsif tg_op = 'DELETE' then
    v_order_id := old.order_id;
  else
    v_order_id := new.order_id;
  end if;
  select paid_at into v_paid_at from public.orders where id = v_order_id;
  if not found then
    return null;
  end if;
  select exists (select 1 from public.order_payments where order_id = v_order_id) into v_has_rows;
  if (v_paid_at is not null) <> v_has_rows then
    raise exception 'Order % paid_at does not match its payment rows', v_order_id using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger trg_orders_paid_consistency
  after insert or update of paid_at on public.orders
  deferrable initially deferred
  for each row execute function app.check_order_paid_consistency();

create constraint trigger trg_order_payments_paid_consistency
  after insert or delete on public.order_payments
  deferrable initially deferred
  for each row execute function app.check_order_paid_consistency();
