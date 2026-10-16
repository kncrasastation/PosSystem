-- Payment method recorded by staff when the order is placed (no payment gateway).
-- This records how the customer said they paid; it is not provider-verified.
create type public.payment_method as enum ('CASH', 'QR');

alter table public.orders
  add column payment_method public.payment_method not null,
  -- Cash only: amount handed over (null = exact) and the change given.
  add column cash_received numeric(12,2),
  add column change_given numeric(12,2),
  add constraint orders_cash_fields_check check (
    (cash_received is null and change_given is null)
    or (
      payment_method = 'CASH'
      and cash_received >= total_amount
      and change_given = cash_received - total_amount
    )
  );

create index idx_orders_branch_payment on public.orders(branch_id, payment_method, created_at desc);
