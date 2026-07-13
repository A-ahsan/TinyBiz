-- Migration: Product stock view + manual stock adjustment RPC
-- Run this in the Supabase SQL Editor (copy/paste the whole file).
-- Safe to run on an existing TinyBiz database.

-- =============================================================================
-- 1. Helper: get or create a dedicated seller for manual stock increases
-- =============================================================================

create or replace function get_adjustment_seller_id()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select id into v_id
  from sellers
  where user_id = v_user_id
    and name = 'Stock Adjustment'
    and status = 'active'
  limit 1;

  if v_id is null then
    insert into sellers (user_id, name, store_name)
    values (v_user_id, 'Stock Adjustment', 'Auto-created for manual stock edits')
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

-- =============================================================================
-- 2. RPC: set product stock to a target quantity (manual edit)
--    - Increases: creates an inventory batch via a purchase row
--    - Decreases: removes quantity from oldest batches first (FIFO)
--    Keeps sellable stock, FIFO costing, and displayed stock in sync.
-- =============================================================================

create or replace function adjust_product_stock(
  p_product_id uuid,
  p_target_stock numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch numeric;
  v_diff numeric;
  v_seller_id uuid;
  v_set_rate numeric;
  v_remaining numeric;
  v_rec record;
  v_take numeric;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_target_stock < 0 then
    raise exception 'stock cannot be negative';
  end if;

  if not exists (
    select 1 from products
    where id = p_product_id and user_id = v_user_id and status = 'active'
  ) then
    raise exception 'product not found or archived';
  end if;

  select coalesce(sum(remaining_qty), 0) into v_batch
  from purchases
  where product_id = p_product_id
    and user_id = v_user_id
    and status = 'active';

  v_diff := p_target_stock - v_batch;

  if v_diff > 0 then
    select set_rate into v_set_rate
    from products
    where id = p_product_id and user_id = v_user_id;

    v_seller_id := get_adjustment_seller_id();

    insert into purchases (
      user_id,
      seller_id,
      product_id,
      date,
      quantity,
      buying_rate,
      amount_paid,
      remaining_qty
    )
    values (
      v_user_id,
      v_seller_id,
      p_product_id,
      current_date,
      v_diff,
      coalesce(v_set_rate, 0),
      v_diff * coalesce(v_set_rate, 0),
      v_diff
    );
  elsif v_diff < 0 then
    v_remaining := abs(v_diff);

    for v_rec in
      select id, remaining_qty
      from purchases
      where product_id = p_product_id
        and user_id = v_user_id
        and status = 'active'
        and remaining_qty > 0
      order by date asc, created_at asc
    loop
      exit when v_remaining <= 0;
      v_take := least(v_rec.remaining_qty, v_remaining);
      update purchases
        set remaining_qty = remaining_qty - v_take
      where id = v_rec.id;
      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0.0005 then
      raise exception 'cannot reduce stock below zero (available %)', v_batch;
    end if;
  end if;

  select coalesce(sum(remaining_qty), 0) into v_batch
  from purchases
  where product_id = p_product_id
    and user_id = v_user_id
    and status = 'active';

  return v_batch;
end;
$$;

-- =============================================================================
-- 3. View: live stock per product (sum of active batch remaining_qty)
-- =============================================================================

create or replace view product_stock_levels as
select
  p.id as product_id,
  p.user_id,
  p.name,
  p.category_id,
  p.unit,
  p.set_rate,
  p.status,
  p.created_at,
  coalesce(sum(pur.remaining_qty) filter (where pur.status = 'active'), 0) as stock_qty
from products p
left join purchases pur on pur.product_id = p.id
group by
  p.id,
  p.user_id,
  p.name,
  p.category_id,
  p.unit,
  p.set_rate,
  p.status,
  p.created_at;

grant select on product_stock_levels to authenticated;

grant execute on function get_adjustment_seller_id() to authenticated;
grant execute on function adjust_product_stock(uuid, numeric) to authenticated;
