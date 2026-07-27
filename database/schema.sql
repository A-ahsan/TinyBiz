-- TinyBiz Multi-Tenant Wholesale Ledger Schema
-- PostgreSQL on Supabase with Row Level Security

-- =============================================================================
-- 1. PROFILES TABLE (extends Supabase Auth)
-- =============================================================================

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  business_name text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Users can insert their own profile"
  on profiles for insert
  with check (id = auth.uid());

create policy "Users can view their own profile"
  on profiles for select
  using (id = auth.uid());

create policy "Users can update their own profile"
  on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- =============================================================================
-- 1.5 PRODUCT CATEGORIES TABLE
-- =============================================================================

create table if not exists product_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz default now()
);

alter table product_categories enable row level security;

create policy "Users manage their own product categories"
  on product_categories for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create unique index if not exists idx_product_categories_user_name_active
  on product_categories (user_id, lower(name))
  where status = 'active';

-- =============================================================================
-- 2. PRODUCTS TABLE
-- =============================================================================

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  set_rate numeric(12,2),              -- nullable, optional
  unit text,                            -- nullable, optional, e.g. 'kg', 'pcs'
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz default now()
);

alter table products enable row level security;

create policy "Users manage their own products"
  on products for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Add category support to products for existing databases.
alter table products add column if not exists category_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_category_id_fkey'
      and conrelid = 'products'::regclass
  ) then
    alter table products
      add constraint products_category_id_fkey
      foreign key (category_id) references product_categories(id);
  end if;
end
$$;

-- =============================================================================
-- 3. SELLERS TABLE
-- =============================================================================

create table if not exists sellers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  store_name text,
  location text,
  email text,
  phone text,
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz default now()
);

alter table sellers enable row level security;

create policy "Users manage their own sellers"
  on sellers for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- 4. BUYERS TABLE
-- =============================================================================

create table if not exists buyers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  store_name text,
  location text,
  email text,
  phone text,
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz default now()
);

alter table buyers enable row level security;

create policy "Users manage their own buyers"
  on buyers for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- 5. PURCHASES TABLE (each purchase = one batch/lot)
-- =============================================================================

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references sellers(id),
  product_id uuid not null references products(id),
  date date not null,
  quantity numeric(12,3) not null check (quantity > 0),
  buying_rate numeric(12,2) not null check (buying_rate >= 0),
  total_cost numeric(14,2) generated always as (quantity * buying_rate) stored,
  amount_paid numeric(14,2) not null default 0,
  remaining_qty numeric(12,3) not null,   -- starts equal to quantity, decremented on sale allocation
  purchase_group_id uuid,                 -- items bought together share one group (see migration 002)
  purchase_number text,                   -- human-readable reference for that group, e.g. PUR-00012
  status text not null default 'active' check (status in ('active','voided')),
  created_at timestamptz default now()
);

alter table purchases enable row level security;

create policy "Users manage their own purchases"
  on purchases for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Group support for existing databases.
alter table purchases add column if not exists purchase_group_id uuid;
alter table purchases add column if not exists purchase_number text;
update purchases set purchase_group_id = id where purchase_group_id is null;

-- =============================================================================
-- 6. SALES TABLE (each sale = one invoice header)
-- =============================================================================

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buyer_id uuid not null references buyers(id),
  invoice_number text not null,           -- auto-generate, unique per user, e.g. sequential per-account
  date date not null,
  amount_received numeric(14,2) not null default 0,
  status text not null default 'active' check (status in ('active','voided')),
  created_at timestamptz default now()
);

alter table sales enable row level security;

create policy "Users manage their own sales"
  on sales for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- 7. SALE LINE ITEMS TABLE (multi-product support per invoice)
-- =============================================================================

create table if not exists sale_line_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity numeric(12,3) not null check (quantity > 0),
  sale_rate numeric(12,2) not null check (sale_rate >= 0),
  line_total numeric(14,2) generated always as (quantity * sale_rate) stored,
  created_at timestamptz default now()
);

alter table sale_line_items enable row level security;

create policy "Users manage line items on their own sales"
  on sale_line_items for all
  using (exists (select 1 from sales where sales.id = sale_line_items.sale_id and sales.user_id = auth.uid()))
  with check (exists (select 1 from sales where sales.id = sale_line_items.sale_id and sales.user_id = auth.uid()));

-- =============================================================================
-- 8. SALE ALLOCATIONS TABLE (FIFO batch allocation for cost/profit calc)
-- =============================================================================

create table if not exists sale_allocations (
  id uuid primary key default gen_random_uuid(),
  sale_line_item_id uuid not null references sale_line_items(id) on delete cascade,
  purchase_id uuid not null references purchases(id),
  quantity_allocated numeric(12,3) not null check (quantity_allocated > 0),
  cost_allocated numeric(14,2) not null     -- quantity_allocated * that batch's buying_rate, captured at allocation time
);

alter table sale_allocations enable row level security;

create policy "Users manage allocations on their own sales"
  on sale_allocations for all
  using (exists (
    select 1 from sale_line_items sli
    join sales s on s.id = sli.sale_id
    where sli.id = sale_allocations.sale_line_item_id and s.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from sale_line_items sli
    join sales s on s.id = sli.sale_id
    where sli.id = sale_allocations.sale_line_item_id and s.user_id = auth.uid()
  ));

-- =============================================================================
-- 9. PAYMENTS TABLE (standalone payment recording)
-- =============================================================================

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('to_seller','from_buyer')),
  party_type text not null check (party_type in ('seller','buyer')),
  party_id uuid not null,                  -- references sellers.id or buyers.id depending on party_type
  linked_purchase_id uuid references purchases(id),  -- optional
  linked_sale_id uuid references sales(id),          -- optional
  amount numeric(14,2) not null check (amount > 0),
  payment_type text not null check (payment_type in ('settlement','advance','due_clearance')),
  date date not null,
  created_at timestamptz default now()
);

alter table payments enable row level security;

create policy "Users manage their own payments"
  on payments for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- 10. SELLER BALANCES VIEW
-- =============================================================================

create or replace view seller_balances as
select
  s.id as seller_id,
  s.user_id,
  s.name as seller_name,
  s.store_name,
  s.location,
  s.email,
  s.phone,
  s.status,
  coalesce(sum(p.total_cost) filter (where p.status = 'active'), 0)
    - coalesce(sum(p.amount_paid) filter (where p.status = 'active'), 0)
    - coalesce((select sum(pay.amount) from payments pay where pay.party_type = 'seller' and pay.party_id = s.id and pay.user_id = s.user_id), 0)
    as running_balance
from sellers s
left join purchases p on p.seller_id = s.id
where s.status = 'active'
group by s.id, s.user_id, s.name, s.store_name, s.location, s.email, s.phone, s.status;

-- =============================================================================
-- 11. BUYER BALANCES VIEW
-- =============================================================================

create or replace view buyer_balances as
select
  b.id as buyer_id,
  b.user_id,
  b.name as buyer_name,
  b.store_name,
  b.location,
  b.email,
  b.phone,
  b.status,
  coalesce(sum(sa.total_sale_value) filter (where sa.status = 'active'), 0)
    - coalesce(sum(sa.amount_received) filter (where sa.status = 'active'), 0)
    - coalesce((select sum(pay.amount) from payments pay where pay.party_type = 'buyer' and pay.party_id = b.id and pay.user_id = b.user_id), 0)
    as running_balance
from buyers b
left join (
  select sales.id, sales.buyer_id, sales.status, sales.amount_received, sales.user_id,
         (select sum(sli.line_total) from sale_line_items sli where sli.sale_id = sales.id) as total_sale_value
  from sales
) sa on sa.buyer_id = b.id
where b.status = 'active'
group by b.id, b.user_id, b.name, b.store_name, b.location, b.email, b.phone, b.status;

-- =============================================================================
-- 12. INDEXES (for performance on common queries)
-- =============================================================================

create index if not exists idx_purchases_user_id on purchases(user_id);
create index if not exists idx_purchases_seller_id on purchases(seller_id);
create index if not exists idx_purchases_product_id on purchases(product_id);
create index if not exists idx_purchases_status on purchases(status);
create index if not exists idx_purchases_date on purchases(date);
create index if not exists idx_purchases_group_id on purchases(purchase_group_id);

create index if not exists idx_sales_user_id on sales(user_id);
create index if not exists idx_sales_buyer_id on sales(buyer_id);
create index if not exists idx_sales_status on sales(status);
create index if not exists idx_sales_date on sales(date);

create index if not exists idx_sale_line_items_sale_id on sale_line_items(sale_id);
create index if not exists idx_sale_line_items_product_id on sale_line_items(product_id);

create index if not exists idx_sale_allocations_sale_line_item_id on sale_allocations(sale_line_item_id);
create index if not exists idx_sale_allocations_purchase_id on sale_allocations(purchase_id);

create index if not exists idx_payments_user_id on payments(user_id);
create index if not exists idx_payments_party_id on payments(party_id);
create index if not exists idx_payments_date on payments(date);

create index if not exists idx_products_user_id on products(user_id);
create index if not exists idx_products_status on products(status);
create index if not exists idx_products_category_id on products(category_id);

create index if not exists idx_product_categories_user_id on product_categories(user_id);
create index if not exists idx_product_categories_status on product_categories(status);

create index if not exists idx_sellers_user_id on sellers(user_id);
create index if not exists idx_sellers_status on sellers(status);

create index if not exists idx_buyers_user_id on buyers(user_id);
create index if not exists idx_buyers_status on buyers(status);

-- =============================================================================
-- 13. ATOMIC SALE RPC: perform_sale(...)
-- Implements FIFO allocation and creates sale, line items, allocations atomically.
-- Input: JSON array of line items: [{"product_id":"...","quantity":1.5,"sale_rate":120.00}, ...]
-- Returns: created sale id (uuid)
-- Usage: select perform_sale('<buyer_id>'::uuid, 'INV-0001', '2026-06-29'::date, 7200.00, '[{"product_id":"...","quantity":60,"sale_rate":120}]'::json);
-- The function uses auth.uid() for the user scope to satisfy RLS.
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
  v_line json;
  v_product_id uuid;
  v_qty numeric;
  v_rate numeric;
  v_available numeric;
  v_sli_id uuid;
  v_alloc_qty numeric;
  v_total_cost numeric := 0;
  v_rec record;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- Create sale header
  insert into sales(user_id, buyer_id, invoice_number, date, amount_received)
  values (v_user_id, p_buyer_id, p_invoice_number, p_date, p_amount_received)
  returning id into v_sale_id;

  -- Iterate lines
  for v_line in select * from json_array_elements(p_lines) loop
    v_product_id := (v_line ->> 'product_id')::uuid;
    v_qty := (v_line ->> 'quantity')::numeric;
    v_rate := (v_line ->> 'sale_rate')::numeric;

    -- Check available stock (sum of remaining_qty)
    select coalesce(sum(remaining_qty),0) into v_available
      from purchases
      where user_id = v_user_id and product_id = v_product_id and status = 'active' and remaining_qty > 0;

    if v_available < v_qty then
      raise exception 'insufficient stock for product %: available % requested %', v_product_id, v_available, v_qty;
    end if;

    -- Insert line item
    insert into sale_line_items(sale_id, product_id, quantity, sale_rate)
    values (v_sale_id, v_product_id, v_qty, v_rate)
    returning id into v_sli_id;

    -- Allocate FIFO from purchases
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

      v_total_cost := v_total_cost + round((v_alloc_qty * v_rec.buying_rate)::numeric, 2);
      v_qty := v_qty - v_alloc_qty;
    end loop;
  end loop;

  return v_sale_id;
end;
$$;

-- =============================================================================
-- 14. VOID OPERATIONS
-- Purchase can only be voided before any allocation has reduced remaining_qty.
-- Sale void reverses all FIFO allocations and restores purchase remaining_qty.
-- =============================================================================

create or replace function void_purchase(p_purchase_id uuid)
returns void
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
  v_purchase record;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_purchase
  from purchases
  where id = p_purchase_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'purchase not found';
  end if;

  if v_purchase.status <> 'active' then
    raise exception 'purchase is already voided';
  end if;

  if v_purchase.remaining_qty <> v_purchase.quantity then
    raise exception 'purchase cannot be voided because stock has already been allocated';
  end if;

  update purchases
    set status = 'voided'
  where id = p_purchase_id
    and user_id = v_user_id;
end;
$$;

create or replace function void_sale(p_sale_id uuid)
returns void
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
  v_sale record;
  v_alloc record;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_sale
  from sales
  where id = p_sale_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'sale not found';
  end if;

  if v_sale.status <> 'active' then
    raise exception 'sale is already voided';
  end if;

  for v_alloc in
    select sa.quantity_allocated, sa.purchase_id
    from sale_allocations sa
    join sale_line_items sli on sli.id = sa.sale_line_item_id
    where sli.sale_id = p_sale_id
  loop
    update purchases
      set remaining_qty = remaining_qty + v_alloc.quantity_allocated
    where id = v_alloc.purchase_id;
  end loop;

  update sales
    set status = 'voided'
  where id = p_sale_id
    and user_id = v_user_id;
end;
$$;

-- =============================================================================
-- 15. PRODUCT STOCK VIEW + MANUAL STOCK ADJUSTMENT
-- (Also available as database/migrations/001_product_stock.sql for existing DBs)
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

