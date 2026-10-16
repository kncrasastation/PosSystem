-- Split by item: which order items each payer paid for. Absent for even (AA) splits.
create table public.order_payment_items (
  payment_id uuid not null references public.order_payments(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  primary key (payment_id, order_item_id)
);

create index idx_order_payment_items_item on public.order_payment_items(order_item_id);

-- Same visibility as the order; written only by the order RPC (no grants for app roles).
alter table public.order_payment_items enable row level security;
grant select on public.order_payment_items to authenticated;
create policy order_payment_items_select on public.order_payment_items
  for select to authenticated using (
    exists (
      select 1
      from public.order_payments p
      join public.orders o on o.id = p.order_id
      where p.id = payment_id and app.has_branch_access(o.branch_id)
    )
  );

-- When an order is split by item, its allocations must cover every unit exactly once.
-- Checked at commit, after the RPC has inserted the order, items, payments and allocations.
create or replace function app.check_order_payment_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_mismatch boolean;
begin
  select p.order_id into v_order_id from public.order_payments p
  where p.id = coalesce(new.payment_id, old.payment_id);

  select exists (
    select 1
    from public.order_items oi
    left join (
      select opi.order_item_id, sum(opi.quantity) as allocated
      from public.order_payment_items opi
      join public.order_payments p on p.id = opi.payment_id
      where p.order_id = v_order_id
      group by opi.order_item_id
    ) a on a.order_item_id = oi.id
    where oi.order_id = v_order_id and coalesce(a.allocated, 0) <> oi.quantity
  ) into v_mismatch;

  if v_mismatch then
    raise exception 'Item allocations do not cover every unit of order % exactly once', v_order_id
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger trg_order_payment_items_cover
  after insert or update or delete on public.order_payment_items
  deferrable initially deferred
  for each row execute function app.check_order_payment_items();
