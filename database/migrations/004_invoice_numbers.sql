-- Migration: Sequential, unique invoice numbers
-- Run this in the Supabase SQL Editor. Safe to run more than once.
--
-- Before: invoice numbers were `INV-<millisecond timestamp>` generated in the
-- browser — not sequential, and nothing in the database stopped two sales from
-- carrying the same number.
-- After: a per-user counter issues INV-00001, INV-00002, ... inside the same
-- transaction that creates the sale, and a unique index enforces it.
--
-- Existing INV-<timestamp> numbers are left untouched. New numbering starts at
-- 1 and cannot collide with them (different length/shape).

-- =============================================================================
-- STEP 0 — SAFETY CHECK (run alone first)
-- The unique index in step 2 fails if you already have duplicates. This lists
-- them. An empty result means you are clear to proceed.
-- =============================================================================

select user_id, invoice_number, count(*)
from sales
group by user_id, invoice_number
having count(*) > 1;

-- =============================================================================
-- STEP 1 — Per-user invoice counter
-- =============================================================================

create table if not exists invoice_counters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  next_number bigint not null default 0
);

alter table invoice_counters enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'invoice_counters'
      and policyname = 'Users manage their own invoice counter'
  ) then
    create policy "Users manage their own invoice counter"
      on invoice_counters for all
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end
$$;

-- Atomically claims the next number. The upsert takes a row lock, so two
-- concurrent sales can never receive the same value.
create or replace function next_invoice_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_number bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  insert into invoice_counters (user_id, next_number)
  values (v_user_id, 1)
  on conflict (user_id)
  do update set next_number = invoice_counters.next_number + 1
  returning next_number into v_number;

  return 'INV-' || lpad(v_number::text, 5, '0');
end;
$$;

grant execute on function next_invoice_number() to authenticated;

-- =============================================================================
-- STEP 2 — Enforce uniqueness per user
-- =============================================================================

create unique index if not exists idx_sales_user_invoice_number
  on sales (user_id, invoice_number);

-- =============================================================================
-- STEP 3 — perform_sale generates the number itself
-- Passing null (or an empty string) for p_invoice_number now issues the next
-- sequential number inside the sale's own transaction, so a failed sale never
-- burns a number. Passing an explicit number still works unchanged.
-- =============================================================================

create or replace function perform_sale(
  p_buyer_id uuid,
  p_invoice_number text,
  p_date date,
  p_amount_received numeric,
  p_lines json
)
returns uuid
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
  v_sale_id uuid;
  v_invoice_number text;
  v_line json;
  v_product_id uuid;
  v_qty numeric;
  v_rate numeric;
  v_available numeric;
  v_sli_id uuid;
  v_alloc_qty numeric;
  v_rec record;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  v_invoice_number := nullif(btrim(coalesce(p_invoice_number, '')), '');
  if v_invoice_number is null then
    v_invoice_number := next_invoice_number();
  end if;

  insert into sales(user_id, buyer_id, invoice_number, date, amount_received)
  values (v_user_id, p_buyer_id, v_invoice_number, p_date, p_amount_received)
  returning id into v_sale_id;

  for v_line in select * from json_array_elements(p_lines) loop
    v_product_id := (v_line ->> 'product_id')::uuid;
    v_qty := (v_line ->> 'quantity')::numeric;
    v_rate := (v_line ->> 'sale_rate')::numeric;

    select coalesce(sum(remaining_qty),0) into v_available
      from purchases
      where user_id = v_user_id and product_id = v_product_id and status = 'active' and remaining_qty > 0;

    if v_available < v_qty then
      raise exception 'insufficient stock for product %: available % requested %', v_product_id, v_available, v_qty;
    end if;

    insert into sale_line_items(sale_id, product_id, quantity, sale_rate)
    values (v_sale_id, v_product_id, v_qty, v_rate)
    returning id into v_sli_id;

    for v_rec in
      select id, remaining_qty, buying_rate
      from purchases
      where user_id = v_user_id and product_id = v_product_id and status = 'active' and remaining_qty > 0
      order by date asc, created_at asc
    loop
      exit when v_qty <= 0;
      v_alloc_qty := least(v_rec.remaining_qty, v_qty);

      insert into sale_allocations(sale_line_item_id, purchase_id, quantity_allocated, cost_allocated)
      values (v_sli_id, v_rec.id, v_alloc_qty, round((v_alloc_qty * v_rec.buying_rate)::numeric, 2));

      update purchases set remaining_qty = remaining_qty - v_alloc_qty where id = v_rec.id;

      v_qty := v_qty - v_alloc_qty;
    end loop;
  end loop;

  return v_sale_id;
end;
$$;
