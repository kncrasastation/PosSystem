-- Split bills (AA): one payment row per payer instead of a single method on the order.
-- Payment rows are staff-recorded; there is no payment gateway.
create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  payer_index smallint not null check (payer_index between 1 and 10),
  method public.payment_method not null,
  amount numeric(12,2) not null check (amount >= 0),
  -- Cash only: amount handed over (null = exact) and the change given.
  cash_received numeric(12,2),
  change_given numeric(12,2),
  unique (order_id, payer_index),
  check (
    (cash_received is null and change_given is null)
    or (method = 'CASH' and cash_received >= amount and change_given = cash_received - amount)
  )
);

create index idx_order_payments_order on public.order_payments(order_id);

-- Carry over any orders recorded with the single-payment columns from 0003.
insert into public.order_payments (order_id, payer_index, method, amount, cash_received, change_given)
select id, 1, payment_method, total_amount, cash_received, change_given from public.orders;

alter table public.orders
  drop constraint orders_cash_fields_check,
  drop column payment_method,
  drop column cash_received,
  drop column change_given;
drop index if exists public.idx_orders_branch_payment;

-- Same visibility as the order itself; writes only through the order RPC (no grants).
alter table public.order_payments enable row level security;
grant select on public.order_payments to authenticated;
create policy order_payments_select on public.order_payments
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and app.has_branch_access(o.branch_id)
    )
  );

-- The sum of payment rows must equal the order total. Checked at commit so the order
-- and its payment rows can be inserted in any order within the same transaction.
create or replace function app.check_order_payments_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_total numeric(12,2);
  v_paid numeric(12,2);
begin
  select total_amount into v_total from public.orders where id = v_order_id;
  select coalesce(sum(amount), 0) into v_paid from public.order_payments where order_id = v_order_id;
  if v_total is not null and v_paid <> v_total then
    raise exception 'Payments (%) do not add up to order total (%)', v_paid, v_total using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger trg_order_payments_total
  after insert or update or delete on public.order_payments
  deferrable initially deferred
  for each row execute function app.check_order_payments_total();
